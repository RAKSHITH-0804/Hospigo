import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { AuthEmailService } from '../auth/auth-email.service';
import { AuthRateLimitedError, AuthRedisService } from '../auth/auth-redis.service';
import { PasswordService } from '../auth/password.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { RolesService } from './roles.service';
import { StaffCodeService, type StaffCodeFormat } from './staff-code.service';
import {
  BRANCH_ADMIN_ROLE_CODE,
  DOCTOR_CODE_PREFIX,
  DOCTOR_CODE_WIDTH,
  DOCTOR_PERMISSION_CODE,
  STAFF_LIMITS,
  INDIGO_ROLE_CODES,
  SUPER_ADMIN_ROLE_CODE,
} from './staff.config';
import {
  isRecord,
  readAssignments,
  readEmail,
  readIds,
  readPhone,
  readText,
  refuse,
  StaffReason,
  type AssignmentInput,
} from './staff.rules';

type Actor = { tenantId: string; userId: string };
type Scope = { wide: boolean; branchIds: string[] };

const USER_INCLUDE = {
  userBranches: {
    where: { isActive: true },
    include: { branch: { select: { id: true, name: true } } },
  },
  roleAssignments: {
    where: { isActive: true },
    include: {
      role: { select: { id: true, code: true, name: true, isSystem: true } },
      branches: { where: { isActive: true }, select: { branchId: true } },
    },
  },
  doctorProfiles: { select: { id: true, code: true, active: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

export type StaffStatus = 'ACTIVE' | 'INVITED' | 'INACTIVE';

export type StaffView = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  status: StaffStatus;
  branches: Array<{ id: string; name: string }>;
  roles: Array<{
    assignmentId: string;
    roleId: string;
    code: string;
    name: string;
    isSystem: boolean;
    scope: 'BRANCH' | 'HOSPITAL';
    branchIds: string[];
  }>;
  doctorCode: string | null;
  lastLoginAt: string | null;
  /** The caller may change this person (their branches are all within the caller's scope). */
  editable: boolean;
  isYou: boolean;
};

function statusOf(row: { isActive: boolean; passwordChangedAt: Date | null }): StaffStatus {
  if (!row.isActive) return 'INACTIVE';
  return row.passwordChangedAt === null ? 'INVITED' : 'ACTIVE';
}

/**
 * Staff of a hospital (Step 7d). A SuperAdmin (hospital-wide `user.write`) manages everyone; a Branch
 * Admin only people whose branches are all branches the Branch Admin holds the permission on and who
 * hold no hospital-wide role. Rules enforced here, not in the screen: nobody changes their own roles
 * or branches or switches themselves off, the last SuperAdmin stays, only a hospital-wide Admin gives
 * the system roles or a hospital-wide scope, and a role is only given when every permission in it
 * may be given by the caller (held, or a daily-work permission). Nothing is deleted: a person is
 * switched off, their sessions end at once, and the history stays.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    private readonly roles: RolesService,
    private readonly codes: StaffCodeService,
    private readonly passwords: PasswordService,
    private readonly authEmail: AuthEmailService,
    private readonly redis: AuthRedisService,
  ) {}

  // ----------------------------------------------------------------------------- read

  async list(
    actor: Actor,
    query: { q?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<{ items: StaffView[]; total: number; page: number; pageSize: number }> {
    const readScope = await this.scope('user.read');
    const writeScope = await this.scope('user.write');
    const q = (query.q ?? '').trim().slice(0, STAFF_LIMITS.searchMax);
    const pageSize = Math.min(
      Math.max(Math.trunc(query.pageSize ?? STAFF_LIMITS.pageSizeDefault), 1),
      STAFF_LIMITS.pageSizeMax,
    );
    const page = Math.max(Math.trunc(query.page ?? 1), 1);
    const where: Prisma.UserWhereInput = {
      tenantId: actor.tenantId,
      // the hidden users that stand for Indigo people are never listed or counted (Step 2.1b)
      indigoHqUserId: null,
      ...(readScope.wide
        ? {}
        : {
            userBranches: { some: { isActive: true, branchId: { in: readScope.branchIds } } },
          }),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.status === 'INACTIVE' ? { isActive: false } : {}),
      ...(query.status === 'ACTIVE' ? { isActive: true, passwordChangedAt: { not: null } } : {}),
      ...(query.status === 'INVITED' ? { isActive: true, passwordChangedAt: null } : {}),
    };
    return this.tenantDb.withTenant(async (tx) => {
      const [total, rows] = await Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          include: USER_INCLUDE,
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        items: rows.map((r) => toView(r, this.manageable(r, writeScope), actor.userId)),
        total,
        page,
        pageSize,
      };
    });
  }

  /** What the "Add staff" form may offer this caller: roles, branches, hospital scope, code format. */
  async options(actor: Actor): Promise<{
    roles: Array<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      assignable: boolean;
      reason: string | null;
    }>;
    branches: Array<{ id: string; name: string }>;
    canHospitalScope: boolean;
    canWrite: boolean;
    codeFormat: StaffCodeFormat;
    limits: { nameMax: number; emailMax: number; phoneMax: number; maxRolesPerPerson: number };
  }> {
    const write = await this.scope('user.write');
    const canWrite = write.wide || write.branchIds.length > 0;
    const codeFormat = await this.codes.get(actor.tenantId);
    return this.tenantDb.withTenant(async (tx) => {
      const branches = (await this.activeBranches(tx, actor.tenantId)).filter(
        (b) => write.wide || write.branchIds.includes(b.id),
      );
      const roles = await tx.role.findMany({
        where: {
          tenantId: actor.tenantId,
          isActive: true,
          code: { notIn: [...INDIGO_ROLE_CODES] },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      const allBranchIds = (await this.activeBranches(tx, actor.tenantId)).map((b) => b.id);
      const out = [];
      for (const role of roles) {
        let reason: string | null = null;
        if (role.isSystem && !write.wide) {
          reason = 'SYSTEM_ROLE';
        } else if (!role.isSystem) {
          const codes = await this.roles.codesOfRole(tx, actor.tenantId, role.id);
          const failing = await this.roles.grantable(
            codes,
            write.wide ? allBranchIds : write.branchIds,
          );
          reason = failing ? 'NOT_GRANTABLE' : null;
        }
        out.push({
          id: role.id,
          code: role.code,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          assignable: reason === null && canWrite,
          reason,
        });
      }
      return {
        roles: out,
        branches,
        canHospitalScope: write.wide,
        canWrite,
        codeFormat,
        limits: {
          nameMax: STAFF_LIMITS.nameMax,
          emailMax: STAFF_LIMITS.emailMax,
          phoneMax: STAFF_LIMITS.phoneMax,
          maxRolesPerPerson: STAFF_LIMITS.maxRolesPerPerson,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------- create

  async create(
    actor: Actor,
    body: unknown,
  ): Promise<{ staff: StaffView; activationSent: boolean }> {
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const name = readText(body.name, 'name', STAFF_LIMITS.nameMax);
    const email = readEmail(body.email);
    const phone = body.phone === undefined ? null : readPhone(body.phone);
    const branchIds = readIds(body.branchIds, 'branchIds', 50);
    const assignments = readAssignments(body.roles);
    const scope = await this.scope('user.write');

    const created = await this.clash(() =>
      this.tenantDb.withTenant(async (tx) => {
        const branches = await this.activeBranches(tx, actor.tenantId);
        this.checkBranches(branchIds, branches, scope);
        await this.requireFreeEmail(tx, actor.tenantId, email, null);
        const rolePlan = await this.planRoles(tx, actor, assignments, branchIds, branches, scope);
        const code = await this.codes.next(tx, actor.tenantId);
        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            code,
            email,
            displayName: name,
            phone,
            passwordHash: await this.passwords.hashTrusted(randomBytes(24).toString('base64url')),
            mustChangePassword: true,
          },
        });
        await tx.userBranch.createMany({
          data: branchIds.map((branchId) => ({
            tenantId: actor.tenantId,
            userId: user.id,
            branchId,
          })),
        });
        await this.writeAssignments(tx, actor.tenantId, user.id, rolePlan);
        if (rolePlan.some((r) => r.codes.includes(DOCTOR_PERMISSION_CODE))) {
          await this.ensureDoctorProfile(tx, actor.tenantId, user.id);
        }
        await this.audit(tx, actor, 'STAFF_CREATE', user.id, {
          roles: rolePlan.map((r) => r.role.code),
          branches: branchIds.length,
        });
        return user.id;
      }),
    );
    let activationSent = true;
    try {
      await this.authEmail.sendActivation(actor.tenantId, created);
    } catch (error) {
      activationSent = false;
      this.logger.warn(`Activation email could not be queued: ${(error as Error).message}`);
    }
    return { staff: await this.view(actor, created), activationSent };
  }

  // ----------------------------------------------------------------------------- update

  async update(actor: Actor, id: string, body: unknown): Promise<StaffView> {
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const name =
      body.name === undefined ? undefined : readText(body.name, 'name', STAFF_LIMITS.nameMax);
    const email = body.email === undefined ? undefined : readEmail(body.email);
    const phone = body.phone === undefined ? undefined : readPhone(body.phone);
    const hasBranches = body.branchIds !== undefined;
    const hasRoles = body.roles !== undefined;
    if (hasBranches !== hasRoles) {
      refuse(hasBranches ? 'roles' : 'branchIds', StaffReason.REQUIRED);
    }
    const branchIds = hasBranches ? readIds(body.branchIds, 'branchIds', 50) : undefined;
    const assignments = hasRoles ? readAssignments(body.roles) : undefined;
    if (
      name === undefined &&
      email === undefined &&
      phone === undefined &&
      branchIds === undefined
    ) {
      refuse('body', StaffReason.REQUIRED);
    }
    const scope = await this.scope('user.write');

    await this.clash(() =>
      this.tenantDb.withTenant(async (tx) => {
        const target = await this.target(tx, actor, id, scope);
        const isYou = target.id === actor.userId;
        if (isYou && hasRoles) {
          throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'SELF' });
        }
        if (email !== undefined) {
          await this.requireFreeEmail(tx, actor.tenantId, email, id);
        }
        const changed: string[] = [];
        let revoke: string[] = [];
        if (branchIds && assignments) {
          const branches = await this.activeBranches(tx, actor.tenantId);
          this.checkBranches(branchIds, branches, scope);
          const rolePlan = await this.planRoles(tx, actor, assignments, branchIds, branches, scope);
          const hadSuper = target.roleAssignments.some(
            (a) => a.role.code === SUPER_ADMIN_ROLE_CODE,
          );
          const keepsSuper = rolePlan.some((r) => r.role.code === SUPER_ADMIN_ROLE_CODE);
          if (hadSuper && !keepsSuper) {
            await this.requireAnotherSuperAdmin(tx, actor.tenantId, id);
          }
          const before = new Set(target.userBranches.map((b) => b.branchId));
          const after = new Set(branchIds);
          revoke = [...before].filter((b) => !after.has(b));
          for (const branchId of before) {
            if (!after.has(branchId)) {
              await tx.userBranch.updateMany({
                where: { tenantId: actor.tenantId, userId: id, branchId },
                data: { isActive: false },
              });
            }
          }
          for (const branchId of after) {
            await tx.userBranch.upsert({
              where: {
                tenantId_userId_branchId: { tenantId: actor.tenantId, userId: id, branchId },
              },
              create: { tenantId: actor.tenantId, userId: id, branchId },
              update: { isActive: true },
            });
          }
          await tx.roleAssignment.updateMany({
            where: { tenantId: actor.tenantId, userId: id, isActive: true },
            data: { isActive: false },
          });
          await this.writeAssignments(tx, actor.tenantId, id, rolePlan);
          if (rolePlan.some((r) => r.codes.includes(DOCTOR_PERMISSION_CODE))) {
            await this.ensureDoctorProfile(tx, actor.tenantId, id);
          }
          changed.push('branches', 'roles');
        }
        await tx.user.update({
          where: { id },
          data: {
            ...(name !== undefined ? { displayName: name } : {}),
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
          },
        });
        if (name !== undefined) changed.push('name');
        if (email !== undefined) changed.push('email');
        if (phone !== undefined) changed.push('phone');
        if (revoke.length > 0) {
          await tx.authSession.updateMany({
            where: {
              tenantId: actor.tenantId,
              userId: id,
              revokedAt: null,
              branchId: { in: revoke },
            },
            data: { revokedAt: new Date() },
          });
        }
        await this.audit(tx, actor, 'STAFF_CHANGE', id, { changed, self: isYou });
      }),
    );
    return this.view(actor, id);
  }

  // ------------------------------------------------------------- switch off, on, resend

  async setActive(actor: Actor, id: string, active: boolean): Promise<StaffView> {
    const scope = await this.scope('user.write');
    await this.tenantDb.withTenant(async (tx) => {
      const target = await this.target(tx, actor, id, scope);
      if (!active) {
        if (target.id === actor.userId) {
          throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'SELF' });
        }
        if (target.roleAssignments.some((a) => a.role.code === SUPER_ADMIN_ROLE_CODE)) {
          await this.requireAnotherSuperAdmin(tx, actor.tenantId, id);
        }
      }
      await tx.user.update({ where: { id }, data: { isActive: active } });
      if (!active) {
        await tx.authSession.updateMany({
          where: { tenantId: actor.tenantId, userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit(tx, actor, active ? 'STAFF_REACTIVATE' : 'STAFF_DEACTIVATE', id, {});
    });
    return this.view(actor, id);
  }

  /** A new activation email for a person who has not set a password yet. One a minute. */
  async resendInvite(actor: Actor, id: string): Promise<{ activationSent: boolean }> {
    const scope = await this.scope('user.write');
    await this.tenantDb.withTenant(async (tx) => {
      const target = await this.target(tx, actor, id, scope);
      if (!target.isActive) {
        throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'INACTIVE' });
      }
      if (target.passwordChangedAt !== null) {
        throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'ALREADY_ACTIVE' });
      }
    });
    const key = createHash('sha256').update(`invite|${actor.tenantId}|${id}`).digest('hex');
    try {
      await this.redis.assertOtpResendAllowed(key);
      await this.redis.markOtpResendCooldown(key);
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        throw opdError(429, OpdErrorCode.RATE_LIMITED, { retryAfterSec: error.retryAfterSec });
      }
      throw error;
    }
    await this.authEmail.sendActivation(actor.tenantId, id);
    await this.tenantDb.withTenant((tx) => this.audit(tx, actor, 'STAFF_INVITE_RESEND', id, {}));
    return { activationSent: true };
  }

  // ----------------------------------------------------------------------------- helpers

  private async scope(code: string): Promise<Scope> {
    const wide = (await this.access.hospitalWideBranches(code)).length > 0;
    const branchIds = wide ? [] : await this.access.permittedBranches(code);
    return { wide, branchIds };
  }

  /** May the caller change this person? Everyone for a hospital-wide Admin; else only a person of own branches only. */
  private manageable(row: UserRow, scope: Scope): boolean {
    if (scope.wide) return true;
    if (row.roleAssignments.some((a) => a.scopeType === 'HOSPITAL')) return false;
    return (
      row.userBranches.length > 0 &&
      row.userBranches.every((b) => scope.branchIds.includes(b.branchId))
    );
  }

  private async target(tx: TenantTx, actor: Actor, id: string, scope: Scope): Promise<UserRow> {
    const row = await tx.user.findFirst({
      // an Indigo user cannot be opened, changed, switched off or given roles by hospital users
      where: { id, tenantId: actor.tenantId, indigoHqUserId: null },
      include: USER_INCLUDE,
    });
    if (!row || !this.manageable(row, scope)) {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    return row;
  }

  private async view(actor: Actor, id: string): Promise<StaffView> {
    const scope = await this.scope('user.write');
    return this.tenantDb.withTenant(async (tx) => {
      const row = await tx.user.findFirstOrThrow({
        where: { id, tenantId: actor.tenantId },
        include: USER_INCLUDE,
      });
      return toView(row, this.manageable(row, scope), actor.userId);
    });
  }

  private async activeBranches(tx: TenantTx, tenantId: string) {
    return tx.branch.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  private checkBranches(ids: string[], branches: Array<{ id: string }>, scope: Scope): void {
    const known = new Set(branches.map((b) => b.id));
    ids.forEach((id, index) => {
      if (!known.has(id)) {
        refuse(`branchIds.${index}`, StaffReason.INVALID);
      }
      if (!scope.wide && !scope.branchIds.includes(id)) {
        refuse(`branchIds.${index}`, StaffReason.NOT_ALLOWED);
      }
    });
  }

  private async requireFreeEmail(
    tx: TenantTx,
    tenantId: string,
    email: string,
    exceptUserId: string | null,
  ): Promise<void> {
    const taken = await tx.user.findFirst({
      where: {
        tenantId,
        email: { equals: email, mode: 'insensitive' },
        ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      refuse('email', StaffReason.DUPLICATE);
    }
  }

  /** Checks every role the person is to get and returns what to write. */
  private async planRoles(
    tx: TenantTx,
    actor: Actor,
    assignments: AssignmentInput[],
    branchIds: string[],
    branches: Array<{ id: string }>,
    scope: Scope,
  ) {
    const roles = await tx.role.findMany({
      where: {
        tenantId: actor.tenantId,
        id: { in: assignments.map((a) => a.roleId) },
        isActive: true,
        // hospital users can never give the Indigo roles (they look like roles that do not exist)
        code: { notIn: [...INDIGO_ROLE_CODES] },
      },
    });
    const byId = new Map(roles.map((r) => [r.id, r]));
    const everyBranch = branches.map((b) => b.id);
    const plan = [];
    for (const [index, a] of assignments.entries()) {
      const role = byId.get(a.roleId);
      if (!role) {
        refuse(`roles.${index}.roleId`, StaffReason.INVALID);
      }
      let scopeType = a.scope;
      if (role.code === SUPER_ADMIN_ROLE_CODE) {
        scopeType = 'HOSPITAL';
      }
      if ((role.isSystem || scopeType === 'HOSPITAL') && !scope.wide) {
        refuse(`roles.${index}.roleId`, StaffReason.NOT_ALLOWED);
      }
      if (role.code === BRANCH_ADMIN_ROLE_CODE && scopeType === 'HOSPITAL') {
        refuse(`roles.${index}.scope`, StaffReason.INVALID);
      }
      const codes = await this.roles.codesOfRole(tx, actor.tenantId, role.id);
      const failing = await this.roles.grantable(
        codes,
        scopeType === 'HOSPITAL' ? everyBranch : branchIds,
      );
      if (failing) {
        refuse(`roles.${index}.roleId`, StaffReason.NOT_ALLOWED);
      }
      plan.push({ role, scopeType, codes });
    }
    return plan;
  }

  private async writeAssignments(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    plan: Array<{ role: { id: string }; scopeType: 'BRANCH' | 'HOSPITAL' }>,
  ): Promise<void> {
    const branchIds = (
      await tx.userBranch.findMany({ where: { tenantId, userId, isActive: true } })
    ).map((b) => b.branchId);
    for (const item of plan) {
      const assignment = await tx.roleAssignment.create({
        data: { tenantId, userId, roleId: item.role.id, scopeType: item.scopeType },
      });
      if (item.scopeType === 'BRANCH') {
        await tx.roleAssignmentBranch.createMany({
          data: branchIds.map((branchId) => ({ tenantId, assignmentId: assignment.id, branchId })),
        });
      }
    }
  }

  private async ensureDoctorProfile(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
    const existing = await tx.doctorProfile.findFirst({ where: { tenantId, userId } });
    if (existing) {
      if (!existing.active) {
        await tx.doctorProfile.update({ where: { id: existing.id }, data: { active: true } });
      }
      return;
    }
    const rows = await tx.doctorProfile.findMany({
      where: { tenantId, code: { startsWith: DOCTOR_CODE_PREFIX } },
      select: { code: true },
    });
    let max = 0;
    for (const row of rows) {
      const match = new RegExp(`^${DOCTOR_CODE_PREFIX}(\\d+)$`, 'i').exec(row.code);
      if (match) max = Math.max(max, Number(match[1]));
    }
    await tx.doctorProfile.create({
      data: {
        tenantId,
        userId,
        code: `${DOCTOR_CODE_PREFIX}${String(max + 1).padStart(DOCTOR_CODE_WIDTH, '0')}`,
      },
    });
  }

  /** At least one other active SuperAdmin must remain. */
  private async requireAnotherSuperAdmin(
    tx: TenantTx,
    tenantId: string,
    exceptUserId: string,
  ): Promise<void> {
    const others = await tx.user.count({
      where: {
        tenantId,
        isActive: true,
        NOT: { id: exceptUserId },
        roleAssignments: {
          some: { isActive: true, scopeType: 'HOSPITAL', role: { code: SUPER_ADMIN_ROLE_CODE } },
        },
      },
    });
    if (others < 1) {
      throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'LAST_SUPER_ADMIN' });
    }
  }

  /** Two people making the same change at once: the database refuses the second, in plain words. */
  private async clash<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const err = error as { code?: string; meta?: { target?: unknown } };
      if (err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        if (target.includes('email')) {
          refuse('email', StaffReason.DUPLICATE);
        }
        throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'TRY_AGAIN' });
      }
      throw error;
    }
  }

  /** The audit trail keeps what kind of change it was, never names, emails or phone numbers. */
  private async audit(
    tx: TenantTx,
    actor: Actor,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entityType: 'users',
        entityId,
        reason: 'Staff updated',
        metadata: metadata as object,
      },
    });
  }
}

function toView(row: UserRow, editable: boolean, actorUserId: string): StaffView {
  return {
    id: row.id,
    code: row.code,
    name: row.displayName,
    email: row.email,
    phone: row.phone,
    status: statusOf(row),
    branches: row.userBranches
      .map((b) => ({ id: b.branch.id, name: b.branch.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: row.roleAssignments.map((a) => ({
      assignmentId: a.id,
      roleId: a.roleId,
      code: a.role.code,
      name: a.role.name,
      isSystem: a.role.isSystem,
      scope: a.scopeType,
      branchIds: a.branches.map((b) => b.branchId),
    })),
    doctorCode: row.doctorProfiles[0]?.code ?? null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    editable,
    isYou: row.id === actorUserId,
  };
}
