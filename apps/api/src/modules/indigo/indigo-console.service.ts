import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { ensureSystemRolesForTenant } from '../../database/system-roles';
import { TenantDb } from '../../database/tenant-db';
import type { PrismaClient } from '../../generated/prisma';
import { HQ_PERMISSIONS, HqPermissionsService, type HqPermission } from './hq-permissions.service';
import { HqScopeService } from './hq-scope.service';

/** Limits of what the console accepts (checked again by the database where it can). */
export const INDIGO_LIMITS = {
  hospitalCodeMax: 32,
  nameMax: 120,
  branchesMax: 20,
  accessCodeMin: 6,
  accessCodeMax: 40,
  emailMax: 200,
  passwordLength: 14,
} as const;

const HOSPITAL_CODE = /^[A-Z][A-Z0-9_]{2,31}$/;
const BRANCH_CODE = /^[A-Z][A-Z0-9_]{0,15}$/;
const ACCESS_CODE = /^[a-z0-9][a-z0-9-]{5,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(field: string, reason: string): never {
  throw new HttpException({ statusCode: 400, code: 'INDIGO_INVALID', field, reason }, 400);
}
function conflict(field: string, reason: string): never {
  throw new HttpException({ statusCode: 409, code: 'INDIGO_CONFLICT', field, reason }, 409);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) {
    invalid(field, 'INVALID');
  }
  return (value as string).trim();
}

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function temporaryPassword(): string {
  let out = '';
  for (let i = 0; i < INDIGO_LIMITS.passwordLength; i += 1) {
    out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  }
  // one of each kind, so every password rule passes
  return `${out.slice(0, -3)}a7K`;
}

export type OnboardInput = {
  code: string;
  name: string;
  branches: Array<{ code: string; name: string; accessCode: string; isMain: boolean }>;
  moduleCodes: string[];
  superAdmin: { name: string; email: string };
};

function readOnboard(body: unknown): OnboardInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('body', 'REQUIRED');
  }
  const b = body as Record<string, unknown>;
  const allowed = new Set(['code', 'name', 'branches', 'moduleCodes', 'superAdmin']);
  for (const key of Object.keys(b)) {
    if (!allowed.has(key)) {
      invalid(key, 'UNKNOWN_FIELD');
    }
  }
  const code = text(b.code, 'code', INDIGO_LIMITS.hospitalCodeMax).toUpperCase();
  if (!HOSPITAL_CODE.test(code)) {
    invalid('code', 'INVALID');
  }
  const name = text(b.name, 'name', INDIGO_LIMITS.nameMax);
  if (
    !Array.isArray(b.branches) ||
    b.branches.length < 1 ||
    b.branches.length > INDIGO_LIMITS.branchesMax
  ) {
    invalid('branches', 'INVALID');
  }
  const branches = (b.branches as unknown[]).map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      invalid(`branches.${index}`, 'INVALID');
    }
    const r = raw as Record<string, unknown>;
    const branchCode = text(r.code, `branches.${index}.code`, 16).toUpperCase();
    if (!BRANCH_CODE.test(branchCode)) {
      invalid(`branches.${index}.code`, 'INVALID');
    }
    const accessCode = text(
      r.accessCode,
      `branches.${index}.accessCode`,
      INDIGO_LIMITS.accessCodeMax,
    ).toLowerCase();
    if (!ACCESS_CODE.test(accessCode)) {
      invalid(`branches.${index}.accessCode`, 'INVALID');
    }
    return {
      code: branchCode,
      name: text(r.name, `branches.${index}.name`, INDIGO_LIMITS.nameMax),
      accessCode,
      isMain: r.isMain === true,
    };
  });
  if (branches.filter((x) => x.isMain).length !== 1) {
    invalid('branches', 'ONE_MAIN_BRANCH');
  }
  if (new Set(branches.map((x) => x.code)).size !== branches.length) {
    invalid('branches', 'DUPLICATE_CODE');
  }
  if (new Set(branches.map((x) => x.accessCode)).size !== branches.length) {
    invalid('branches', 'DUPLICATE_ACCESS_CODE');
  }
  if (!Array.isArray(b.moduleCodes) || b.moduleCodes.some((m) => typeof m !== 'string')) {
    invalid('moduleCodes', 'INVALID');
  }
  const moduleCodes = [...new Set((b.moduleCodes as string[]).map((m) => m.trim().toUpperCase()))];
  if (!moduleCodes.includes('OPD')) {
    invalid('moduleCodes', 'OPD_REQUIRED');
  }
  const sa = b.superAdmin as Record<string, unknown> | null;
  if (typeof sa !== 'object' || sa === null) {
    invalid('superAdmin', 'REQUIRED');
  }
  const email = text(sa.email, 'superAdmin.email', INDIGO_LIMITS.emailMax).toLowerCase();
  if (!EMAIL.test(email)) {
    invalid('superAdmin.email', 'INVALID');
  }
  return {
    code,
    name,
    branches,
    moduleCodes,
    superAdmin: { name: text(sa.name, 'superAdmin.name', INDIGO_LIMITS.nameMax), email },
  };
}

