import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { localDate } from '../opd-prices/local-date';
import {
  AVAILABILITY_AUDIT,
  AVAILABILITY_CONFIG as C,
  type AvailabilityChangeKind,
} from './availability.config';
import {
  AvailabilityRuleError,
  leavesOverlap,
  parseLeave,
  parseSwitch,
  parseTimings,
  type LeavePeriod,
  type Slot,
} from './availability.rules';

type Actor = { tenantId: string; userId: string };
type Scope = { wide: boolean; branches: string[] };

export type AvailabilityView = {
  doctorProfileId: string;
  code: string;
  name: string;
  availabilityOn: boolean;
  /** The hospital date today, so the screen can mark past leave. */
  today: string;
  /** Branches this doctor works in that the caller may see. `editable` = the caller may change the timetable. */
  branches: Array<{ id: string; name: string; editable: boolean }>;
  timings: Array<{ id: string; branchId: string; weekday: number; start: string; end: string }>;
  leaves: Array<{ id: string; fromDate: string; toDate: string }>;
  canWrite: boolean;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** @db.Time values carry the wall clock in their UTC parts. */
function timeText(t: Date): string {
  return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

const timeValue = (text: string): Date => new Date(`1970-01-01T${text}:00.000Z`);
const dateValue = (text: string): Date => new Date(`${text}T00:00:00.000Z`);
const dateText = (d: Date): string => d.toISOString().slice(0, 10);

function invalid(error: AvailabilityRuleError): never {
  throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
    field: error.field,
    reason: error.reason,
  });
}

/** Run a parser and turn its refusal into the API error. */
function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof AvailabilityRuleError) {
      return invalid(error);
    }
    throw error;
  }
}

/**
 * Step 8b, part D: availability of a doctor (the on/off switch, the weekly timetable per branch and
 * leave periods). Read needs `opd.doctors.read`, every change needs `opd.doctors.write`. A hospital-wide
 * Admin reaches every doctor; a Branch Admin only doctors who work in a branch where they hold the
 * permission, and only the timetable of those branches. A doctor outside the scope does not exist for
 * the caller (404). Leave and the switch block assignment; timings only warn (DoctorAvailabilityService).
 */
