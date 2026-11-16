import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import { normalizePhoneIN } from '../../common/phone.normalize';
import { requireContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { zonedParts } from './uhid.util';
import { PatientFieldsService, type PatientFieldPayload } from './patient-fields.service';
import { UhidService } from './uhid.service';

export type RegisterPatientInput = PatientFieldPayload & {
  tenantId: string;
  registeredBranchId: string;
  createdBy: string;
  confirmDuplicate?: boolean;
  ageYears?: number;
};

export type PatientListItem = {
  id: string;
  uhid: string;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  ageYears: number | null;
  dobIsEstimated: boolean;
  phone: string | null;
  registeredBranchId: string;
  isActive: boolean;
};

export type FormConfigField = {
  key?: string;
  code?: string;
  label: string;
  dataType: string;
  required: boolean;
  sortOrder: number;
  options?: Array<{ id: string; label: string; sortOrder: number }>;
};

@Injectable()
export class PatientsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly fields: PatientFieldsService,
    private readonly uhid: UhidService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  async getFormConfig(tenantId: string): Promise<{ fields: FormConfigField[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const settings = await tx.patientFieldSetting.findMany({
        where: { tenantId, isEnabled: true },
        include: {
          catalog: true,
          customField: {
            include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });

      const fields: FormConfigField[] = [];
      let hasName = false;
      for (const s of settings) {
        if (s.catalogKey) {
          if (s.catalogKey === 'name') {
            hasName = true;
          }
          fields.push({
            key: s.catalogKey,
            label: s.label ?? s.catalog?.defaultLabel ?? s.catalogKey,
            dataType: s.catalog?.dataType ?? 'TEXT',
            required: s.catalogKey === 'name' ? true : s.isRequired,
            sortOrder: s.sortOrder,
          });
        } else if (s.customField) {
          fields.push({
            code: s.customField.code,
            label: s.label ?? s.customField.label,
            dataType: s.customField.dataType,
            required: s.isRequired,
            sortOrder: s.sortOrder,
            options: s.customField.options.map((o) => ({
              id: o.id,
              label: o.label,
              sortOrder: o.sortOrder,
            })),
          });
        }
      }
      if (!hasName) {
        fields.unshift({
          key: 'name',
          label: 'Full name',
          dataType: 'TEXT',
          required: true,
          sortOrder: -1,
        });
      }
      return { fields };
    });
  }

  /**
   * Register a patient: allocate UHID + insert in one DB transaction.
   * Any insert failure (including UNIQUE uhid collision) rolls back the counter increment (no gaps).
   */
  async register(input: RegisterPatientInput): Promise<{ id: string; uhid: string }> {
    if (input.ageYears !== undefined && input.dateOfBirth) {
      throw new BadRequestException('Send dateOfBirth or ageYears, not both');
    }

    const payload: PatientFieldPayload = { ...input };
    if (input.ageYears !== undefined) {
      if (!Number.isInteger(input.ageYears) || input.ageYears < 0 || input.ageYears > 150) {
        throw new BadRequestException('ageYears must be an integer 0..150');
      }
      const dob = await this.estimatedDobFromAge(input.tenantId, input.ageYears);
      payload.dateOfBirth = dob;
      payload.dobIsEstimated = true;
    }

    if (payload.phone) {
      payload.phone = normalizePhoneIN(payload.phone);
    }

    let cleaned: PatientFieldPayload;
    try {
      ({ cleaned } = await this.fields.validateForRegistration(input.tenantId, payload));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }

    try {
      return await this.tenantDb.withTenant(async (tx) => {
        if (cleaned.phone && !input.confirmDuplicate) {
          const matches = await tx.$queryRaw<Array<{ id: string; uhid: string; name: string }>>`
            SELECT id, uhid, name FROM patients
            WHERE tenant_id = ${input.tenantId}
              AND is_active = true
              AND phone = ${cleaned.phone}
              AND lower(btrim(name)) = lower(btrim(${cleaned.name}))
            ORDER BY created_at DESC
            LIMIT 5
          `;
          if (matches.length > 0) {
            throw new ConflictException({
              statusCode: 409,
              code: 'POSSIBLE_DUPLICATE',
              matches: matches.map((m) => ({ id: m.id, uhid: m.uhid, name: m.name })),
            });
          }
        }

        const { uhid } = await this.uhid.allocateNextUhid({
          tenantId: input.tenantId,
          branchId: input.registeredBranchId,
          tx,
        });

        const patient = await tx.patient.create({
          data: {
            tenantId: input.tenantId,
            uhid,
            registeredBranchId: input.registeredBranchId,
            name: cleaned.name,
            gender: cleaned.gender ?? null,
            dateOfBirth: cleaned.dateOfBirth ?? null,
            dobIsEstimated: cleaned.dobIsEstimated ?? false,
            phone: cleaned.phone ?? null,
            email: cleaned.email ?? null,
            addressStreet: cleaned.addressStreet ?? null,
            addressCross: cleaned.addressCross ?? null,
            addressArea: cleaned.addressArea ?? null,
            addressCity: cleaned.addressCity ?? null,
            addressState: cleaned.addressState ?? null,
            addressPincode: cleaned.addressPincode ?? null,
            createdBy: input.createdBy,
            customFieldValues: cleaned.customValues?.length
              ? {
                  create: cleaned.customValues.map((v) => ({
                    fieldId: v.fieldId,
                    valueText: v.valueText ?? null,
                    valueNumber: v.valueNumber ?? null,
                    valueDate: v.valueDate ?? null,
                    optionId: v.optionId ?? null,
                  })),
                }
              : undefined,
          },
        });

        const ctx = requireContext();
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.createdBy,
            branchId: input.registeredBranchId,
            action: 'PATIENT_REGISTER',
            entityType: 'patient',
            entityId: patient.id,
            metadata: { uhid: patient.uhid, branchId: input.registeredBranchId },
          },
        });
        void ctx;

        return { id: patient.id, uhid: patient.uhid };
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/unique|patients_tenant_id_uhid/i.test(message)) {
        throw new Error(
          `Patient registration refused: UHID collision with an existing value; counter was not advanced. (${message})`,
        );
      }
      throw error;
    }
  }

  async search(input: {
    tenantId: string;
    uhid?: string;
    phone?: string;
    namePrefix?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: PatientListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const criteria = [input.uhid, input.phone, input.namePrefix].filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    );
    if (criteria.length !== 1) {
      throw new BadRequestException('Provide exactly one of uhid, phone, or name');
    }

    const minName = this.config.get('PATIENT_SEARCH_MIN_NAME_LENGTH', { infer: true }) ?? 3;
    if (input.namePrefix !== undefined && input.namePrefix.trim().length < minName) {
      throw new BadRequestException(`name must be at least ${minName} characters`);
    }

    const maxPage = this.config.get('PATIENT_SEARCH_MAX_PAGE_SIZE', { infer: true }) ?? 50;
    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), maxPage);
    const page = Math.max(input.page ?? 1, 1);
    const skip = (page - 1) * pageSize;

    const phone = input.phone ? normalizePhoneIN(input.phone) : undefined;

    return this.tenantDb.withTenant(async (tx) => {
      const opd = await tx.opdSettings.findUnique({ where: { tenantId: input.tenantId } });
      const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;

      if (input.namePrefix) {
        const pattern = `${input.namePrefix.toLowerCase()}%`;
        const totalRows = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM patients
          WHERE tenant_id = ${input.tenantId} AND is_active = true
            AND lower(name) LIKE ${pattern}
        `;
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            uhid: string;
            name: string;
            gender: string | null;
            date_of_birth: Date | null;
            dob_is_estimated: boolean;
            phone: string | null;
            registered_branch_id: string;
            is_active: boolean;
          }>
        >`
          SELECT id, uhid, name, gender, date_of_birth, dob_is_estimated, phone,
                 registered_branch_id, is_active
          FROM patients
          WHERE tenant_id = ${input.tenantId} AND is_active = true
            AND lower(name) LIKE ${pattern}
          ORDER BY name ASC, id ASC
          OFFSET ${skip} LIMIT ${pageSize}
        `;
        return {
          items: rows.map((r) => this.toListItem(r, timeZone)),
          total: Number(totalRows[0]?.count ?? 0n),
          page,
          pageSize,
        };
      }

      const where: {
        tenantId: string;
        uhid?: string;
        phone?: string;
        isActive: boolean;
      } = {
        tenantId: input.tenantId,
        isActive: true,
      };
      if (input.uhid) {
        where.uhid = input.uhid.trim();
      } else if (phone) {
        where.phone = phone;
      }

      const [total, rows] = await Promise.all([
        tx.patient.count({ where }),
        tx.patient.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take: pageSize,
        }),
      ]);

      return {
        items: rows.map((r) =>
          this.toListItem(
            {
              id: r.id,
              uhid: r.uhid,
              name: r.name,
              gender: r.gender,
              date_of_birth: r.dateOfBirth,
              dob_is_estimated: r.dobIsEstimated,
              phone: r.phone,
              registered_branch_id: r.registeredBranchId,
              is_active: r.isActive,
            },
            timeZone,
          ),
        ),
        total,
        page,
        pageSize,
      };
    });
  }

  async getById(
    tenantId: string,
    id: string,
    actorUserId: string,
    branchId: string | null,
  ): Promise<Record<string, unknown>> {
    return this.tenantDb.withTenant(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { tenantId, id },
        include: {
          customFieldValues: {
            include: { field: true, option: true },
          },
        },
      });
      if (!patient) {
        throw new NotFoundException('Patient not found');
      }

      const opd = await tx.opdSettings.findUnique({ where: { tenantId } });
      const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          branchId: branchId ?? undefined,
          action: 'PATIENT_VIEW',
          entityType: 'patient',
          entityId: patient.id,
          metadata: {},
        },
      });

      return {
        id: patient.id,
        uhid: patient.uhid,
        name: patient.name,
        gender: patient.gender,
        dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0, 10) : null,
        ageYears: ageYearsFromDob(patient.dateOfBirth, timeZone),
        dobIsEstimated: patient.dobIsEstimated,
        phone: patient.phone,
        email: patient.email,
        addressStreet: patient.addressStreet,
        addressCross: patient.addressCross,
        addressArea: patient.addressArea,
        addressCity: patient.addressCity,
        addressState: patient.addressState,
        addressPincode: patient.addressPincode,
        registeredBranchId: patient.registeredBranchId,
        isActive: patient.isActive,
        customFieldValues: patient.customFieldValues.map((v) => ({
          code: v.field.code,
          valueText: v.valueText,
          valueNumber: v.valueNumber !== null ? Number(v.valueNumber) : null,
          valueDate: v.valueDate ? v.valueDate.toISOString().slice(0, 10) : null,
          optionId: v.optionId,
          optionLabel: v.option?.label ?? null,
        })),
      };
    });
  }

  async update(
    tenantId: string,
    id: string,
    actorUserId: string,
    patch: Partial<PatientFieldPayload> & {
      ageYears?: number;
      uhid?: unknown;
      registeredBranchId?: unknown;
      tenantId?: unknown;
    },
  ): Promise<{ id: string }> {
    if (
      patch.uhid !== undefined ||
      patch.registeredBranchId !== undefined ||
      patch.tenantId !== undefined
    ) {
      throw new BadRequestException('uhid, tenantId and registeredBranchId cannot be changed');
    }
    if (patch.ageYears !== undefined && patch.dateOfBirth) {
      throw new BadRequestException('Send dateOfBirth or ageYears, not both');
    }

    const existing = await this.tenantDb.withTenant(async (tx) =>
      tx.patient.findFirst({ where: { tenantId, id } }),
    );
    if (!existing) {
      throw new NotFoundException('Patient not found');
    }

    const next: PatientFieldPayload = {
      name: patch.name !== undefined ? patch.name : existing.name,
      gender: patch.gender !== undefined ? patch.gender : existing.gender,
      dateOfBirth: patch.dateOfBirth !== undefined ? patch.dateOfBirth : existing.dateOfBirth,
      dobIsEstimated:
        patch.dobIsEstimated !== undefined ? patch.dobIsEstimated : existing.dobIsEstimated,
      phone: patch.phone !== undefined ? patch.phone : existing.phone,
      email: patch.email !== undefined ? patch.email : existing.email,
      addressStreet:
        patch.addressStreet !== undefined ? patch.addressStreet : existing.addressStreet,
      addressCross: patch.addressCross !== undefined ? patch.addressCross : existing.addressCross,
      addressArea: patch.addressArea !== undefined ? patch.addressArea : existing.addressArea,
      addressCity: patch.addressCity !== undefined ? patch.addressCity : existing.addressCity,
      addressState: patch.addressState !== undefined ? patch.addressState : existing.addressState,
      addressPincode:
        patch.addressPincode !== undefined ? patch.addressPincode : existing.addressPincode,
      customValues: patch.customValues,
    };

    if (patch.ageYears !== undefined) {
      if (!Number.isInteger(patch.ageYears) || patch.ageYears < 0 || patch.ageYears > 150) {
        throw new BadRequestException('ageYears must be an integer 0..150');
      }
      next.dateOfBirth = await this.estimatedDobFromAge(tenantId, patch.ageYears);
      next.dobIsEstimated = true;
    }
    if (next.phone) {
      next.phone = normalizePhoneIN(next.phone);
    }

    let cleaned: PatientFieldPayload;
    try {
      ({ cleaned } = await this.fields.validateForRegistration(tenantId, next));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }

    return this.tenantDb.withTenant(async (tx) => {
      const changedFields: string[] = [];
      const data: Record<string, unknown> = {};
      const map: Array<[keyof typeof cleaned, string, unknown]> = [
        ['name', 'name', cleaned.name],
        ['gender', 'gender', cleaned.gender ?? null],
        ['dateOfBirth', 'dateOfBirth', cleaned.dateOfBirth ?? null],
        ['dobIsEstimated', 'dobIsEstimated', cleaned.dobIsEstimated ?? false],
        ['phone', 'phone', cleaned.phone ?? null],
        ['email', 'email', cleaned.email ?? null],
        ['addressStreet', 'addressStreet', cleaned.addressStreet ?? null],
        ['addressCross', 'addressCross', cleaned.addressCross ?? null],
        ['addressArea', 'addressArea', cleaned.addressArea ?? null],
        ['addressCity', 'addressCity', cleaned.addressCity ?? null],
        ['addressState', 'addressState', cleaned.addressState ?? null],
        ['addressPincode', 'addressPincode', cleaned.addressPincode ?? null],
      ];
      for (const [key, fieldName, value] of map) {
        const prev = existing[key as keyof typeof existing];
        const prevCmp = prev instanceof Date ? prev.toISOString().slice(0, 10) : (prev as unknown);
        const nextCmp = value instanceof Date ? value.toISOString().slice(0, 10) : value;
        if (JSON.stringify(prevCmp) !== JSON.stringify(nextCmp)) {
          changedFields.push(fieldName);
          data[fieldName] = value;
        }
      }

      if (Object.keys(data).length > 0) {
        await tx.patient.update({ where: { id }, data });
      }

      if (cleaned.customValues) {
        for (const v of cleaned.customValues) {
          await tx.patientCustomFieldValue.upsert({
            where: {
              tenantId_patientId_fieldId: {
                tenantId,
                patientId: id,
                fieldId: v.fieldId,
              },
            },
            create: {
              tenantId,
              patientId: id,
              fieldId: v.fieldId,
              valueText: v.valueText ?? null,
              valueNumber: v.valueNumber ?? null,
              valueDate: v.valueDate ?? null,
              optionId: v.optionId ?? null,
            },
            update: {
              valueText: v.valueText ?? null,
              valueNumber: v.valueNumber ?? null,
              valueDate: v.valueDate ?? null,
              optionId: v.optionId ?? null,
            },
          });
        }
        if (cleaned.customValues.length > 0) {
          changedFields.push('customFieldValues');
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: actorUserId,
          action: 'PATIENT_UPDATE',
          entityType: 'patient',
          entityId: id,
          metadata: { changedFields },
        },
      });

      return { id };
    });
  }

  /**
   * Maps HTTP { startNumber, reason } onto UhidService.setStartNumber:
   * periodYear 0 (NEVER counter; raise-only for the hospital-wide sequence),
   * nextNumber = startNumber (the next value to issue).
   */
  async setUhidStartNumber(input: {
    tenantId: string;
    startNumber: bigint;
    reason: string;
    actorUserId: string;
  }): Promise<void> {
    try {
      await this.uhid.setStartNumber({
        tenantId: input.tenantId,
        periodYear: 0,
        nextNumber: input.startNumber,
        reason: input.reason,
        actorUserId: input.actorUserId,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }
  }

  private async estimatedDobFromAge(tenantId: string, ageYears: number): Promise<Date> {
    return this.tenantDb.withTenant(async (tx) => {
      const opd = await tx.opdSettings.findUnique({ where: { tenantId } });
      const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
      const { year, month, day } = zonedParts(new Date(), timeZone);
      const y = year - ageYears;
      return new Date(Date.UTC(y, month - 1, day));
    });
  }

  private toListItem(
    row: {
      id: string;
      uhid: string;
      name: string;
      gender: string | null;
      date_of_birth: Date | null;
      dob_is_estimated: boolean;
      phone: string | null;
      registered_branch_id: string;
      is_active: boolean;
    },
    timeZone: string,
  ): PatientListItem {
    return {
      id: row.id,
      uhid: row.uhid,
      name: row.name,
      gender: row.gender,
      dateOfBirth: row.date_of_birth ? row.date_of_birth.toISOString().slice(0, 10) : null,
      ageYears: ageYearsFromDob(row.date_of_birth, timeZone),
      dobIsEstimated: row.dob_is_estimated,
      phone: row.phone,
      registeredBranchId: row.registered_branch_id,
      isActive: row.is_active,
    };
  }
}

function ageYearsFromDob(dob: Date | null, timeZone: string): number | null {
  if (!dob) {
    return null;
  }
  const now = zonedParts(new Date(), timeZone);
  const d = {
    year: dob.getUTCFullYear(),
    month: dob.getUTCMonth() + 1,
    day: dob.getUTCDate(),
  };
  let age = now.year - d.year;
  if (now.month < d.month || (now.month === d.month && now.day < d.day)) {
    age -= 1;
  }
  return age;
}
