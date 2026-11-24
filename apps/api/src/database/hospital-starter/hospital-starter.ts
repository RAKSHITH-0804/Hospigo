import {
  codeFromLabel,
  REFERENCE_FIELD_SET,
} from '../../modules/patients/patient-reference-fields';
import type { Prisma, PrismaClient, UhidResetRule } from '../../generated/prisma';
import {
  validateNumberSeriesFormat,
  type NumberSeriesFormat,
} from '../../modules/opd-masters/number-series-format';
import {
  OPD_FY_START_MONTH_DEFAULT,
  OPD_SETTINGS_DEFAULTS,
} from '../../modules/opd-masters/opd-settings.defaults';
import { STARTER_PAYMENT_MODES, STARTER_REGISTRATION_ITEM, STARTER_VITALS } from './starter-data';

/**
 * The starter script for ONE existing hospital (Step 8b, part A).
 *
 * It creates only what is missing and never overwrites a value an Admin changed. It creates no
 * patients, doctors, users, visits or prices. The hospital, its branches, access codes and its first
 * SuperAdmin must already exist (docs/guides/new-hospital-runbook.md).
 *
 * It is meant for the owner database login (it writes the masters directly). Every write runs in one
 * transaction that carries the hospital as the tenant, so the database triggers see the same tenant.
 */

export class StarterError extends Error {}

export type SeriesKind = 'BILL' | 'RECEIPT' | 'REFUND';
export type StarterResetRule = Extract<UhidResetRule, 'FINANCIAL_YEAR' | 'NEVER'>;

export type StarterOptions = {
  hospitalCode: string;
  dryRun: boolean;
  /** Number series (BILL, RECEIPT, REFUND): financial year style, separator, running width. */
  fyStyle: 'SHORT' | 'LONG';
  separator: string;
  width: number;
  resetRule: StarterResetRule;
  fyStartMonth: number;
  /** Optional fixed text in front of each series, for example "B-". */
  seriesPrefix: Partial<Record<SeriesKind, string>>;
  /** The default patient number (UHID) format. */
  uhid: { prefix: string; width: number; resetRule: StarterResetRule };
  /** Also add the ready-made reference fields (Referred by, Category, ...) to the registration form. */
  referenceFields: boolean;
};

export type StarterReport = {
  hospitalCode: string;
  dryRun: boolean;
  /** What was (or, in a dry run, would be) created, in plain words. */
  created: string[];
  /** What was already there and left alone. */
  kept: string[];
  warnings: string[];
};

export const STARTER_LIMITS = {
  separatorMax: 3,
  prefixMax: 12,
  widthMin: 1,
  widthMax: 12,
} as const;

export function defaultStarterOptions(hospitalCode: string): StarterOptions {
  return {
    hospitalCode,
    dryRun: false,
    fyStyle: 'SHORT',
    separator: '/',
    width: 5,
    resetRule: 'FINANCIAL_YEAR',
    fyStartMonth: OPD_FY_START_MONTH_DEFAULT,
    seriesPrefix: {},
    uhid: { prefix: '', width: 5, resetRule: 'FINANCIAL_YEAR' },
    referenceFields: false,
  };
}

function checkText(label: string, value: string, max: number): void {
  if (value.length > max) {
    throw new StarterError(`${label} is too long (at most ${max} characters)`);
  }
  if (Array.from(value).some((ch) => ch.charCodeAt(0) < 32)) {
    throw new StarterError(`${label} must be plain text`);
  }
}

function checkWidth(label: string, width: number): void {
  if (
    !Number.isInteger(width) ||
    width < STARTER_LIMITS.widthMin ||
    width > STARTER_LIMITS.widthMax
  ) {
    throw new StarterError(
      `${label} must be a whole number from ${STARTER_LIMITS.widthMin} to ${STARTER_LIMITS.widthMax}`,
    );
  }
}

