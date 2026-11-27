import { randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import {
  defaultStarterOptions,
  runHospitalStarter,
  StarterError,
} from '../../database/hospital-starter/hospital-starter';
import { TenantDb } from '../../database/tenant-db';
import type { PrismaClient } from '../../generated/prisma';
import { HqScopeService } from './hq-scope.service';

function invalid(field: string, reason: string): never {
  throw new HttpException({ statusCode: 400, code: 'INDIGO_INVALID', field, reason }, 400);
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const TERMINOLOGY_LIMITS = { textMax: 60, keysMax: 40 } as const;
const TERM_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
// plain words only: no angle brackets (so never markup), no control or invisible direction characters
// eslint-disable-next-line no-control-regex
const NOT_PLAIN = /[\u0000-\u001f\u007f-\u009f<>\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

/**
 * Step 2.1f: what the Indigo console sets up beyond onboarding: the words a hospital prefers for a
 * few terms (Owner, and an Employee for the hospitals assigned to them), a module switch for ONE
 * branch, and the starter masters (payment modes, vitals, number series) without the command line.
 */
@Injectable()
export class IndigoSetupService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly tenantDb: TenantDb,
    private readonly access: HqScopeService,
  ) {}

  private async requireOwner(hqUserId: string): Promise<void> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive || person.indigoRole !== 'OWNER') {
      throw new ForbiddenException();
    }
  }

  /** The Owner for any hospital, an Employee only for the assigned ones; unknown or other: the same 403. */
  private async requireHospital(hqUserId: string, hospitalId: string): Promise<void> {
    const visible = await this.access.hospitals(hqUserId);
    if (!visible.some((h) => h.id === hospitalId)) {
      throw new ForbiddenException();
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
    await this.hq.auditLog.createMany({
      data: [
        {
          tenantId,
          actorUserId: null,
          action,
          entityType,
          entityId,
          metadata: { hqUserId, ...metadata } as object,
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------- terminology

  async terms(hqUserId: string, hospitalId: string) {
    await this.requireHospital(hqUserId, hospitalId);
    const rows = await this.hq.terminologyOverride.findMany({
      where: { tenantId: hospitalId },
      select: { key: true, text: true },
      orderBy: { key: 'asc' },
    });
    return { items: Object.fromEntries(rows.map((r) => [r.key, r.text])) };
  }

  /** `{ items: { key: "text" | null } }`: a text sets the word, null (or empty) takes the override away. */
  async setTerms(hqUserId: string, hospitalId: string, body: unknown) {
    await this.requireHospital(hqUserId, hospitalId);
    if (!isObject(body) || !isObject(body.items) || Object.keys(body).length !== 1) {
      invalid('items', 'INVALID');
    }
    const entries = Object.entries(body.items);
    if (entries.length > TERMINOLOGY_LIMITS.keysMax) {
      invalid('items', 'TOO_MANY');
    }
    const set: Array<[string, string]> = [];
    const clear: string[] = [];
    for (const [key, value] of entries) {
      if (!TERM_KEY.test(key)) {
        invalid(`items.${key}`, 'BAD_KEY');
      }
      if (value === null || (typeof value === 'string' && value.trim() === '')) {
        clear.push(key);
        continue;
      }
      if (
        typeof value !== 'string' ||
        value.trim().length > TERMINOLOGY_LIMITS.textMax ||
        NOT_PLAIN.test(value)
      ) {
        invalid(`items.${key}`, 'INVALID');
      }
      set.push([key, value.trim()]);
    }
    for (const [key, text] of set) {
      await this.hq.terminologyOverride.upsert({
        where: { tenantId_key: { tenantId: hospitalId, key } },
        create: { tenantId: hospitalId, key, text, updatedBy: hqUserId },
        update: { text, updatedBy: hqUserId },
      });
    }
    if (clear.length > 0) {
      await this.hq.terminologyOverride.deleteMany({
        where: { tenantId: hospitalId, key: { in: clear } },
      });
    }
    // names of the terms only, never the words
    await this.audit(hospitalId, hqUserId, 'INDIGO_TERMS_CHANGE', 'terminology', hospitalId, {
      set: set.map(([k]) => k),
      cleared: clear,
    });
    return this.terms(hqUserId, hospitalId);
  }

  // ------------------------------------------------------------------------ branch modules

  /** The module set of ONE branch. The hospital must hold the module; OPD cannot be switched off. */
  async setBranchModules(hqUserId: string, hospitalId: string, branchId: string, body: unknown) {
    await this.requireOwner(hqUserId);
    if (!isObject(body) || !Array.isArray(body.moduleCodes) || Object.keys(body).length !== 1) {
      invalid('moduleCodes', 'INVALID');
    }
    const wanted = [...new Set(body.moduleCodes.map((m) => String(m).trim().toUpperCase()))];
    if (!wanted.includes('OPD')) {
      invalid('moduleCodes', 'OPD_REQUIRED');
    }
    const branch = await this.hq.branch.findFirst({
      where: { id: branchId, tenantId: hospitalId, isActive: true },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException();
    }
    const subs = await this.hq.hospitalModuleSubscription.findMany({
      where: { tenantId: hospitalId, isActive: true },
      select: { moduleId: true, module: { select: { code: true } } },
    });
    const held = new Map(subs.map((s) => [s.module.code, s.moduleId]));
    if (wanted.some((code) => !held.has(code))) {
      invalid('moduleCodes', 'HOSPITAL_DOES_NOT_HOLD_MODULE');
    }
    const before = await this.hq.branchModule.findMany({
      where: { tenantId: hospitalId, branchId, isActive: true },
      select: { module: { select: { code: true } } },
    });
    for (const [code, moduleId] of held) {
      if (wanted.includes(code)) {
        await this.hq.branchModule.upsert({
          where: { tenantId_branchId_moduleId: { tenantId: hospitalId, branchId, moduleId } },
          create: { tenantId: hospitalId, branchId, moduleId, enabledByIndigo: true },
          update: { isActive: true, enabledByIndigo: true },
        });
      } else {
        await this.hq.branchModule.updateMany({
          where: { tenantId: hospitalId, branchId, moduleId },
          data: { isActive: false },
        });
      }
    }
    await this.audit(hospitalId, hqUserId, 'INDIGO_BRANCH_MODULES_CHANGE', 'branch', branchId, {
      before: before.map((b) => b.module.code).sort(),
      after: wanted.sort(),
    });
    return { moduleCodes: wanted.sort() };
  }

  // ----------------------------------------------------------------------------- the starter

  /**
   * The starter masters (payment modes, vitals fields, number series, registration charge, patient
   * number format) for a hospital, the same code as `npm run hospital:starter` with its defaults.
   * Safe to press twice: what exists is kept. Runs through the hospital's own database door.
   */
  async runStarter(hqUserId: string, hospitalId: string) {
    await this.requireOwner(hqUserId);
    const hospital = await this.hq.hospital.findUnique({
      where: { id: hospitalId },
      select: { id: true, code: true },
    });
    if (!hospital) {
      throw new ForbiddenException();
    }
    try {
      const report = await runWithContext(
        {
          tenantId: hospital.id,
          userId: null,
          kind: 'HOSPITAL',
          activeBranchId: null,
          requestId: randomUUID(),
        },
        () =>
          this.tenantDb.withTenant(
            (tx) => {
              // the starter wants a client that can open its own transaction: here it already is inside one
              const client = new Proxy(tx as unknown as PrismaClient, {
                get(target, prop, receiver) {
                  if (prop === '$transaction') {
                    return (fn: (t: unknown) => Promise<unknown>) => fn(target);
                  }
                  return Reflect.get(target, prop, receiver) as unknown;
                },
              });
              return runHospitalStarter(client, defaultStarterOptions(hospital.code));
            },
            { timeoutMs: 120_000 },
          ),
      );
      await this.audit(hospital.id, hqUserId, 'INDIGO_STARTER_RUN', 'hospital', hospital.id, {
        created: report.created.length,
        kept: report.kept.length,
      });
      return report;
    } catch (error) {
      if (error instanceof StarterError) {
        invalid('starter', error.message);
      }
      throw error;
    }
  }
}
