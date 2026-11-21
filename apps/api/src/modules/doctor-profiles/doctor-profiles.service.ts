import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { clinicalError, ClinicalErrorCode } from '../opd-clinical/opd-clinical.errors';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { DOCTOR_PROFILE_LIMITS, parseDoctorProfile } from './doctor-profile.rules';

type Actor = { tenantId: string; userId: string };

const PROFILE_INCLUDE = {
  user: {
    select: {
      displayName: true,
      userBranches: {
        where: { isActive: true },
        select: { branch: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.DoctorProfileInclude;

type ProfileRow = Prisma.DoctorProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

export type DoctorProfileView = {
  id: string;
  code: string;
  /** The login name. */
  name: string;
  printedName: string | null;
  /** What prints: the printed name, or the login name when that is empty. */
  printName: string;
  department: string | null;
  qualifications: string | null;
  speciality: string | null;
  registrationNo: string | null;
  active: boolean;
  /** The branches this doctor works in (names), for the Admin list. */
  branches: string[];
  /** The details a prescription needs that are still empty (the reminder). */
  missing: Array<'qualifications' | 'speciality' | 'registrationNo'>;
};

export function toProfileView(row: ProfileRow): DoctorProfileView {
  const missing: DoctorProfileView['missing'] = [];
  if (!row.qualifications) missing.push('qualifications');
  if (!row.speciality) missing.push('speciality');
  if (!row.registrationNo) missing.push('registrationNo');
  return {
    id: row.id,
    code: row.code,
    name: row.user.displayName,
    printedName: row.printedName,
    printName: row.printedName ?? row.user.displayName,
    department: row.department,
    qualifications: row.qualifications,
    speciality: row.speciality,
    registrationNo: row.registrationNo,
    active: row.active,
    branches: row.user.userBranches.map((b) => b.branch.name).sort(),
    missing,
  };
}

const AUDIT = 'DOCTOR_PROFILE_CHANGE';

/**
 * Doctor profile details (Step 7c). A doctor edits their OWN profile (the profile is found from the
 * token's user, never from the request). An Admin lists and corrects doctors: a hospital-wide Admin
 * (SuperAdmin) every doctor of the hospital; a Branch Admin only doctors who work in a branch where
 * they hold the permission. A doctor outside that scope does not exist for the caller (404).
 */
@Injectable()
export class DoctorProfilesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
  ) {}

  async me(actor: Actor): Promise<DoctorProfileView & { limits: typeof DOCTOR_PROFILE_LIMITS }> {
    return this.tenantDb.withTenant(async (tx) => ({
      ...toProfileView(await this.own(tx, actor)),
      limits: DOCTOR_PROFILE_LIMITS,
    }));
  }

  async updateMe(
    actor: Actor,
    body: unknown,
  ): Promise<DoctorProfileView & { limits: typeof DOCTOR_PROFILE_LIMITS }> {
    const input = parseDoctorProfile(body, { allowDepartment: false });
    return this.tenantDb.withTenant(async (tx) => {
      const own = await this.own(tx, actor);
      await tx.doctorProfile.update({ where: { id: own.id }, data: input });
      await this.audit(tx, actor, own.id, Object.keys(input), true);
      return {
        ...toProfileView(await this.byId(tx, actor, own.id)),
        limits: DOCTOR_PROFILE_LIMITS,
      };
    });
  }

  async list(actor: Actor): Promise<{
    items: DoctorProfileView[];
    limits: typeof DOCTOR_PROFILE_LIMITS;
    canWrite: boolean;
  }> {
    const scope = await this.scope('opd.doctors.read');
    const writeScope = await this.scope('opd.doctors.write');
    const canWrite = writeScope.wide || writeScope.branches.length > 0;
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.doctorProfile.findMany({
        where: { tenantId: actor.tenantId, ...this.inScope(scope) },
        include: PROFILE_INCLUDE,
        orderBy: [{ code: 'asc' }],
      });
      return { items: rows.map(toProfileView), limits: DOCTOR_PROFILE_LIMITS, canWrite };
    });
  }

  async updateByAdmin(actor: Actor, id: string, body: unknown): Promise<DoctorProfileView> {
    const input = parseDoctorProfile(body, { allowDepartment: true });
    const scope = await this.scope('opd.doctors.write');
    return this.tenantDb.withTenant(async (tx) => {
      const found = await tx.doctorProfile.findFirst({
        where: { id, tenantId: actor.tenantId, ...this.inScope(scope) },
        select: { id: true },
      });
      if (!found) {
        throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
      }
      await tx.doctorProfile.update({ where: { id }, data: input });
      await this.audit(tx, actor, id, Object.keys(input), false);
      return toProfileView(await this.byId(tx, actor, id));
    });
  }

  // ---------------------------------------------------------------------------- helpers

  /** Which doctors a permission reaches: everyone (hospital-wide) or doctors of its branches. */
  private async scope(code: string): Promise<{ wide: boolean; branches: string[] }> {
    const wide = (await this.access.hospitalWideBranches(code, 'OPD')).length > 0;
    const branches = wide ? [] : await this.access.permittedBranches(code, 'OPD');
    return { wide, branches };
  }

  private inScope(scope: { wide: boolean; branches: string[] }): Prisma.DoctorProfileWhereInput {
    if (scope.wide) {
      return {};
    }
    return {
      user: {
        userBranches: { some: { isActive: true, branchId: { in: scope.branches } } },
      },
    };
  }

  private async own(tx: TenantTx, actor: Actor): Promise<ProfileRow> {
    const row = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId, active: true },
      include: PROFILE_INCLUDE,
    });
    if (!row) {
      throw clinicalError(403, ClinicalErrorCode.DOCTOR_PROFILE_REQUIRED);
    }
    return row;
  }

  private async byId(tx: TenantTx, actor: Actor, id: string): Promise<ProfileRow> {
    return tx.doctorProfile.findFirstOrThrow({
      where: { id, tenantId: actor.tenantId },
      include: PROFILE_INCLUDE,
    });
  }

  /** The audit trail keeps which fields changed, never what was typed. */
  private async audit(
    tx: TenantTx,
    actor: Actor,
    doctorProfileId: string,
    changed: string[],
    self: boolean,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: AUDIT,
        entityType: 'doctor_profiles',
        entityId: doctorProfileId,
        reason: self ? 'Doctor updated their own profile' : 'Admin corrected a doctor profile',
        metadata: { changed, self },
      },
    });
  }
}
