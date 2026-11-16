import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../database/tenant-db';
import {
  customFieldErrorKey,
  PatientFieldErrorCode,
  type PatientFieldErrors,
} from './patient-field-error.codes';
import { PATIENT_PINCODE_LENGTH } from './patients.config';
import { throwPatientFieldErrors } from './patient-validation.exception';

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

export type FieldValidationCollectResult = FieldValidationResult & {
  fieldErrors: PatientFieldErrors;
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
  constructor(private readonly tenantDb: TenantDb) {}

  /**
   * Apply hospital field settings to a registration/update payload.
   * name, phone, and date_of_birth (age-or-DOB resolved upstream) are always required.
   * Returns all fieldErrors without throwing (caller merges / throws once).
   */
  async collectForRegistration(
    tenantId: string,
    input: PatientFieldPayload,
    options?: { rejectDisabled?: boolean },
  ): Promise<FieldValidationCollectResult> {
    const rejectDisabled = options?.rejectDisabled === true;

    return this.tenantDb.withTenant(async (tx) => {
      const settings = await tx.patientFieldSetting.findMany({
        where: { tenantId },
        include: { catalog: true, customField: true },
        orderBy: { sortOrder: 'asc' },
      });

      const ignoredDisabled: string[] = [];
      const rejectedDisabled: string[] = [];
      const fieldErrors: PatientFieldErrors = {};
      const cleaned: PatientFieldPayload = { name: input.name?.trim() ?? '' };

      if (!cleaned.name) {
        fieldErrors.name = PatientFieldErrorCode.REQUIRED;
      }

      const nameSetting = settings.find((s) => s.catalogKey === 'name');
      if (nameSetting && !nameSetting.isEnabled) {
        fieldErrors.name = PatientFieldErrorCode.REQUIRED;
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

        const alwaysRequired = setting.catalog?.alwaysRequired === true;
        const canDisable = setting.catalog?.canDisable !== false;
        const isEnabled = alwaysRequired ? true : setting.isEnabled;
        const isRequired = alwaysRequired || setting.isRequired;

        if (!isEnabled) {
          if (present) {
            if (rejectDisabled) {
              rejectedDisabled.push(key);
            } else {
              ignoredDisabled.push(key);
            }
          }
          continue;
        }

        if (isRequired && !present) {
          // date_of_birth always-required is enforced upstream as age-or-DOB;
          // if DOB still missing here, mark REQUIRED.
          fieldErrors[key] = PatientFieldErrorCode.REQUIRED;
        }

        if (present) {
          if (key === 'address_pincode') {
            const pin = String(raw).trim();
            if (!isValidPincode(pin)) {
              fieldErrors.address_pincode = PatientFieldErrorCode.INVALID;
            } else {
              cleaned.addressPincode = pin;
            }
          } else {
            assignSystemField(cleaned, prop, raw);
          }
        } else if (!isRequired && key === 'address_pincode' && raw !== undefined && raw !== null) {
          const pin = String(raw).trim();
          if (pin !== '' && !isValidPincode(pin)) {
            fieldErrors.address_pincode = PatientFieldErrorCode.INVALID;
          }
        }

        void canDisable;
      }

      // Phone always required even if settings row missing.
      if (!cleaned.phone || (typeof cleaned.phone === 'string' && cleaned.phone.trim() === '')) {
        const phonePresent =
          input.phone !== undefined &&
          input.phone !== null &&
          !(typeof input.phone === 'string' && input.phone.trim() === '');
        if (!phonePresent) {
          fieldErrors.phone = PatientFieldErrorCode.REQUIRED;
        }
      }

      if (input.dobIsEstimated !== undefined) {
        cleaned.dobIsEstimated = input.dobIsEstimated;
      }

      const customValues: NonNullable<PatientFieldPayload['customValues']> = [];
      const inputCustoms = input.customValues ?? [];

      for (const setting of settings.filter((s) => s.customFieldId)) {
        const fieldId = setting.customFieldId!;
        const code = setting.customField?.code ?? fieldId;
        const errorKey = customFieldErrorKey(code);
        const provided = inputCustoms.find((c) => c.fieldId === fieldId);
        const present = Boolean(provided);

        if (!setting.isEnabled) {
          if (present) {
            if (rejectDisabled) {
              rejectedDisabled.push(code);
            } else {
              ignoredDisabled.push(code);
            }
          }
          continue;
        }
        if (setting.isRequired && !present) {
          fieldErrors[errorKey] = PatientFieldErrorCode.REQUIRED;
        }
        if (present && provided) {
          customValues.push(provided);
        }
      }

      if (rejectedDisabled.length > 0) {
        for (const key of rejectedDisabled) {
          const errKey = SYSTEM_KEY_TO_PAYLOAD[key] ? key : customFieldErrorKey(key);
          fieldErrors[errKey] = PatientFieldErrorCode.INVALID;
        }
      }

      cleaned.customValues = customValues;
      return { cleaned, ignoredDisabled, rejectedDisabled, fieldErrors };
    });
  }

  /**
   * Apply hospital field settings; throws one 400 when any fieldErrors are present.
   */
  async validateForRegistration(
    tenantId: string,
    input: PatientFieldPayload,
    options?: { rejectDisabled?: boolean },
  ): Promise<FieldValidationResult> {
    const collected = await this.collectForRegistration(tenantId, input, options);
    if (Object.keys(collected.fieldErrors).length > 0) {
      throwPatientFieldErrors(collected.fieldErrors, Object.keys(collected.fieldErrors));
    }
    return {
      cleaned: collected.cleaned,
      ignoredDisabled: collected.ignoredDisabled,
      rejectedDisabled: collected.rejectedDisabled,
    };
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
    await this.tenantDb.withTenant(async (tx) => {
      const catalog = await tx.patientFieldCatalog.findUnique({ where: { key: input.catalogKey } });
      if (!catalog) {
        throw new Error(`Unknown catalog field: ${input.catalogKey}`);
      }
      if (!catalog.canDisable && !input.isEnabled) {
        throw new Error(`Catalog field cannot be disabled: ${input.catalogKey}`);
      }
      if (catalog.alwaysRequired && !input.isRequired) {
        throw new Error(`Catalog field is always required: ${input.catalogKey}`);
      }
      if (catalog.alwaysRequired && !input.isEnabled) {
        throw new Error(`Catalog field cannot be disabled: ${input.catalogKey}`);
      }

      const isRequired = catalog.alwaysRequired ? true : input.isRequired;
      const isEnabled = catalog.alwaysRequired || !catalog.canDisable ? true : input.isEnabled;

      await tx.patientFieldSetting.upsert({
        where: {
          tenantId_catalogKey: { tenantId: input.tenantId, catalogKey: input.catalogKey },
        },
        create: {
          tenantId: input.tenantId,
          catalogKey: input.catalogKey,
          isEnabled,
          isRequired,
          label: input.label ?? catalog.defaultLabel,
          sortOrder: input.sortOrder ?? 0,
          changedBy: input.changedBy,
          changedAt: new Date(),
        },
        update: {
          isEnabled,
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
            isEnabled,
            isRequired,
          },
        },
      });
    });
  }
}

export function isValidPincode(value: string): boolean {
  return new RegExp(`^\\d{${PATIENT_PINCODE_LENGTH}}$`).test(value);
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
