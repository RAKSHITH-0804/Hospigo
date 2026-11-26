import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../database/tenant-db';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import {
  OPD_FOLLOW_UP_FREE_DAYS_MAX,
  OPD_FOLLOW_UP_FREE_DAYS_MIN,
  OPD_REPEAT_VISIT_FREE_HOURS_MAX,
  OPD_REPEAT_VISIT_FREE_HOURS_MIN,
  OPD_SETTINGS_DEFAULTS,
} from './opd-settings.defaults';

export type OpdRules = {
  followUpFreeDays: number;
  repeatVisitFreeHours: number;
  /** Default paper of new documents (A4 or A5); the patient card is always the label. */
  defaultPrintPaper: 'A4' | 'A5';
  /** Print the patient card automatically after payment (off by default). */
  patientCardAutoPrint: boolean;
};

export type OpdRulesView = OpdRules & {
  /** false until a hospital saves once: the values are then the documented defaults. */
  persisted: boolean;
  limits: {
    followUpFreeDays: { min: number; max: number };
    repeatVisitFreeHours: { min: number; max: number };
  };
  paperChoices: readonly ('A4' | 'A5')[];
};

const LIMITS = {
  followUpFreeDays: { min: OPD_FOLLOW_UP_FREE_DAYS_MIN, max: OPD_FOLLOW_UP_FREE_DAYS_MAX },
  repeatVisitFreeHours: {
    min: OPD_REPEAT_VISIT_FREE_HOURS_MIN,
    max: OPD_REPEAT_VISIT_FREE_HOURS_MAX,
  },
};

const PAPER_CHOICES = ['A4', 'A5'] as const;

function refuse(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field, reason });
}

function readWholeNumber(value: unknown, field: keyof typeof LIMITS): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const { min, max } = LIMITS[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    refuse(field, 'OUT_OF_RANGE');
  }
  return value;
}

/**
 * The two OPD rules a hospital sets itself: how many days a follow-up visit is free, and how many
 * hours a repeat visit to the same doctor is free. Only these two are written here; the token
 * prefix, time zone and tax settings are not part of this screen.
 */
@Injectable()
export class OpdRulesService {
  constructor(private readonly tenantDb: TenantDb) {}

  async get(tenantId: string): Promise<OpdRulesView> {
    return this.tenantDb.withTenant(async (tx) => {
      const row = await tx.opdSettings.findUnique({ where: { tenantId } });
      return {
        followUpFreeDays: row?.followUpFreeDays ?? OPD_SETTINGS_DEFAULTS.followUpFreeDays,
        repeatVisitFreeHours:
          row?.repeatVisitFreeHours ?? OPD_SETTINGS_DEFAULTS.repeatVisitFreeHours,
        defaultPrintPaper: row?.defaultPrintPaper === 'A4' ? 'A4' : 'A5',
        patientCardAutoPrint: row?.patientCardAutoPrint ?? false,
        persisted: row !== null,
        limits: LIMITS,
        paperChoices: PAPER_CHOICES,
      };
    });
  }

  async update(actor: { tenantId: string; userId: string }, body: unknown): Promise<OpdRulesView> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      refuse('body', 'REQUIRED');
    }
    const input = body as Record<string, unknown>;
    const followUpFreeDays = readWholeNumber(input.followUpFreeDays, 'followUpFreeDays');
    const repeatVisitFreeHours = readWholeNumber(
      input.repeatVisitFreeHours,
      'repeatVisitFreeHours',
    );
    let defaultPrintPaper: 'A4' | 'A5' | undefined;
    if (input.defaultPrintPaper !== undefined) {
      if (!(PAPER_CHOICES as readonly unknown[]).includes(input.defaultPrintPaper)) {
        refuse('defaultPrintPaper', 'INVALID');
      }
      defaultPrintPaper = input.defaultPrintPaper as 'A4' | 'A5';
    }
    let patientCardAutoPrint: boolean | undefined;
    if (input.patientCardAutoPrint !== undefined) {
      if (typeof input.patientCardAutoPrint !== 'boolean') {
        refuse('patientCardAutoPrint', 'INVALID');
      }
      patientCardAutoPrint = input.patientCardAutoPrint;
    }
    if (
      followUpFreeDays === undefined &&
      repeatVisitFreeHours === undefined &&
      defaultPrintPaper === undefined &&
      patientCardAutoPrint === undefined
    ) {
      refuse('body', 'REQUIRED');
    }

    await this.tenantDb.withTenant(async (tx) => {
      const existing = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
      if (existing) {
        await tx.opdSettings.update({
          where: { id: existing.id },
          data: {
            ...(followUpFreeDays !== undefined ? { followUpFreeDays } : {}),
            ...(repeatVisitFreeHours !== undefined ? { repeatVisitFreeHours } : {}),
            ...(defaultPrintPaper !== undefined ? { defaultPrintPaper } : {}),
            ...(patientCardAutoPrint !== undefined ? { patientCardAutoPrint } : {}),
          },
        });
      } else {
        await tx.opdSettings.create({
          data: {
            tenantId: actor.tenantId,
            followUpFreeDays: followUpFreeDays ?? OPD_SETTINGS_DEFAULTS.followUpFreeDays,
            repeatVisitFreeHours:
              repeatVisitFreeHours ?? OPD_SETTINGS_DEFAULTS.repeatVisitFreeHours,
            tokenPrefix: OPD_SETTINGS_DEFAULTS.tokenPrefix,
            timezone: OPD_SETTINGS_DEFAULTS.timezone,
            ...(defaultPrintPaper !== undefined ? { defaultPrintPaper } : {}),
            ...(patientCardAutoPrint !== undefined ? { patientCardAutoPrint } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'OPD_RULES_CHANGE',
          entityType: 'opd_settings',
          entityId: actor.tenantId,
          reason: 'OPD rules updated',
          metadata: {
            changed: [
              ...(followUpFreeDays !== undefined ? ['followUpFreeDays'] : []),
              ...(repeatVisitFreeHours !== undefined ? ['repeatVisitFreeHours'] : []),
              ...(defaultPrintPaper !== undefined ? ['defaultPrintPaper'] : []),
              ...(patientCardAutoPrint !== undefined ? ['patientCardAutoPrint'] : []),
            ],
          },
        },
      });
    });
    return this.get(actor.tenantId);
  }
}