@Injectable()
export class DoctorAvailabilityAdminService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(actor: Actor, doctorProfileId: string): Promise<AvailabilityView> {
    const read = await this.scope('opd.doctors.read');
    const write = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant((tx) => this.viewInTx(tx, actor, doctorProfileId, read, write));
  }

  async setSwitch(actor: Actor, doctorProfileId: string, body: unknown): Promise<AvailabilityView> {
    const input = parsed(() => parseSwitch(body));
    const read = await this.scope('opd.doctors.read');
    const write = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      await this.lockDoctor(tx, actor, doctorProfileId, write);
      await tx.doctorProfile.update({
        where: { id: doctorProfileId },
        data: { availabilityOn: input.availabilityOn },
      });
      await this.audit(tx, actor, doctorProfileId, 'SWITCH', {
        availabilityOn: input.availabilityOn,
      });
      return this.viewInTx(tx, actor, doctorProfileId, read, write);
    });
  }

  /** Replace the whole weekly timetable of this doctor in ONE branch. */
  async setTimings(
    actor: Actor,
    doctorProfileId: string,
    branchId: string,
    body: unknown,
  ): Promise<AvailabilityView> {
    const slots = parsed(() => parseTimings(body));
    const read = await this.scope('opd.doctors.read');
    const write = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      const doctor = await this.lockDoctor(tx, actor, doctorProfileId, write);
      const allowed = this.editableBranchIds(doctor, write);
      if (!allowed.has(branchId)) {
        // Another hospital, a branch the doctor does not work in, or a branch outside the caller scope.
        throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
          field: 'branchId',
          reason: 'BRANCH_NOT_ALLOWED',
        });
      }
      await tx.doctorTiming.deleteMany({
        where: { tenantId: actor.tenantId, doctorProfileId, branchId },
      });
      if (slots.length > 0) {
        await tx.doctorTiming.createMany({
          data: slots.map((s: Slot) => ({
            tenantId: actor.tenantId,
            doctorProfileId,
            branchId,
            weekday: s.weekday,
            startTime: timeValue(s.start),
            endTime: timeValue(s.end),
          })),
        });
      }
      await this.audit(tx, actor, doctorProfileId, 'TIMINGS', {
        branchId,
        slots: slots.map((s) => [s.weekday, s.start, s.end]),
      });
      return this.viewInTx(tx, actor, doctorProfileId, read, write);
    });
  }

  /**
   * Adds one leave period on the caller's transaction (the doctor row must already be locked by the
   * caller). Used by the Admin who adds leave and by the approval of a leave request, so both follow
   * the same rules: no overlap with other leave and at most the allowed number of periods. The dates
   * were already checked (real, in order, not over, not too long) by the caller.
   */
  async createLeave(
    tx: TenantTx,
    actor: Actor,
    doctorProfileId: string,
    period: LeavePeriod,
    requestId?: string,
  ): Promise<string> {
    const existing = await tx.doctorLeave.findMany({
      where: { tenantId: actor.tenantId, doctorProfileId },
      select: { fromDate: true, toDate: true },
    });
    if (existing.length >= C.maxLeavePeriods) {
      throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
        field: 'fromDate',
        reason: 'TOO_MANY_PERIODS',
      });
    }
    if (
      existing.some((e) =>
        leavesOverlap(period, { fromDate: dateText(e.fromDate), toDate: dateText(e.toDate) }),
      )
    ) {
      throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
        field: 'fromDate',
        reason: 'LEAVE_OVERLAP',
      });
    }
    const created = await tx.doctorLeave.create({
      data: {
        tenantId: actor.tenantId,
        doctorProfileId,
        fromDate: dateValue(period.fromDate),
        toDate: dateValue(period.toDate),
      },
      select: { id: true },
    });
    await this.audit(tx, actor, doctorProfileId, 'LEAVE_ADD', {
      leaveId: created.id,
      fromDate: period.fromDate,
      toDate: period.toDate,
      ...(requestId ? { requestId } : {}),
    });
    return created.id;
  }

  async addLeave(actor: Actor, doctorProfileId: string, body: unknown): Promise<AvailabilityView> {
    const read = await this.scope('opd.doctors.read');
    const write = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      await this.lockDoctor(tx, actor, doctorProfileId, write);
      const today = await this.today(tx, actor.tenantId);
      const period = parsed(() => parseLeave(body, today));
      await this.createLeave(tx, actor, doctorProfileId, period);
      return this.viewInTx(tx, actor, doctorProfileId, read, write);
    });
  }

  async removeLeave(
    actor: Actor,
    doctorProfileId: string,
    leaveId: string,
  ): Promise<AvailabilityView> {
    const read = await this.scope('opd.doctors.read');
    const write = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      await this.lockDoctor(tx, actor, doctorProfileId, write);
      const leave = await tx.doctorLeave.findFirst({
        where: { id: leaveId, tenantId: actor.tenantId, doctorProfileId },
      });
      if (!leave) {
        throw opdError(404, OpdErrorCode.AVAILABILITY_LEAVE_NOT_FOUND);
      }
      await tx.doctorLeave.delete({ where: { id: leave.id } });
      await this.audit(tx, actor, doctorProfileId, 'LEAVE_REMOVE', {
        leaveId: leave.id,
        fromDate: dateText(leave.fromDate),
        toDate: dateText(leave.toDate),
      });
      return this.viewInTx(tx, actor, doctorProfileId, read, write);
    });
  }

  // ------------------------------------------------------------------------------ helpers

  private async scope(code: string): Promise<Scope> {
    const wide = (await this.access.hospitalWideBranches(code, 'OPD')).length > 0;
    const branches = wide ? [] : await this.access.permittedBranches(code, 'OPD');
    return { wide, branches };
  }

  private inScope(scope: Scope): Prisma.DoctorProfileWhereInput {
    if (scope.wide) {
      return {};
    }
    return {
      user: { userBranches: { some: { isActive: true, branchId: { in: scope.branches } } } },
    };
  }

  private async today(tx: TenantTx, tenantId: string): Promise<string> {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    return localDate(this.clock.now(), settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone);
  }

  private async load(tx: TenantTx, actor: Actor, id: string, scope: Scope) {
    const doctor = await tx.doctorProfile.findFirst({
      where: { id, tenantId: actor.tenantId, ...this.inScope(scope) },
      include: {
        user: {
          select: {
            displayName: true,
            userBranches: {
              where: { isActive: true, branch: { isActive: true } },
              select: { branchId: true, branch: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (!doctor) {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    return doctor;
  }

  /**
   * Finds the doctor inside the caller scope and takes the row lock (a touch of updated_at), so two
   * changes of the same doctor at once run one after the other and the overlap checks stay true.
   */
  private async lockDoctor(tx: TenantTx, actor: Actor, id: string, write: Scope) {
    const doctor = await this.load(tx, actor, id, write);
    await tx.doctorProfile.update({ where: { id }, data: { updatedAt: this.clock.now() } });
    return doctor;
  }

  private editableBranchIds(
    doctor: Awaited<ReturnType<DoctorAvailabilityAdminService['load']>>,
    write: Scope,
  ): Set<string> {
    const worksIn = doctor.user.userBranches.map((b) => b.branchId);
    return new Set(write.wide ? worksIn : worksIn.filter((b) => write.branches.includes(b)));
  }

  private async viewInTx(
    tx: TenantTx,
    actor: Actor,
    id: string,
    read: Scope,
    write: Scope,
  ): Promise<AvailabilityView> {
    const doctor = await this.load(tx, actor, id, read);
    const editable = this.editableBranchIds(doctor, write);
    const seen = doctor.user.userBranches.filter(
      (b) => read.wide || read.branches.includes(b.branchId),
    );
    const seenIds = seen.map((b) => b.branchId);
    const [timings, leaves, today] = await Promise.all([
      tx.doctorTiming.findMany({
        where: { tenantId: actor.tenantId, doctorProfileId: id, branchId: { in: seenIds } },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      }),
      tx.doctorLeave.findMany({
        where: { tenantId: actor.tenantId, doctorProfileId: id },
        orderBy: [{ fromDate: 'asc' }],
      }),
      this.today(tx, actor.tenantId),
    ]);
    const canWrite = write.wide || write.branches.length > 0;
    return {
      doctorProfileId: doctor.id,
      code: doctor.code,
      name: doctor.user.displayName,
      availabilityOn: doctor.availabilityOn,
      today,
      branches: seen
        .map((b) => ({ id: b.branch.id, name: b.branch.name, editable: editable.has(b.branchId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      timings: timings.map((t) => ({
        id: t.id,
        branchId: t.branchId,
        weekday: t.weekday,
        start: timeText(t.startTime),
        end: timeText(t.endTime),
      })),
      leaves: leaves.map((l) => ({
        id: l.id,
        fromDate: dateText(l.fromDate),
        toDate: dateText(l.toDate),
      })),
      canWrite,
    };
  }

  /** Ids, dates and times only: no typed text goes into the audit trail. */
  private async audit(
    tx: TenantTx,
    actor: Actor,
    doctorProfileId: string,
    kind: AvailabilityChangeKind,
    detail: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: AVAILABILITY_AUDIT.action,
        entityType: AVAILABILITY_AUDIT.entityType,
        entityId: doctorProfileId,
        reason: 'Admin changed doctor availability',
        metadata: { kind, ...detail },
      },
    });
  }
}
