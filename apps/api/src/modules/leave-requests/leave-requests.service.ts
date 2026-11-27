import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { DoctorAvailabilityAdminService } from '../doctor-availability/availability.service';
import {
  AvailabilityRuleError,
  leavesOverlap,
  parseLeave,
} from '../doctor-availability/availability.rules';
import { clinicalError, ClinicalErrorCode } from '../opd-clinical/opd-clinical.errors';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { localDate } from '../opd-prices/local-date';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';

type Actor = { tenantId: string; userId: string };
type Scope = { wide: boolean; branches: string[] };

export const LEAVE_REQUEST_LIMITS = {
  /** Requests a doctor may have waiting at the same time. */
  maxPending: 5,
  /** Requests of the doctor shown on My profile. */
  mineShown: 100,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

export const LEAVE_REQUEST_AUDIT = {
  action: 'DOCTOR_LEAVE_REQUEST',
  entityType: 'doctor_leave_requests',
} as const;

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
const STATUSES: readonly LeaveRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export type MyLeaveRequestView = {
  id: string;
  fromDate: string;
  toDate: string;
  status: LeaveRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
};

export type AdminLeaveRequestView = MyLeaveRequestView & {
  doctor: { id: string; code: string; name: string };
  decidedByName: string | null;
};

const dateValue = (text: string): Date => new Date(`${text}T00:00:00.000Z`);
const dateText = (d: Date): string => d.toISOString().slice(0, 10);

/** Turns a date rule refusal into the API error (the same words as the availability screen). */
function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof AvailabilityRuleError) {
      throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
        field: error.field,
        reason: error.reason,
      });
    }
    throw error;
  }
}

const conflict = (reason: string): never => {
  throw opdError(409, OpdErrorCode.LEAVE_REQUEST_CONFLICT, { reason });
};