/**
 * Step 2.1e: the Indigo console. The Owner onboards hospitals, switches modules and manages Indigo
 * Employees; an Employee only sees the hospitals assigned to them. Everything here works through the
 * HQ database login (hospitals, branches, modules, the first SuperAdmin through the existing
 * SECURITY DEFINER function) and the tenant door for a new hospital's roles. Every change is written
 * to the audit log of the hospital it touches (ids and field names only).
 */
@Injectable()
export class IndigoConsoleService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly tenantDb: TenantDb,
    private readonly access: HqScopeService,
    private readonly perms: HqPermissionsService,
  ) {}

  private async need(
    hqUserId: string,
    permission: HqPermission,
    hospitalId?: string,
  ): Promise<void> {
    await this.perms.require(hqUserId, permission);
    if (hospitalId !== undefined) {
      const visible = await this.access.hospitals(hqUserId);
      if (!visible.some((h) => h.id === hospitalId)) {
        throw new ForbiddenException();
      }
    }
  }

  private async audit(
    tenantId: string,
    hqUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // createMany: the HQ login may append to the audit log but not read it back
    await this.hq.auditLog.createMany({
      data: [
        {
          tenantId,
          actorUserId: null,
          action,
          entityType,
          entityId,
          // the Indigo person is named by id (they have no user row in this hospital yet); no free text
          metadata: { hqUserId, ...metadata } as object,
        },
      ],
    });
    await this.perms.activity(hqUserId, tenantId, action, entityType, entityId, metadata);
  }

  /** The hospitals this person may see, with branches and modules. Access codes only for the Owner. */
  async overview(hqUserId: string) {
    const person = await this.hq.hqUser.findUniqueOrThrow({
      where: { id: hqUserId },
      select: { indigoRole: true },
    });
    const mine = await this.perms.listFor(hqUserId);
    // HQ Staff without the "view hospitals" tick see nothing (deny by default)
    const visible = mine.includes('hq.hospitals.view') ? await this.access.hospitals(hqUserId) : [];
    const ids = visible.map((h) => h.id);
    const [hospitals, branches, subs, modules, branchModules] = await Promise.all([
      this.hq.hospital.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, name: true, status: true, isActive: true, isTest: true },
        orderBy: { name: 'asc' },
      }),
      this.hq.branch.findMany({
        where: { tenantId: { in: ids } },
        select: {
          id: true,
          tenantId: true,
          code: true,
          name: true,
          isMain: true,
          isActive: true,
          accessCode: true,
        },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      }),
      this.hq.hospitalModuleSubscription.findMany({
        where: { tenantId: { in: ids }, isActive: true },
        select: { tenantId: true, module: { select: { code: true } } },
      }),
      this.hq.module.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.hq.branchModule.findMany({
        where: { tenantId: { in: ids }, isActive: true, enabledByIndigo: true },
        select: { tenantId: true, branchId: true, module: { select: { code: true } } },
      }),
    ]);
    const owner = person.indigoRole === 'OWNER';
    return {
      canManage: owner,
      permissions: mine,
      moduleCatalog: modules,
      items: hospitals.map((h) => ({
        ...h,
        modules: subs
          .filter((s) => s.tenantId === h.id)
          .map((s) => s.module.code)
          .sort(),
        branches: branches
          .filter((b) => b.tenantId === h.id)
          .map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            isMain: b.isMain,
            isActive: b.isActive,
            ...(owner ? { accessCode: b.accessCode } : {}),
            modules: branchModules
              .filter((m) => m.branchId === b.id)
              .map((m) => m.module.code)
              .sort(),
          })),
      })),
    };
  }

  /**
   * A new hospital: the hospital, its branches with access codes, the modules, the roles (Super Admin,
   * Admin and the two Indigo roles) and the first SuperAdmin with a one-time temporary password. The
   * starter masters (payment modes, number series ...) still need the starter command once.
   */
  async onboard(hqUserId: string, body: unknown) {
    await this.need(hqUserId, 'hq.onboard');
    const input = readOnboard(body);
    if (await this.hq.hospital.findUnique({ where: { code: input.code }, select: { id: true } })) {
      conflict('code', 'TAKEN');
    }
    const taken = await this.hq.branch.findFirst({
      where: { accessCode: { in: input.branches.map((b) => b.accessCode) } },
      select: { id: true },
    });
    if (taken) {
      conflict('branches', 'ACCESS_CODE_TAKEN');
    }
    const modules = await this.hq.module.findMany({
      where: { code: { in: input.moduleCodes }, isActive: true },
      select: { id: true, code: true },
    });
    if (modules.length !== input.moduleCodes.length) {
      invalid('moduleCodes', 'UNKNOWN_MODULE');
    }

    const hospital = await this.hq.hospital.create({
      data: {
        code: input.code,
        name: input.name,
        status: 'ACTIVE',
        isTest: false,
        isActive: true,
        branches: { create: input.branches },
      },
      include: { branches: { select: { id: true, code: true } } },
    });
    for (const mod of modules) {
      await this.hq.hospitalModuleSubscription.create({
        data: { tenantId: hospital.id, moduleId: mod.id },
      });
      for (const branch of hospital.branches) {
        await this.hq.branchModule.create({
          data: {
            tenantId: hospital.id,
            branchId: branch.id,
            moduleId: mod.id,
            enabledByIndigo: true,
          },
        });
      }
    }
    // the roles of the new hospital (the tenant door; the tenant is the new hospital)
    await runWithContext(
      {
        tenantId: hospital.id,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId: randomUUID(),
      },
      () =>
        this.tenantDb.withTenant(
          (tx) => ensureSystemRolesForTenant(tx as unknown as PrismaClient, hospital.id),
          { timeoutMs: 120_000 },
        ),
    );
    const password = temporaryPassword();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const userCode = `SA-${randomBytes(3).toString('hex').toUpperCase()}`;
    const rows = await this.hq.$queryRaw<Array<{ id: string }>>`
      SELECT hq_create_first_superadmin(${hospital.id}, ${userCode}, ${input.superAdmin.email}, ${input.superAdmin.name}, ${hash}) AS id`;
    await this.audit(hospital.id, hqUserId, 'INDIGO_HOSPITAL_ONBOARD', 'hospital', hospital.id, {
      branches: input.branches.length,
      modules: input.moduleCodes,
    });
    return {
      hospital: { id: hospital.id, code: hospital.code, name: input.name },
      branches: input.branches.map((b) => ({
        code: b.code,
        name: b.name,
        accessCode: b.accessCode,
        isMain: b.isMain,
      })),
      superAdmin: {
        id: rows[0]?.id ?? null,
        email: input.superAdmin.email,
        temporaryPassword: password,
      },
      nextStep:
        'Run the starter once for this hospital: npm run hospital:starter -w @hospigo/api -- --hospital ' +
        hospital.code,
    };
  }

  /** The module set of a hospital (and of all its branches), changed by the Owner only. */
  async setModules(hqUserId: string, hospitalId: string, body: unknown) {
    await this.need(hqUserId, 'hq.modules', hospitalId);
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray((body as { moduleCodes?: unknown }).moduleCodes)
    ) {
      invalid('moduleCodes', 'INVALID');
    }
    const wanted = [
      ...new Set(
        (body as { moduleCodes: unknown[] }).moduleCodes.map((m) => String(m).trim().toUpperCase()),
      ),
    ];
    if (!wanted.includes('OPD')) {
      invalid('moduleCodes', 'OPD_REQUIRED');
    }
    const hospital = await this.hq.hospital.findUnique({
      where: { id: hospitalId },
      select: { id: true },
    });
    if (!hospital) {
      throw new ForbiddenException();
    }
    const catalog = await this.hq.module.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
    });
    if (wanted.some((code) => !catalog.some((m) => m.code === code))) {
      invalid('moduleCodes', 'UNKNOWN_MODULE');
    }
    const branches = await this.hq.branch.findMany({
      where: { tenantId: hospitalId, isActive: true },
      select: { id: true },
    });
    const before: string[] = [];
    for (const mod of catalog) {
      const sub = await this.hq.hospitalModuleSubscription.findUnique({
        where: { tenantId_moduleId: { tenantId: hospitalId, moduleId: mod.id } },
      });
      if (sub?.isActive) {
        before.push(mod.code);
      }
      const on = wanted.includes(mod.code);
      if (on) {
        await this.hq.hospitalModuleSubscription.upsert({
          where: { tenantId_moduleId: { tenantId: hospitalId, moduleId: mod.id } },
          create: { tenantId: hospitalId, moduleId: mod.id },
          update: { isActive: true },
        });
        for (const branch of branches) {
          await this.hq.branchModule.upsert({
            where: {
              tenantId_branchId_moduleId: {
                tenantId: hospitalId,
                branchId: branch.id,
                moduleId: mod.id,
              },
            },
            create: {
              tenantId: hospitalId,
              branchId: branch.id,
              moduleId: mod.id,
              enabledByIndigo: true,
            },
            update: { isActive: true, enabledByIndigo: true },
          });
        }
      } else if (sub) {
        await this.hq.hospitalModuleSubscription.update({
          where: { id: sub.id },
          data: { isActive: false },
        });
        await this.hq.branchModule.updateMany({
          where: { tenantId: hospitalId, moduleId: mod.id },
          data: { isActive: false },
        });
      }
    }
    await this.audit(hospitalId, hqUserId, 'INDIGO_MODULES_CHANGE', 'hospital', hospitalId, {
      before: before.sort(),
      after: wanted.sort(),
    });
    return { moduleCodes: wanted.sort() };
  }

  // ------------------------------------------------------------------------------ employees

  async employees(hqUserId: string) {
    await this.need(hqUserId, 'hq.staff.manage');
    const rows = await this.hq.hqUser.findMany({
      where: { indigoRole: 'EMPLOYEE' },
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        hospitals: { select: { tenantId: true } },
      },
      orderBy: { displayName: 'asc' },
    });
    const ticks = await this.hq.hqUserPermission.findMany({
      where: { hqUserId: { in: rows.map((r) => r.id) } },
      select: { hqUserId: true, permission: true },
    });
    return {
      permissionCatalog: [...HQ_PERMISSIONS],
      items: rows.map((r) => ({
        permissions: ticks
          .filter((t) => t.hqUserId === r.id)
          .map((t) => t.permission)
          .sort(),
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        isActive: r.isActive,
        hospitalIds: r.hospitals.map((h) => h.tenantId),
      })),
    };
  }

  /** Only an Owner creates an Employee; the password is shown once and the person must change it. */
  async createEmployee(hqUserId: string, body: unknown) {
    await this.need(hqUserId, 'hq.staff.manage');
    if (typeof body !== 'object' || body === null) {
      invalid('body', 'REQUIRED');
    }
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (!['name', 'email'].includes(key)) {
        invalid(key, 'UNKNOWN_FIELD');
      }
    }
    const displayName = text(b.name, 'name', INDIGO_LIMITS.nameMax);
    const email = text(b.email, 'email', INDIGO_LIMITS.emailMax).toLowerCase();
    if (!EMAIL.test(email)) {
      invalid('email', 'INVALID');
    }
    if (await this.hq.hqUser.findUnique({ where: { email }, select: { id: true } })) {
      conflict('email', 'TAKEN');
    }
    const password = temporaryPassword();
    const row = await this.hq.hqUser.create({
      data: {
        email,
        displayName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        mustChangePassword: true,
        indigoRole: 'EMPLOYEE',
      },
    });
    await this.perms.activity(hqUserId, null, 'HQ_STAFF_CREATE', 'hq_user', row.id, {});
    return { id: row.id, email, displayName, temporaryPassword: password };
  }

  /** The hospitals an Employee may enter (the whole list is replaced). */
  /** The tick-boxes of one HQ Staff person: replaces the whole set; unknown names are refused. */
  async setEmployeePermissions(hqUserId: string, employeeId: string, body: unknown) {
    await this.need(hqUserId, 'hq.staff.manage');
    const raw =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    if (
      !raw ||
      Object.keys(raw).some((k) => k !== 'permissions') ||
      !Array.isArray(raw.permissions)
    ) {
      invalid('permissions', 'INVALID');
    }
    const known = new Set<string>(HQ_PERMISSIONS);
    const wanted = [...new Set(raw.permissions as unknown[])];
    if (wanted.some((p) => typeof p !== 'string' || !known.has(p))) {
      invalid('permissions', 'UNKNOWN_PERMISSION');
    }
    const person = await this.hq.hqUser.findUnique({
      where: { id: employeeId },
      select: { indigoRole: true },
    });
    if (!person || person.indigoRole !== 'EMPLOYEE') {
      throw new ForbiddenException();
    }
    await this.hq.hqUserPermission.deleteMany({ where: { hqUserId: employeeId } });
    if (wanted.length > 0) {
      await this.hq.hqUserPermission.createMany({
        data: (wanted as string[]).map((permission) => ({ hqUserId: employeeId, permission })),
      });
    }
    await this.perms.activity(hqUserId, null, 'HQ_STAFF_PERMISSIONS', 'hq_user', employeeId, {
      permissions: (wanted as string[]).sort(),
    });
    return { permissions: (wanted as string[]).sort() };
  }

  async setEmployeeHospitals(hqUserId: string, employeeId: string, body: unknown) {
    await this.need(hqUserId, 'hq.staff.manage');
    const ids = (body as { hospitalIds?: unknown } | null)?.hospitalIds;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || ids.length > 500) {
      invalid('hospitalIds', 'INVALID');
    }
    const employee = await this.hq.hqUser.findFirst({
      where: { id: employeeId, indigoRole: 'EMPLOYEE' },
      select: { id: true },
    });
    if (!employee) {
      throw new ForbiddenException();
    }
    const wanted = [...new Set(ids as string[])];
    const real = await this.hq.hospital.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });
    if (real.length !== wanted.length) {
      invalid('hospitalIds', 'UNKNOWN_HOSPITAL');
    }
    const current = await this.hq.hqUserHospital.findMany({
      where: { hqUserId: employeeId },
      select: { tenantId: true },
    });
    const have = new Set(current.map((c) => c.tenantId));
    const added = wanted.filter((id) => !have.has(id));
    const removed = [...have].filter((id) => !wanted.includes(id));
    for (const tenantId of added) {
      await this.hq.hqUserHospital.create({ data: { hqUserId: employeeId, tenantId } });
      await this.audit(tenantId, hqUserId, 'INDIGO_EMPLOYEE_ASSIGNED', 'hq_user', employeeId, {
        employeeId,
      });
    }
    if (removed.length > 0) {
      await this.hq.hqUserHospital.deleteMany({
        where: { hqUserId: employeeId, tenantId: { in: removed } },
      });
      for (const tenantId of removed) {
        await this.audit(tenantId, hqUserId, 'INDIGO_EMPLOYEE_UNASSIGNED', 'hq_user', employeeId, {
          employeeId,
        });
      }
    }
    return { hospitalIds: wanted };
  }

  async setEmployeeActive(hqUserId: string, employeeId: string, active: boolean) {
    await this.need(hqUserId, 'hq.staff.manage');
    const done = await this.hq.hqUser.updateMany({
      where: { id: employeeId, indigoRole: 'EMPLOYEE' },
      data: { isActive: active },
    });
    if (done.count !== 1) {
      throw new ForbiddenException();
    }
    return { id: employeeId, isActive: active };
  }
}