export function validateStarterOptions(o: StarterOptions): void {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(o.hospitalCode)) {
    throw new StarterError('The hospital code is missing or has characters that are not allowed');
  }
  if (o.fyStyle !== 'SHORT' && o.fyStyle !== 'LONG') {
    throw new StarterError('The financial year style must be SHORT or LONG');
  }
  if (o.resetRule !== 'FINANCIAL_YEAR' && o.resetRule !== 'NEVER') {
    throw new StarterError('The reset rule must be FINANCIAL_YEAR or NEVER');
  }
  if (o.uhid.resetRule !== 'FINANCIAL_YEAR' && o.uhid.resetRule !== 'NEVER') {
    throw new StarterError('The UHID reset rule must be FINANCIAL_YEAR or NEVER');
  }
  if (!Number.isInteger(o.fyStartMonth) || o.fyStartMonth < 1 || o.fyStartMonth > 12) {
    throw new StarterError('The financial year start month must be 1 to 12');
  }
  checkText('The separator', o.separator, STARTER_LIMITS.separatorMax);
  checkWidth('The running number width', o.width);
  checkWidth('The UHID running number width', o.uhid.width);
  checkText('The UHID prefix', o.uhid.prefix, STARTER_LIMITS.prefixMax);
  for (const [kind, prefix] of Object.entries(o.seriesPrefix)) {
    checkText(`The ${kind} prefix`, prefix ?? '', STARTER_LIMITS.prefixMax);
  }
  for (const kind of ['BILL', 'RECEIPT', 'REFUND'] as const) {
    validateNumberSeriesFormat(seriesFormat(o, kind));
  }
}

export function seriesFormat(o: StarterOptions, kind: SeriesKind): NumberSeriesFormat {
  const prefix = o.seriesPrefix[kind] ?? '';
  const blocks: NumberSeriesFormat = [];
  if (prefix) {
    blocks.push({ type: 'FIXED', text: prefix });
  }
  blocks.push({ type: 'FINANCIAL_YEAR', style: o.fyStyle });
  if (o.separator) {
    blocks.push({ type: 'SEPARATOR', text: o.separator });
  }
  blocks.push({ type: 'RUNNING', width: o.width });
  return blocks;
}

const UHID_START = new Date('2000-01-01T00:00:00.000Z');

