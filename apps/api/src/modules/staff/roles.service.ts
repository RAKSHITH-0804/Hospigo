import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import {
  FLOOR_PERMISSION_CODES,
  ROLE_TEMPLATES,
  STAFF_LIMITS,
  BRANCH_ADMIN_ROLE_CODE,
  INDIGO_ROLE_CODES,
  SUPER_ADMIN_ROLE_CODE,
} from './staff.config';
import { isRecord, readText, refuse, StaffReason } from './staff.rules';

type Actor = { tenantId: string; userId: string };

export type RoleView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionCodes: string[];
  assignedCount: number;
};

export type CatalogPermission = { code: string; description: string; group: string };

const ROLE_INCLUDE = {
  permissions: { where: { isActive: true }, include: { permission: { select: { code: true } } } },
  _count: { select: { roleAssignments: { where: { isActive: true } } } },
} as const;

function slugOf(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (slug || 'ROLE').slice(0, 30);
}

/**
 * Roles of a hospital. The two system roles (SuperAdmin, Branch Admin) are read only. A SuperAdmin
 * (hospital-wide `role.write`) makes and changes the hospital's own roles by ticking permissions.
 * Nobody can give a permission they do not hold, except the daily-work permissions of the floor
 * (see `FLOOR_PERMISSION_CODES`), which the Admin roles are kept away from on purpose.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
  ) {}

  async list(actor: Actor): Promise<{
    items: RoleView[];
    canWrite: boolean;
    limits: { nameMax: number; descriptionMax: number; maxCustomRoles: number };
  }> {
    const canWrite = await this.isWide('role.write');
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.role.findMany({
        // the Indigo roles are never shown to hospital users
        where: { tenantId: actor.tenantId, code: { notIn: [...INDIGO_ROLE_CODES] } },
        include: ROLE_INCLUDE,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return {
        items: rows.map(toRoleView),
        canWrite,
        limits: {
          nameMax: STAFF_LIMITS.roleNameMax,
          descriptionMax: STAFF_LIMITS.roleDescriptionMax,
          maxCustomRoles: STAFF_LIMITS.maxCustomRoles,
        },
      };
    });
  }

  /** Every permission with its plain description, grouped by its first word. */
  async catalog(): Promise<{ items: CatalogPermission[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.permission.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
      return {
        items: rows.map((p) => ({
          code: p.code,
          description: p.description ?? p.code,
          group: p.code.split('.')[0]!,
        })),
      };
    });
  }

  async templates(): Promise<{
    items: Array<{ key: string; name: string; description: string; permissionCodes: string[] }>;
  }> {
    const known = new Set((await this.catalog()).items.map((p) => p.code));
    return {
      items: ROLE_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        permissionCodes: t.permissions.filter((code) => known.has(code)),
      })),
    };
  }

  async create(actor: Actor, body: unknown): Promise<RoleView> {
    await this.requireWide();
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const name = readText(body.name, 'name', STAFF_LIMITS.roleNameMax);
    const description =
      readText(body.description, 'description', STAFF_LIMITS.roleDescriptionMax, false) || null;
    const permissionCodes = this.readPermissionCodes(body.permissionCodes);

    const id = await this.tenantDb.withTenant(async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId: actor.tenantId },
        select: { code: true, name: true, isSystem: true },
      });
      if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        refuse('name', StaffReason.DUPLICATE);
      }
      if (roles.filter((r) => !r.isSystem).length >= STAFF_LIMITS.maxCustomRoles) {
        refuse('name', StaffReason.TOO_MANY);
      }
      const permissionIds = await this.permissionIds(tx, permissionCodes);
      await this.requireGrantable(permissionCodes);
      const taken = new Set(roles.map((r) => r.code));
      const base = `CUSTOM_${slugOf(name)}`;
      let code = base;
      for (let n = 2; taken.has(code); n++) {
        code = `${base}_${n}`;
      }
      const role = await tx.role.create({
        data: { tenantId: actor.tenantId, code, name, description, isSystem: false },
      });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          tenantId: actor.tenantId,
          roleId: role.id,
          permissionId,
        })),
      });
      await this.audit(tx, actor, 'ROLE_CREATE', role.id, {
        permissionCount: permissionIds.length,
      });
      return role.id;
    });
    return this.one(actor, id);
  }

  async update(actor: Actor, id: string, body: unknown): Promise<RoleView> {
    await this.requireWide();
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const name =
      body.name === undefined ? undefined : readText(body.name, 'name', STAFF_LIMITS.roleNameMax);
    const description =
      body.description === undefined
        ? undefined
        : readText(body.description, 'description', STAFF_LIMITS.roleDescriptionMax, false) || null;
    const permissionCodes =
      body.permissionCodes === undefined
        ? undefined
        : this.readPermissionCodes(body.permissionCodes);
    if (name === undefined && description === undefined && permissionCodes === undefined) {
      refuse('body', StaffReason.REQUIRED);
    }

    await this.tenantDb.withTenant(async (tx) => {
      const role = await this.customRole(tx, actor, id);
      if (name !== undefined) {
        const others = await tx.role.findMany({
          where: { tenantId: actor.tenantId, NOT: { id } },
          select: { name: true },
        });
        if (others.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          refuse('name', StaffReason.DUPLICATE);
        }
      }
      let added = 0;
      let removed = 0;
      if (permissionCodes !== undefined) {
        const wanted = await this.permissionIds(tx, permissionCodes);
        await this.requireGrantable(permissionCodes);
        const current = await tx.rolePermission.findMany({ where: { roleId: id } });
        const wantedSet = new Set(wanted);
        for (const row of current) {
          const keep = wantedSet.has(row.permissionId);
          if (row.isActive && !keep) {
            await tx.rolePermission.update({ where: { id: row.id }, data: { isActive: false } });
            removed += 1;
          } else if (!row.isActive && keep) {
            await tx.rolePermission.update({ where: { id: row.id }, data: { isActive: true } });
            added += 1;
          }
        }
        const have = new Set(current.map((r) => r.permissionId));
        const fresh = wanted.filter((p) => !have.has(p));
        if (fresh.length > 0) {
          await tx.rolePermission.createMany({
            data: fresh.map((permissionId) => ({
              tenantId: actor.tenantId,
              roleId: id,
              permissionId,
            })),
          });
          added += fresh.length;
        }
      }
      await tx.role.update({
        where: { id: role.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });
      await this.audit(tx, actor, 'ROLE_CHANGE', id, {
        changed: [
          ...(name !== undefined ? ['name'] : []),
          ...(description !== undefined ? ['description'] : []),
          ...(permissionCodes !== undefined ? ['permissions'] : []),
        ],
        added,
        removed,
      });
    });
    return this.one(actor, id);
  }

  /** A role nobody holds can be switched off (and on again). Roles in use are never switched off. */
  async setActive(actor: Actor, id: string, active: boolean): Promise<RoleView> {
    await this.requireWide();
    await this.tenantDb.withTenant(async (tx) => {
      const role = await this.customRole(tx, actor, id);
      if (!active) {
        const inUse = await tx.roleAssignment.count({
          where: { tenantId: actor.tenantId, roleId: id, isActive: true },
        });
        if (inUse > 0) {
          throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'ROLE_IN_USE' });
        }
      }
      await tx.role.update({ where: { id: role.id }, data: { isActive: active } });
      await this.audit(tx, actor, active ? 'ROLE_ACTIVATE' : 'ROLE_DEACTIVATE', id, {});
    });
    return this.one(actor, id);
  }

  // ---------------------------------------------------------------------------- helpers

  /** The permission codes of a role (active ones), for the grant check when staff get the role. */
  async codesOfRole(tx: TenantTx, tenantId: string, roleId: string): Promise<string[]> {
    const rows = await tx.rolePermission.findMany({
      where: { tenantId, roleId, isActive: true },
      include: { permission: { select: { code: true } } },
    });
    return rows.map((r) => r.permission.code);
  }

  /**
   * May the caller give these permissions on these branches? Each one must be held on every branch,
   * unless it is a daily-work permission of the floor. `branchIds` is every active branch for a
   * hospital-wide role.
   */
  async grantable(codes: readonly string[], branchIds: readonly string[]): Promise<string | null> {
    for (const code of codes) {
      if (FLOOR_PERMISSION_CODES.includes(code)) {
        continue;
      }
      // permittedBranches ignores the branch the token is narrowed to: a grant is judged on every branch
      const held = new Set(await this.access.permittedBranches(code));
      if (!branchIds.every((id) => held.has(id))) {
        return code;
      }
    }
    return null;
  }

  private async requireGrantable(codes: readonly string[]): Promise<void> {
    const all = await this.access.hospitalWideBranches('role.write');
    const failing = await this.grantable(codes, all);
    if (failing) {
      refuse('permissionCodes', StaffReason.NOT_ALLOWED);
    }
  }

  private async isWide(code: string): Promise<boolean> {
    return (await this.access.hospitalWideBranches(code)).length > 0;
  }

  private async requireWide(): Promise<void> {
    if (!(await this.isWide('role.write'))) {
      throw new ForbiddenException();
    }
  }

  private readPermissionCodes(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      refuse('permissionCodes', StaffReason.REQUIRED);
    }
    if (value.length > STAFF_LIMITS.maxPermissionsPerRole) {
      refuse('permissionCodes', StaffReason.TOO_MANY);
    }
    const out: string[] = [];
    for (const [index, code] of value.entries()) {
      if (typeof code !== 'string' || !/^[a-z][a-z0-9_.]{1,60}$/.test(code)) {
        refuse(`permissionCodes.${index}`, StaffReason.INVALID);
      }
      if (out.includes(code)) {
        refuse('permissionCodes', StaffReason.DUPLICATE);
      }
      out.push(code);
    }
    return out;
  }

  private async permissionIds(tx: TenantTx, codes: string[]): Promise<string[]> {
    const rows = await tx.permission.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    const byCode = new Map(rows.map((r) => [r.code, r.id]));
    return codes.map((code, index) => {
      const id = byCode.get(code);
      if (!id) {
        refuse(`permissionCodes.${index}`, StaffReason.UNKNOWN);
      }
      return id;
    });
  }

  private async customRole(tx: TenantTx, actor: Actor, id: string) {
    const role = await tx.role.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!role) {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    if (role.isSystem || [SUPER_ADMIN_ROLE_CODE, BRANCH_ADMIN_ROLE_CODE].includes(role.code)) {
      throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'SYSTEM_ROLE' });
    }
    return role;
  }

  private async one(actor: Actor, id: string): Promise<RoleView> {
    return this.tenantDb.withTenant(async (tx) =>
      toRoleView(
        await tx.role.findFirstOrThrow({
          where: { id, tenantId: actor.tenantId },
          include: ROLE_INCLUDE,
        }),
      ),
    );
  }

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
        entityType: 'roles',
        entityId,
        reason: 'Role updated',
        metadata: metadata as object,
      },
    });
  }
}

function toRoleView(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissions: Array<{ permission: { code: string } }>;
  _count: { roleAssignments: number };
}): RoleView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    isActive: row.isActive,
    permissionCodes: row.permissions.map((p) => p.permission.code).sort(),
    assignedCount: row._count.roleAssignments,
  };
}
