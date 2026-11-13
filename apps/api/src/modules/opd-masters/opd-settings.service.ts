import { Injectable } from '@nestjs/common';
import type { OpdSettings } from '../../generated/prisma';
import { TenantDb } from '../../database/tenant-db';
import { requireContext } from '../../common/request-context';
import {
  OPD_FOLLOW_UP_FREE_DAYS_MAX,
  OPD_FOLLOW_UP_FREE_DAYS_MIN,
  OPD_SETTINGS_DEFAULTS,
} from './opd-settings.defaults';

export type OpdSettingsView = {
  followUpFreeDays: number;
  tokenPrefix: string;
  timezone: string;
  taxEnabled: boolean;
  taxName: string | null;
  taxRegistrationNo: string | null;
  taxInclusive: boolean;
  persisted: boolean;
  id: string | null;
};

export type OpdSettingsUpsertInput = {
  followUpFreeDays?: number;
  tokenPrefix?: string;
  timezone?: string;
  taxEnabled?: boolean;
  taxName?: string | null;
  taxRegistrationNo?: string | null;
  taxInclusive?: boolean;
};

function validateUpsert(input: OpdSettingsUpsertInput): void {
  if (input.followUpFreeDays !== undefined) {
    const d = input.followUpFreeDays;
    if (
      !Number.isInteger(d) ||
      d < OPD_FOLLOW_UP_FREE_DAYS_MIN ||
      d > OPD_FOLLOW_UP_FREE_DAYS_MAX
    ) {
      throw new Error(
        `follow_up_free_days must be ${OPD_FOLLOW_UP_FREE_DAYS_MIN}..${OPD_FOLLOW_UP_FREE_DAYS_MAX}`,
      );
    }
  }
  if (input.tokenPrefix !== undefined && input.tokenPrefix.length === 0) {
    throw new Error('token_prefix must not be empty');
  }
  if (input.timezone !== undefined && input.timezone.length === 0) {
    throw new Error('timezone must not be empty');
  }
}

function toView(row: OpdSettings): OpdSettingsView {
  return {
    followUpFreeDays: row.followUpFreeDays,
    tokenPrefix: row.tokenPrefix,
    timezone: row.timezone,
    taxEnabled: row.taxEnabled,
    taxName: row.taxName,
    taxRegistrationNo: row.taxRegistrationNo,
    taxInclusive: row.taxInclusive,
    persisted: true,
    id: row.id,
  };
}

@Injectable()
export class OpdSettingsService {
  constructor(private readonly tenantDb: TenantDb) {}

  /** Returns the row or documented defaults; never writes on read. */
  async get(): Promise<OpdSettingsView> {
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      const row = await tx.opdSettings.findUnique({ where: { tenantId: ctx.tenantId! } });
      if (!row) {
        return {
          followUpFreeDays: OPD_SETTINGS_DEFAULTS.followUpFreeDays,
          tokenPrefix: OPD_SETTINGS_DEFAULTS.tokenPrefix,
          timezone: OPD_SETTINGS_DEFAULTS.timezone,
          taxEnabled: OPD_SETTINGS_DEFAULTS.taxEnabled,
          taxName: OPD_SETTINGS_DEFAULTS.taxName,
          taxRegistrationNo: OPD_SETTINGS_DEFAULTS.taxRegistrationNo,
          taxInclusive: OPD_SETTINGS_DEFAULTS.taxInclusive,
          persisted: false,
          id: null,
        };
      }
      return toView(row);
    });
  }

  async upsert(input: OpdSettingsUpsertInput): Promise<OpdSettingsView> {
    validateUpsert(input);
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      const tenantId = ctx.tenantId!;
      const existing = await tx.opdSettings.findUnique({ where: { tenantId } });
      const data = {
        followUpFreeDays: input.followUpFreeDays ?? OPD_SETTINGS_DEFAULTS.followUpFreeDays,
        tokenPrefix: input.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix,
        timezone: input.timezone ?? OPD_SETTINGS_DEFAULTS.timezone,
        taxEnabled: input.taxEnabled ?? OPD_SETTINGS_DEFAULTS.taxEnabled,
        taxName: input.taxName === undefined ? OPD_SETTINGS_DEFAULTS.taxName : input.taxName,
        taxRegistrationNo:
          input.taxRegistrationNo === undefined
            ? OPD_SETTINGS_DEFAULTS.taxRegistrationNo
            : input.taxRegistrationNo,
        taxInclusive: input.taxInclusive ?? OPD_SETTINGS_DEFAULTS.taxInclusive,
      };
      if (existing) {
        const row = await tx.opdSettings.update({
          where: { id: existing.id },
          data: {
            followUpFreeDays: input.followUpFreeDays ?? existing.followUpFreeDays,
            tokenPrefix: input.tokenPrefix ?? existing.tokenPrefix,
            timezone: input.timezone ?? existing.timezone,
            taxEnabled: input.taxEnabled ?? existing.taxEnabled,
            taxName: input.taxName === undefined ? existing.taxName : input.taxName,
            taxRegistrationNo:
              input.taxRegistrationNo === undefined
                ? existing.taxRegistrationNo
                : input.taxRegistrationNo,
            taxInclusive: input.taxInclusive ?? existing.taxInclusive,
          },
        });
        return toView(row);
      }
      const row = await tx.opdSettings.create({
        data: { tenantId, ...data },
      });
      return toView(row);
    });
  }
}