/** Runs (or, with dryRun, only plans) the starter for one hospital. */
export async function runHospitalStarter(
  prisma: PrismaClient,
  options: StarterOptions,
): Promise<StarterReport> {
  validateStarterOptions(options);
  const report: StarterReport = {
    hospitalCode: options.hospitalCode,
    dryRun: options.dryRun,
    created: [],
    kept: [],
    warnings: [],
  };

  const hospital = await prisma.hospital.findUnique({ where: { code: options.hospitalCode } });
  if (!hospital || !hospital.isActive) {
    throw new StarterError(
      `No active hospital with the code "${options.hospitalCode}". Create it first (docs/guides/new-hospital-runbook.md).`,
    );
  }
  const tenantId = hospital.id;

  const mainBranch = await prisma.branch.findFirst({
    where: { tenantId, isMain: true, isActive: true },
  });
  if (!mainBranch) {
    throw new StarterError('The hospital has no active main branch (runbook, item 3).');
  }
  const branches = await prisma.branch.findMany({ where: { tenantId, isActive: true } });
  for (const branch of branches) {
    if (!branch.accessCode || branch.accessCode.startsWith('dev-placeholder')) {
      report.warnings.push(`Branch ${branch.code} has no real access code yet`);
    }
  }

  const superAdminRole = await prisma.role.findUnique({
    where: { tenantId_code: { tenantId, code: 'SUPER_ADMIN' } },
  });
  const assignment = superAdminRole
    ? await prisma.roleAssignment.findFirst({
        where: { tenantId, roleId: superAdminRole.id, scopeType: 'HOSPITAL', isActive: true },
      })
    : null;
  if (!assignment) {
    throw new StarterError('The hospital has no SuperAdmin user yet (runbook, item 5).');
  }
  const superAdminId = assignment.userId;

  const opdModule = await prisma.module.findUnique({ where: { code: 'OPD' } });
  const subscription = opdModule
    ? await prisma.hospitalModuleSubscription.findUnique({
        where: { tenantId_moduleId: { tenantId, moduleId: opdModule.id } },
      })
    : null;
  if (!subscription?.isActive) {
    report.warnings.push('The OPD module is not switched on for this hospital (runbook, item 4)');
  }

  const apply = async (tx: Prisma.TransactionClient) => {
    // Payment modes: only the codes that are missing.
    for (const mode of STARTER_PAYMENT_MODES) {
      const exists = await tx.paymentMode.findUnique({
        where: { tenantId_code: { tenantId, code: mode.code } },
      });
      if (exists) {
        report.kept.push(`Payment mode ${mode.code}`);
        continue;
      }
      report.created.push(`Payment mode ${mode.code}`);
      if (!options.dryRun) {
        await tx.paymentMode.create({
          data: {
            tenantId,
            code: mode.code,
            name: mode.name,
            requiresReference: mode.requiresReference,
            active: true,
          },
        });
      }
    }

    // Vitals fields (warning ranges only warn, they never block).
    for (const field of STARTER_VITALS) {
      const exists = await tx.vitalsField.findUnique({
        where: { tenantId_code: { tenantId, code: field.code } },
      });
      if (exists) {
        report.kept.push(`Vitals field ${field.code}`);
        continue;
      }
      report.created.push(`Vitals field ${field.code}`);
      if (!options.dryRun) {
        await tx.vitalsField.create({
          data: {
            tenantId,
            code: field.code,
            name: field.name,
            unit: field.unit,
            valueKind: 'NUMBER',
            displayOrder: field.order,
            warnMin: field.warnMin,
            warnMax: field.warnMax,
            active: true,
          },
        });
      }
    }

    // Number series.
    for (const kind of ['BILL', 'RECEIPT', 'REFUND'] as const) {
      const exists = await tx.numberSeriesSettings.findUnique({
        where: { tenantId_series: { tenantId, series: kind } },
      });
      if (exists) {
        report.kept.push(`Number series ${kind}`);
        continue;
      }
      report.created.push(`Number series ${kind}`);
      if (!options.dryRun) {
        await tx.numberSeriesSettings.create({
          data: {
            tenantId,
            series: kind,
            format: seriesFormat(options, kind) as unknown as object,
            resetRule: options.resetRule,
            fyStartMonth: options.fyStartMonth,
          },
        });
      }
    }

    // The OPD rules row.
    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    if (settings) {
      report.kept.push('OPD rules');
    } else {
      report.created.push('OPD rules');
      if (!options.dryRun) {
        await tx.opdSettings.create({
          data: {
            tenantId,
            followUpFreeDays: OPD_SETTINGS_DEFAULTS.followUpFreeDays,
            repeatVisitFreeHours: OPD_SETTINGS_DEFAULTS.repeatVisitFreeHours,
            tokenPrefix: OPD_SETTINGS_DEFAULTS.tokenPrefix,
            timezone: OPD_SETTINGS_DEFAULTS.timezone,
            taxEnabled: OPD_SETTINGS_DEFAULTS.taxEnabled,
            taxInclusive: OPD_SETTINGS_DEFAULTS.taxInclusive,
          },
        });
      }
    }

    // The registration charge item, WITHOUT a price (the hospital sets it in Prices).
    const registration = await tx.chargeItem.findFirst({
      where: { tenantId, kind: 'REGISTRATION' },
    });
    if (registration) {
      report.kept.push('Registration charge item');
    } else {
      const codeTaken = await tx.chargeItem.findUnique({
        where: { tenantId_code: { tenantId, code: STARTER_REGISTRATION_ITEM.code } },
      });
      if (codeTaken) {
        throw new StarterError(
          `The code ${STARTER_REGISTRATION_ITEM.code} is already used by another charge item; rename it first`,
        );
      }
      report.created.push('Registration charge item (no price yet)');
      if (!options.dryRun) {
        await tx.chargeItem.create({
          data: {
            tenantId,
            code: STARTER_REGISTRATION_ITEM.code,
            name: STARTER_REGISTRATION_ITEM.name,
            kind: 'REGISTRATION',
            taxable: false,
            taxRateBp: 0,
            active: true,
          },
        });
      }
    }

    // Patient registration field settings (only the keys that have none).
    const catalog = await tx.patientFieldCatalog.findMany();
    const existingSettings = await tx.patientFieldSetting.findMany({
      where: { tenantId },
      select: { catalogKey: true, sortOrder: true },
    });
    const have = new Set(existingSettings.map((s) => s.catalogKey));
    let order = existingSettings.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0);
    const missing = catalog.filter((field) => !have.has(field.key));
    if (missing.length === 0) {
      report.kept.push('Patient registration fields');
    } else {
      report.created.push(`Patient registration fields (${missing.length})`);
      if (!options.dryRun) {
        for (const field of missing) {
          await tx.patientFieldSetting.create({
            data: {
              tenantId,
              catalogKey: field.key,
              isEnabled: true,
              isRequired: field.alwaysRequired,
              label: field.defaultLabel,
              sortOrder: order,
              changedBy: superAdminId,
            },
          });
          order += 1;
        }
      }
    }

    // The ready-made reference fields (Referred by, Category, ...), only when asked for. A field whose
    // name is already used is left exactly as it is: nothing is overwritten.
    if (options.referenceFields) {
      const existingCustom = await tx.patientCustomField.findMany({
        where: { tenantId },
        select: { label: true, code: true },
      });
      const labels = new Set(existingCustom.map((f) => f.label.toLowerCase()));
      const codes = new Set(existingCustom.map((f) => f.code));
      const top = await tx.patientFieldSetting.aggregate({
        where: { tenantId },
        _max: { sortOrder: true },
      });
      let sortOrder = top._max.sortOrder ?? 0;
      for (const def of REFERENCE_FIELD_SET) {
        if (labels.has(def.label.toLowerCase())) {
          report.kept.push(`Reference field ${def.label}`);
          continue;
        }
        report.created.push(`Reference field ${def.label}`);
        if (options.dryRun) {
          continue;
        }
        const base = codeFromLabel(def.label);
        let code = base;
        for (let n = 2; codes.has(code); n += 1) {
          code = `${base}_${n}`;
        }
        codes.add(code);
        const field = await tx.patientCustomField.create({
          data: {
            tenantId,
            code,
            label: def.label,
            dataType: def.dataType,
            section: def.section,
          },
        });
        if (def.options) {
          await tx.patientCustomFieldOption.createMany({
            data: def.options.map((label, index) => ({
              tenantId,
              fieldId: field.id,
              label,
              sortOrder: index,
            })),
          });
        }
        sortOrder += 1;
        await tx.patientFieldSetting.create({
          data: {
            tenantId,
            customFieldId: field.id,
            isEnabled: true,
            isRequired: false,
            label: def.label,
            sortOrder,
            changedBy: superAdminId,
            changedAt: new Date(),
          },
        });
      }
    }

    // A default patient number (UHID) format: without one, registration is refused.
    const uhid = await tx.uhidFormatConfig.findFirst({ where: { tenantId } });
    if (uhid) {
      report.kept.push('Patient number (UHID) format');
    } else {
      report.created.push('Patient number (UHID) format');
      if (!options.dryRun) {
        const blocks: Array<{
          position: number;
          blockType: 'FIXED_TEXT' | 'FINANCIAL_YEAR' | 'SEPARATOR' | 'RUNNING_NUMBER';
          textValue?: string;
          fyStyle?: 'SHORT' | 'LONG';
          minWidth?: number;
        }> = [];
        const add = (b: Omit<(typeof blocks)[number], 'position'>) =>
          blocks.push({ position: blocks.length + 1, ...b });
        if (options.uhid.prefix) {
          add({ blockType: 'FIXED_TEXT', textValue: options.uhid.prefix });
        }
        if (options.uhid.resetRule === 'FINANCIAL_YEAR') {
          add({ blockType: 'FINANCIAL_YEAR', fyStyle: 'SHORT' });
          add({ blockType: 'SEPARATOR', textValue: '/' });
        }
        add({ blockType: 'RUNNING_NUMBER', minWidth: options.uhid.width });
        await tx.uhidFormatConfig.create({
          data: {
            tenantId,
            effectiveFrom: UHID_START,
            resetRule: options.uhid.resetRule,
            fyStartMonth: options.fyStartMonth,
            timezone: OPD_SETTINGS_DEFAULTS.timezone,
            createdBy: superAdminId,
            blocks: { create: blocks },
          },
        });
      }
    }

    if (!options.dryRun && report.created.length > 0) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: 'hospital.starter.run',
          entityType: 'hospital',
          entityId: tenantId,
          reason: 'hospital starter script',
          // Names of what was created only (no values).
          metadata: { created: report.created },
        },
      });
    }
  };

  if (options.dryRun) {
    await apply(prisma);
  } else {
    await prisma.$transaction(async (tx) => {
      // The hospital is the tenant of every write below (the database triggers check it).
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await apply(tx);
    });
  }
  return report;
}
