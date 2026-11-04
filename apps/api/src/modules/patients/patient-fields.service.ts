import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type PatientFieldPayload = {
  name: string;
  gender?: string | null;
  dateOfBirth?: Date | null;
  dobIsEstimated?: boolean;
  phone?: string | null;
  email?: string | null;
  addressStreet?: string | null;
  addressCross?: string | null;
  addressArea?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  customValues?: Array<{
    fieldId: string;
    valueText?: string | null;
    valueNumber?: number | null;
    valueDate?: Date | null;
    optionId?: string | null;
  }>;
};

export type FieldValidationResult = {
  cleaned: PatientFieldPayload;
  ignoredDisabled: string[];
  rejectedDisabled: string[];
};

const SYSTEM_KEY_TO_PAYLOAD: Record<string, keyof PatientFieldPayload> = {
  name: 'name',
  gender: 'gender',
  date_of_birth: 'dateOfBirth',
  phone: 'phone',
  email: 'email',
  address_street: 'addressStreet',
  address_cross: 'addressCross',
  address_area: 'addressArea',
  address_city: 'addressCity',
  address_state: 'addressState',
  address_pincode: 'addressPincode',
};

@Injectable()
export class PatientFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply hospital field settings to a registration payload.
   * name is always required. Disabled fields are ignored by default (or rejected if rejectDisabled).
   * Changing settings never invalidates old patients.
   */
  async validateForRegistration(
    tenantId: string,
    input: PatientFieldPayload,
    options?: { rejectDisabled?: boolean },
  ): Promise<FieldValidationResult> {
    const rejectDisabled = options?.rejectDisabled === true;

    // set_config must share a connection with reads (pg pool); keep them in one transaction.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const settings = await tx.patientFieldSetting.findMany({
        where: { tenantId },
        include: { catalog: true, customField: true },
        orderBy: { sortOrder: 'asc' },
      });

      const ignoredDisabled: string[] = [];
      const rejectedDisabled: string[] = [];
      const cleaned: PatientFieldPayload = { name: input.name?.trim() ?? '' };

      if (!cleaned.name) {
        throw new Error('Patient name is required');
      }

      const nameSetting = settings.find((s) => s.catalogKey === 'name');
      if (nameSetting && !nameSetting.isEnabled) {
        throw new Error('Patient name field cannot be disabled');
      }

      for (const setting of settings) {
        if (!setting.catalogKey) {
          continue;
        }
        const key = setting.catalogKey;
        const prop = SYSTEM_KEY_TO_PAYLOAD[key];
        if (!prop || prop === 'name') {
          continue;
        }
        const raw = input[prop];
        const present =
          raw !== undefined && raw !== null && !(typeof raw === 'string' && raw.trim() === '');

        if (!setting.isEnabled) {
          if (present) {
            if (rejectDisabled) {
              rejectedDisabled.push(key);
            } else {
              ignoredDisabled.push(key);
            }
          }
          continue;
        }

        if (setting.isRequired && !present) {
          throw new Error(`Required patient field missing: ${setting.label ?? key}`);
        }
        if (present) {
          assignSystemField(cleaned, prop, raw);
        }
      }

      if (input.dobIsEstimated !== undefined) {
        cleaned.dobIsEstimated = input.dobIsEstimated;
      }

      const customValues: NonNullable<PatientFieldPayload['customValues']> = [];
      const inputCustoms = input.customValues ?? [];

      for (const setting of settings.filter((s) => s.customFieldId)) {
        const fieldId = setting.customFieldId!;
        const provided = inputCustoms.find((c) => c.fieldId === fieldId);
        const present = Boolean(provided);

        if (!setting.isEnabled) {
          if (present) {
            if (rejectDisabled) {
              rejectedDisabled.push(setting.customField?.code ?? fieldId);
            } else {
              ignoredDisabled.push(setting.customField?.code ?? fieldId);
            }
          }
          continue;
        }
        if (setting.isRequired && !present) {
          throw new Error(
            `Required custom field missing: ${setting.label ?? setting.customField?.code ?? fieldId}`,
          );
        }
        if (present && provided) {
          customValues.push(provided);
        }
      }

      if (rejectedDisabled.length > 0) {
        throw new Error(`Disabled patient fields rejected: ${rejectedDisabled.join(', ')}`);
      }

      cleaned.customValues = customValues;
      return { cleaned, ignoredDisabled, rejectedDisabled };
    });
  }

  async updateSystemFieldSetting(input: {
    tenantId: string;
    catalogKey: string;
    isEnabled: boolean;
    isRequired: boolean;
    label?: string | null;
    sortOrder?: number;
    changedBy: string;
  }): Promise<void> {
    if (input.catalogKey === 'name' && !input.isEnabled) {
      throw new Error('Patient name field cannot be disabled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
      const catalog = await tx.patientFieldCatalog.findUnique({ where: { key: input.catalogKey } });
      if (!catalog) {
        throw new Error(`Unknown catalog field: ${input.catalogKey}`);
      }
      if (!catalog.canDisable && !input.isEnabled) {
        throw new Error(`Catalog field cannot be disabled: ${input.catalogKey}`);
      }

      const isRequired = input.catalogKey === 'name' ? true : input.isRequired;

      await tx.patientFieldSetting.upsert({
        where: {
          tenantId_catalogKey: { tenantId: input.tenantId, catalogKey: input.catalogKey },
        },
        create: {
          tenantId: input.tenantId,
          catalogKey: input.catalogKey,
          isEnabled: input.isEnabled,
          isRequired,
          label: input.label ?? catalog.defaultLabel,
          sortOrder: input.sortOrder ?? 0,
          changedBy: input.changedBy,
          changedAt: new Date(),
        },
        update: {
          isEnabled: input.isEnabled,
          isRequired,
          label: input.label ?? undefined,
          sortOrder: input.sortOrder,
          changedBy: input.changedBy,
          changedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.changedBy,
          action: 'PATIENT_FIELD_SETTING_CHANGE',
          entityType: 'patient_field_settings',
          entityId: input.catalogKey,
          reason: 'Field setting updated',
          metadata: {
            catalogKey: input.catalogKey,
            isEnabled: input.isEnabled,
            isRequired,
          },
        },
      });
    });
  }
}

function assignSystemField(
  cleaned: PatientFieldPayload,
  prop: keyof PatientFieldPayload,
  raw: unknown,
): void {
  if (prop === 'name' || prop === 'customValues' || prop === 'dobIsEstimated') {
    return;
  }
  if (prop === 'dateOfBirth') {
    cleaned.dateOfBirth = raw as Date | null;
    return;
  }
  cleaned[prop] = raw as string | null;
}