/**
 * Step 8c: doctor leave requests. A doctor asks for leave from My profile (permission
 * opd.doctors.own, the doctor is found from the token, never from the request); an Admin approves or
 * rejects it (permission opd.doctors.write, the same scope as the Doctors page: SuperAdmin every
 * doctor, a Branch Admin only doctors of their own branches). Only an APPROVED request creates the
 * leave, through the same rules as an Admin adding leave (no overlap, at most 366 days, not over).
 * A doctor may cancel a request that is still waiting; an approved leave is removed by an Admin in
 * Availability. A person cannot decide their own request. Every change takes the row lock of the
 * doctor, so two decisions at the same moment (or a decision and an Admin adding leave) run one after
 * the other. Nothing typed is stored: no reason, no note.
 */
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    private readonly availability: DoctorAvailabilityAdminService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ----------------------------------------------------------------------------- helpers

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

  private async ownDoctor(tx: TenantTx, actor: Actor): Promise<{ id: string }> {
    const own = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, active: true },
      select: { id: true },
    });
    if (!own) {
      throw clinicalError(403, ClinicalErrorCode.DOCTOR_PROFILE_REQUIRED);
    }
    return own;
  }

  /** The lock of one doctor for the rest of the transaction (the same row Availability locks). */
  private async lockDoctor(tx: TenantTx, doctorProfileId: string): Promise<void> {
    await tx.doctorProfile.update({
      where: { id: doctorProfileId },
      data: { updatedAt: this.clock.now() },
    });
  }

  private async audit(
    tx: TenantTx,
    actor: Actor,
    requestId: string,
    kind: 'REQUEST' | 'CANCEL' | 'APPROVE' | 'REJECT',
    detail: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: LEAVE_REQUEST_AUDIT.action,
        entityType: LEAVE_REQUEST_AUDIT.entityType,
        entityId: requestId,
        reason: 'Leave request',
        metadata: { kind, ...detail },
      },
    });
  }

  private mine(r: {
    id: string;
    fromDate: Date;
    toDate: Date;
    status: LeaveRequestStatus;
    requestedAt: Date;
    decidedAt: Date | null;
  }): MyLeaveRequestView {
    return {
      id: r.id,
      fromDate: dateText(r.fromDate),
      toDate: dateText(r.toDate),
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  }

  // ------------------------------------------------------------------------------- doctor

  async request(actor: Actor, body: unknown): Promise<MyLeaveRequestView> {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await this.ownDoctor(tx, actor);
      await this.lockDoctor(tx, own.id);
      const today = await this.today(tx, actor.tenantId);
      const period = parsed(() => parseLeave(body, today));
      const [leave, pending] = await Promise.all([
        tx.doctorLeave.findMany({
          where: { tenantId: actor.tenantId, doctorProfileId: own.id },
          select: { fromDate: true, toDate: true },
        }),
        tx.doctorLeaveRequest.findMany({
          where: { tenantId: actor.tenantId, doctorProfileId: own.id, status: 'PENDING' },
          select: { fromDate: true, toDate: true },
        }),
      ]);
      if (pending.length >= LEAVE_REQUEST_LIMITS.maxPending) {
        return conflict('TOO_MANY_PENDING');
      }
      const overlaps = [...leave, ...pending].some((e) =>
        leavesOverlap(period, { fromDate: dateText(e.fromDate), toDate: dateText(e.toDate) }),
      );
      if (overlaps) {
        throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
          field: 'fromDate',
          reason: 'LEAVE_OVERLAP',
        });
      }
      const created = await tx.doctorLeaveRequest.create({
        data: {
          tenantId: actor.tenantId,
          doctorProfileId: own.id,
          fromDate: dateValue(period.fromDate),
          toDate: dateValue(period.toDate),
          requestedBy: actor.userId,
        },
      });
      await this.audit(tx, actor, created.id, 'REQUEST', {
        doctorProfileId: own.id,
        fromDate: period.fromDate,
        toDate: period.toDate,
      });
      return this.mine(created);
    });
  }

  async listMine(actor: Actor): Promise<{ items: MyLeaveRequestView[]; today: string }> {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await this.ownDoctor(tx, actor);
      const rows = await tx.doctorLeaveRequest.findMany({
        where: { tenantId: actor.tenantId, doctorProfileId: own.id },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: LEAVE_REQUEST_LIMITS.mineShown,
      });
      return {
        items: rows.map((r) => this.mine(r)),
        today: await this.today(tx, actor.tenantId),
      };
    });
  }

  /** The doctor cancels a request that is still waiting. Anything else is refused. */
  async cancel(actor: Actor, id: string): Promise<MyLeaveRequestView> {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await this.ownDoctor(tx, actor);
      await this.lockDoctor(tx, own.id);
      const found = await tx.doctorLeaveRequest.findFirst({
        where: { id, tenantId: actor.tenantId, doctorProfileId: own.id },
      });
      if (!found) {
        throw opdError(404, OpdErrorCode.LEAVE_REQUEST_NOT_FOUND);
      }
      if (found.status !== 'PENDING') {
        return conflict('ALREADY_DECIDED');
      }
      const closed = await tx.doctorLeaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decidedBy: actor.userId, decidedAt: this.clock.now() },
      });
      await this.audit(tx, actor, id, 'CANCEL', {
        doctorProfileId: own.id,
        fromDate: dateText(found.fromDate),
        toDate: dateText(found.toDate),
      });
      return this.mine(closed);
    });
  }

  // -------------------------------------------------------------------------------- admin

  async listForAdmin(
    actor: Actor,
    query: { status?: string; page: number; pageSize: number },
  ): Promise<{
    items: AdminLeaveRequestView[];
    total: number;
    page: number;
    pageSize: number;
    pendingCount: number;
    today: string;
  }> {
    const status = query.status ?? 'PENDING';
    if (status !== 'ALL' && !(STATUSES as readonly string[]).includes(status)) {
      throw opdError(400, OpdErrorCode.AVAILABILITY_INVALID, {
        field: 'status',
        reason: 'STATUS_INVALID',
      });
    }
    const scope = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      const base = { tenantId: actor.tenantId, doctor: this.inScope(scope) };
      const where = {
        ...base,
        ...(status === 'ALL' ? {} : { status: status as LeaveRequestStatus }),
      };
      const [total, rows, pendingCount, today] = await Promise.all([
        tx.doctorLeaveRequest.count({ where }),
        tx.doctorLeaveRequest.findMany({
          where,
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            doctor: { select: { id: true, code: true, user: { select: { displayName: true } } } },
            decider: { select: { displayName: true } },
          },
        }),
        tx.doctorLeaveRequest.count({ where: { ...base, status: 'PENDING' } }),
        this.today(tx, actor.tenantId),
      ]);
      return {
        items: rows.map((r) => ({
          ...this.mine(r),
          doctor: { id: r.doctor.id, code: r.doctor.code, name: r.doctor.user.displayName },
          decidedByName: r.decider?.displayName ?? null,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        pendingCount,
        today,
      };
    });
  }

  /**
   * How many leave requests wait for a decision, in the branches the caller may decide for. It is the
   * number the Administration menu and the Leave requests button show (Phase 2.3); the route needs the
   * same permission as the list, so only people who can decide ever ask.
   */
  async pendingCount(actor: Actor): Promise<{ count: number }> {
    const scope = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => ({
      count: await tx.doctorLeaveRequest.count({
        where: { tenantId: actor.tenantId, doctor: this.inScope(scope), status: 'PENDING' },
      }),
    }));
  }

  /** Finds a request of a doctor in the Admin scope (404 otherwise), locks the doctor, re-reads it. */
  private async openForDecision(tx: TenantTx, actor: Actor, id: string, scope: Scope) {
    const first = await tx.doctorLeaveRequest.findFirst({
      where: { id, tenantId: actor.tenantId, doctor: this.inScope(scope) },
      select: { id: true, doctorProfileId: true },
    });
    if (!first) {
      throw opdError(404, OpdErrorCode.LEAVE_REQUEST_NOT_FOUND);
    }
    await this.lockDoctor(tx, first.doctorProfileId);
    // read AGAIN after the lock: a decision made a moment ago by someone else is now visible
    const request = await tx.doctorLeaveRequest.findFirstOrThrow({
      where: { id, tenantId: actor.tenantId },
    });
    if (request.status !== 'PENDING') {
      return conflict('ALREADY_DECIDED');
    }
    if (request.requestedBy === actor.userId) {
      throw opdError(403, OpdErrorCode.SELF_APPROVAL_FORBIDDEN);
    }
    return request;
  }

  async approve(actor: Actor, id: string): Promise<AdminLeaveRequestView> {
    const scope = await this.scope('opd.doctors.write');
    await this.tenantDb.withTenant(async (tx) => {
      const request = await this.openForDecision(tx, actor, id, scope);
      const today = await this.today(tx, actor.tenantId);
      const period = { fromDate: dateText(request.fromDate), toDate: dateText(request.toDate) };
      if (period.toDate < today) {
        return conflict('DATE_IN_PAST');
      }
      // The same rules as an Admin adding leave (overlap, number of periods): a refusal leaves the
      // request waiting, so the Admin can still reject it.
      const leaveId = await this.availability.createLeave(
        tx,
        actor,
        request.doctorProfileId,
        period,
        request.id,
      );
      await tx.doctorLeaveRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedBy: actor.userId,
          decidedAt: this.clock.now(),
          leaveId,
        },
      });
      await this.audit(tx, actor, id, 'APPROVE', {
        doctorProfileId: request.doctorProfileId,
        fromDate: period.fromDate,
        toDate: period.toDate,
        leaveId,
      });
    });
    return this.oneForAdmin(actor, id, scope);
  }

  async reject(actor: Actor, id: string): Promise<AdminLeaveRequestView> {
    const scope = await this.scope('opd.doctors.write');
    await this.tenantDb.withTenant(async (tx) => {
      const request = await this.openForDecision(tx, actor, id, scope);
      await tx.doctorLeaveRequest.update({
        where: { id },
        data: { status: 'REJECTED', decidedBy: actor.userId, decidedAt: this.clock.now() },
      });
      await this.audit(tx, actor, id, 'REJECT', {
        doctorProfileId: request.doctorProfileId,
        fromDate: dateText(request.fromDate),
        toDate: dateText(request.toDate),
      });
    });
    return this.oneForAdmin(actor, id, scope);
  }

  private async oneForAdmin(
    actor: Actor,
    id: string,
    scope: Scope,
  ): Promise<AdminLeaveRequestView> {
    return this.tenantDb.withTenant(async (tx) => {
      const r = await tx.doctorLeaveRequest.findFirstOrThrow({
        where: { id, tenantId: actor.tenantId, doctor: this.inScope(scope) },
        include: {
          doctor: { select: { id: true, code: true, user: { select: { displayName: true } } } },
          decider: { select: { displayName: true } },
        },
      });
      return {
        ...this.mine(r),
        doctor: { id: r.doctor.id, code: r.doctor.code, name: r.doctor.user.displayName },
        decidedByName: r.decider?.displayName ?? null,
      };
    });
  }
}
