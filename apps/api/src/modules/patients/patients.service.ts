import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import { normalizePhoneIN, PHONE_INVALID_MESSAGE } from '../../common/phone.normalize';
import { requireContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { zonedParts } from './uhid.util';
import { PatientFieldsService, type PatientFieldPayload } from './patient-fields.service';
import { UhidService } from './uhid.service';
import { mergePatientFieldErrors } from './patient-dto-validation';
import { PatientFieldErrorCode, type PatientFieldErrors } from './patient-field-error.codes';
import { PatientFieldSection, patientFieldSectionRank } from './patient-field-sections';
import { Prisma } from '../../generated/prisma';
import {
  isPatientListSort,
  PATIENT_LIST_DEFAULT_PAGE_SIZE,
  PATIENT_LIST_Q_MAX_LENGTH,
  PATIENT_LIST_Q_MIN_NAME_LENGTH,
  PATIENT_LIST_Q_MIN_PHONE_DIGITS,
  PATIENT_LIST_Q_MIN_UHID_LENGTH,
  PATIENT_LIST_SORT_DEFAULT,
  PatientListSort,
} from './patients.config';
import { buildListQMatchPlan, listQWhereSql } from './patients-list-q';
import { throwPatientFieldErrors } from './patient-validation.exception';

export type RegisterPatientInput = PatientFieldPayload & {
  tenantId: string;
  registeredBranchId: string;
  createdBy: string;
  confirmDuplicate?: boolean;
  ageYears?: number;
  /** Soft class-validator codes from HospigoValidationPipe (optional). */
  dtoFieldErrors?: PatientFieldErrors;
  dtoMessages?: string[];
};

export type UpdatePatientInput = PatientFieldPayload & {
  ageYears?: number;
  dtoFieldErrors?: PatientFieldErrors;
  dtoMessages?: string[];
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

export type PatientBrowseItem = PatientListItem & {
  createdAt: string;
  registeredBranchName: string;
};

export type FormConfigField = {
  key?: string;
  code?: string;
  label: string;
  dataType: string;
  required: boolean;
  sortOrder: number;
  section: string;
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
          const alwaysRequired = s.catalog?.alwaysRequired === true;
          fields.push({
            key: s.catalogKey,
            label: s.label ?? s.catalog?.defaultLabel ?? s.catalogKey,
            dataType: s.catalog?.dataType ?? 'TEXT',
            required: alwaysRequired || s.catalogKey === 'name' || s.isRequired,
            sortOrder: s.sortOrder,
            section: s.catalog?.defaultSection ?? PatientFieldSection.OTHER,
          });
        } else if (s.customField) {
          fields.push({
            code: s.customField.code,
            label: s.label ?? s.customField.label,
            dataType: s.customField.dataType,
            required: s.isRequired,
            sortOrder: s.sortOrder,
            section: s.customField.section ?? PatientFieldSection.OTHER,
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
          section: PatientFieldSection.PERSONAL,
        });
      }
      fields.sort((a, b) => {
        const sectionDiff = patientFieldSectionRank(a.section) - patientFieldSectionRank(b.section);
        if (sectionDiff !== 0) {
          return sectionDiff;
        }
        return a.sortOrder - b.sortOrder;
      });
      return { fields };
    });
  }

  /**
   * Register a patient: allocate UHID + insert in one DB transaction.
   * Any insert failure (including UNIQUE uhid collision) rolls back the counter increment (no gaps).
   */
  async register(input: RegisterPatientInput): Promise<{ id: string; uhid: string }> {
    const dtoFieldErrors = input.dtoFieldErrors ?? {};
    const dtoMessages = input.dtoMessages ?? [];
    const serviceErrors: PatientFieldErrors = {};
    const hasAge = input.ageYears !== undefined;
    const hasDob = input.dateOfBirth !== undefined && input.dateOfBirth !== null;
    if (hasAge && hasDob) {
      serviceErrors.date_of_birth = PatientFieldErrorCode.AGE_AND_DOB_BOTH;
      serviceErrors.ageYears = PatientFieldErrorCode.AGE_AND_DOB_BOTH;
    } else if (!hasAge && !hasDob) {
      serviceErrors.date_of_birth = PatientFieldErrorCode.REQUIRED;
    } else if (hasAge) {
      if (!Number.isInteger(input.ageYears) || input.ageYears! < 0 || input.ageYears! > 150) {
        serviceErrors.ageYears = PatientFieldErrorCode.INVALID;
      }
    }

    const payload: PatientFieldPayload = {
      name: input.name,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      dobIsEstimated: input.dobIsEstimated,
      phone: input.phone,
      email: input.email,
      addressStreet: input.addressStreet,
      addressCross: input.addressCross,
      addressArea: input.addressArea,
      addressCity: input.addressCity,
      addressState: input.addressState,
      addressPincode: input.addressPincode,
      customValues: input.customValues,
    };
    if (payload.phone) {
      try {
        payload.phone = normalizePhoneIN(payload.phone);
      } catch (error) {
        if (error instanceof BadRequestException) {
          serviceErrors.phone = PatientFieldErrorCode.INVALID;
        } else {
          throw error;
        }
      }
    } else {
      serviceErrors.phone = PatientFieldErrorCode.REQUIRED;
    }

    // Skip estimated-DOB when age+DOB both (already an error) or age invalid.
    const canApplyAge =
      input.ageYears !== undefined &&
      serviceErrors.date_of_birth !== PatientFieldErrorCode.AGE_AND_DOB_BOTH &&
      serviceErrors.ageYears !== PatientFieldErrorCode.INVALID;
    if (canApplyAge) {
      const dob = await this.estimatedDobFromAge(input.tenantId, input.ageYears!);
      payload.dateOfBirth = dob;
      payload.dobIsEstimated = true;
    }

    let cleaned: PatientFieldPayload;
    try {
      const collected = await this.fields.collectForRegistration(input.tenantId, payload);
      for (const [key, code] of Object.entries(collected.fieldErrors)) {
        if (!(key in serviceErrors)) {
          serviceErrors[key] = code;
        }
      }
      cleaned = collected.cleaned;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }

    const merged = mergePatientFieldErrors(dtoFieldErrors, serviceErrors);
    if (Object.keys(merged).length > 0) {
      const message =
        dtoMessages.length > 0
          ? dtoMessages
          : serviceErrors.date_of_birth === PatientFieldErrorCode.AGE_AND_DOB_BOTH
            ? 'Send dateOfBirth or ageYears, not both'
            : serviceErrors.phone === PatientFieldErrorCode.INVALID &&
                Object.keys(serviceErrors).length === 1
              ? PHONE_INVALID_MESSAGE
              : Object.keys(merged);
      throwPatientFieldErrors(merged, message);
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

  /**
   * Browse/list patients. Optional at-most-one filter (uhid | phone | name),
   * or free-text `q` (not combined with those). None = list all. Sort defaults to newest.
   */
  async list(input: {
    tenantId: string;
    sort?: string;
    q?: string;
    uhid?: string;
    phone?: string;
    namePrefix?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: PatientBrowseItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const criteria = [input.uhid, input.phone, input.namePrefix].filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    );
    if (criteria.length > 1) {
      throw new BadRequestException('Provide at most one of uhid, phone, or name');
    }

    const qRaw = typeof input.q === 'string' ? input.q.trim() : '';
    const hasQ = qRaw.length > 0;
    if (hasQ && criteria.length > 0) {
      throw new BadRequestException('q cannot be combined with uhid, phone, or name');
    }

    const sortRaw = input.sort?.trim() || PATIENT_LIST_SORT_DEFAULT;
    if (!isPatientListSort(sortRaw)) {
      throw new BadRequestException('Invalid sort');
    }
    const sort: PatientListSort = sortRaw;

    const minName = this.config.get('PATIENT_SEARCH_MIN_NAME_LENGTH', { infer: true }) ?? 3;
    if (input.namePrefix !== undefined && input.namePrefix.trim().length < minName) {
      throw new BadRequestException(`name must be at least ${minName} characters`);
    }

    const qMax =
      this.config.get('PATIENT_LIST_Q_MAX_LENGTH', { infer: true }) ?? PATIENT_LIST_Q_MAX_LENGTH;
    const qMinName =
      this.config.get('PATIENT_LIST_Q_MIN_NAME_LENGTH', { infer: true }) ??
      PATIENT_LIST_Q_MIN_NAME_LENGTH;
    const qMinUhid =
      this.config.get('PATIENT_LIST_Q_MIN_UHID_LENGTH', { infer: true }) ??
      PATIENT_LIST_Q_MIN_UHID_LENGTH;
    const qMinPhoneDigits =
      this.config.get('PATIENT_LIST_Q_MIN_PHONE_DIGITS', { infer: true }) ??
      PATIENT_LIST_Q_MIN_PHONE_DIGITS;

    let qPlan: ReturnType<typeof buildListQMatchPlan> | undefined;
    if (hasQ) {
      if (qRaw.length > qMax) {
        throwPatientFieldErrors({ q: PatientFieldErrorCode.INVALID }, 'Invalid q');
      }
      qPlan = buildListQMatchPlan(qRaw, {
        minNameLength: qMinName,
        minUhidLength: qMinUhid,
        minPhoneDigits: qMinPhoneDigits,
      });
      if (!qPlan) {
        throwPatientFieldErrors({ q: PatientFieldErrorCode.INVALID }, 'Invalid q');
      }
    }

    const maxPage = this.config.get('PATIENT_SEARCH_MAX_PAGE_SIZE', { infer: true }) ?? 50;
    const pageSize = Math.min(
      Math.max(input.pageSize ?? PATIENT_LIST_DEFAULT_PAGE_SIZE, 1),
      maxPage,
    );
    const page = Math.max(input.page ?? 1, 1);
    const skip = (page - 1) * pageSize;

    let phone: string | undefined;
    if (input.phone) {
      try {
        phone = normalizePhoneIN(input.phone);
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw error;
      }
    }

    const uhid = input.uhid?.trim();
    const namePattern = input.namePrefix ? `${input.namePrefix.toLowerCase()}%` : undefined;
    const qWhere = qPlan ? listQWhereSql(qPlan) : Prisma.sql`TRUE`;

    return this.tenantDb.withTenant(async (tx) => {
      const opd = await tx.opdSettings.findUnique({ where: { tenantId: input.tenantId } });
      const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;

      const whereSql = Prisma.sql`
        p.tenant_id = ${input.tenantId}
        AND p.is_active = true
        AND (${uhid ?? null}::text IS NULL OR p.uhid = ${uhid ?? null})
        AND (${phone ?? null}::text IS NULL OR p.phone = ${phone ?? null})
        AND (${namePattern ?? null}::text IS NULL OR lower(p.name) LIKE ${namePattern ?? null})
        AND (${qWhere})
      `;

      const totalRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM patients p
        WHERE ${whereSql}
      `;

      type BrowseRow = {
        id: string;
        uhid: string;
        name: string;
        gender: string | null;
        date_of_birth: Date | null;
        dob_is_estimated: boolean;
        phone: string | null;
        registered_branch_id: string;
        registered_branch_name: string;
        is_active: boolean;
        created_at: Date;
      };

      // ORDER BY is a fixed Prisma.sql fragment (never user-supplied).
      let orderSql: Prisma.Sql;
      if (sort === PatientListSort.OLDEST) {
        orderSql = Prisma.sql`p.created_at ASC, p.id ASC`;
      } else if (sort === PatientListSort.NAME_ASC) {
        orderSql = Prisma.sql`lower(p.name) ASC, p.id ASC`;
      } else if (sort === PatientListSort.NAME_DESC) {
        orderSql = Prisma.sql`lower(p.name) DESC, p.id DESC`;
      } else if (sort === PatientListSort.UHID_DESC) {
        // Natural order: shorter UHIDs first when ascending (TESTA0999 before TESTA10000).
        // COLLATE "C" = plain character order, independent of the database locale.
        orderSql = Prisma.sql`length(p.uhid) DESC, p.uhid COLLATE "C" DESC, p.id DESC`;
      } else if (sort === PatientListSort.UHID_ASC) {
        orderSql = Prisma.sql`length(p.uhid) ASC, p.uhid COLLATE "C" ASC, p.id ASC`;
      } else {
        orderSql = Prisma.sql`p.created_at DESC, p.id DESC`;
      }

      const ordered = await tx.$queryRaw<BrowseRow[]>`
        SELECT p.id, p.uhid, p.name, p.gender, p.date_of_birth, p.dob_is_estimated, p.phone,
               p.registered_branch_id, b.name AS registered_branch_name, p.is_active, p.created_at
        FROM patients p
        INNER JOIN branches b ON b.tenant_id = p.tenant_id AND b.id = p.registered_branch_id
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        OFFSET ${skip} LIMIT ${pageSize}
      `;

      return {
        items: ordered.map((r) => this.toBrowseItem(r, timeZone)),
        total: Number(totalRows[0]?.count ?? 0n),
        page,
        pageSize,
      };
    });
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
      dtoFieldErrors?: PatientFieldErrors;
      dtoMessages?: string[];
    },
  ): Promise<{ id: string }> {
    if (
      patch.uhid !== undefined ||
      patch.registeredBranchId !== undefined ||
      patch.tenantId !== undefined
    ) {
      throw new BadRequestException('uhid, tenantId and registeredBranchId cannot be changed');
    }

    const dtoFieldErrors = patch.dtoFieldErrors ?? {};
    const dtoMessages = patch.dtoMessages ?? [];
    const serviceErrors: PatientFieldErrors = {};

    const hasAge = patch.ageYears !== undefined;
    const hasDob = patch.dateOfBirth !== undefined && patch.dateOfBirth !== null;
    if (hasAge && hasDob) {
      serviceErrors.date_of_birth = PatientFieldErrorCode.AGE_AND_DOB_BOTH;
      serviceErrors.ageYears = PatientFieldErrorCode.AGE_AND_DOB_BOTH;
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

    if (
      patch.ageYears !== undefined &&
      serviceErrors.date_of_birth !== PatientFieldErrorCode.AGE_AND_DOB_BOTH
    ) {
      if (!Number.isInteger(patch.ageYears) || patch.ageYears < 0 || patch.ageYears > 150) {
        serviceErrors.ageYears = PatientFieldErrorCode.INVALID;
      } else {
        next.dateOfBirth = await this.estimatedDobFromAge(tenantId, patch.ageYears);
        next.dobIsEstimated = true;
      }
    }

    // May not blank name / phone / age-or-DOB.
    if (!next.name || (typeof next.name === 'string' && next.name.trim() === '')) {
      serviceErrors.name = PatientFieldErrorCode.REQUIRED;
    }
    if (next.phone === null || next.phone === undefined || String(next.phone).trim() === '') {
      serviceErrors.phone = PatientFieldErrorCode.REQUIRED;
    }
    if (!next.dateOfBirth) {
      serviceErrors.date_of_birth = PatientFieldErrorCode.REQUIRED;
    }

    if (next.phone && serviceErrors.phone !== PatientFieldErrorCode.REQUIRED) {
      try {
        next.phone = normalizePhoneIN(String(next.phone));
      } catch (error) {
        if (error instanceof BadRequestException) {
          serviceErrors.phone = PatientFieldErrorCode.INVALID;
        } else {
          throw error;
        }
      }
    }

    let cleaned: PatientFieldPayload;
    try {
      const collected = await this.fields.collectForRegistration(tenantId, next);
      for (const [key, code] of Object.entries(collected.fieldErrors)) {
        if (!(key in serviceErrors)) {
          serviceErrors[key] = code;
        }
      }
      cleaned = collected.cleaned;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }

    const merged = mergePatientFieldErrors(dtoFieldErrors, serviceErrors);
    if (Object.keys(merged).length > 0) {
      const message =
        dtoMessages.length > 0
          ? dtoMessages
          : serviceErrors.date_of_birth === PatientFieldErrorCode.AGE_AND_DOB_BOTH
            ? 'Send dateOfBirth or ageYears, not both'
            : serviceErrors.phone === PatientFieldErrorCode.INVALID &&
                Object.keys(serviceErrors).length === 1
              ? PHONE_INVALID_MESSAGE
              : Object.keys(merged);
      throwPatientFieldErrors(merged, message);
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
   * Read-only next UHID running number + formatted preview for the active branch.
   */
  async getUhidStartNumber(input: { tenantId: string; branchId: string }): Promise<{
    nextNumber: number;
    nextUhidPreview: string;
    resetRule: string;
    periodYear: number;
    periodLabel: string | null;
  }> {
    try {
      const preview = await this.uhid.getStartNumberPreview({
        tenantId: input.tenantId,
        branchId: input.branchId,
      });
      return {
        nextNumber: Number(preview.nextNumber),
        nextUhidPreview: preview.nextUhidPreview,
        resetRule: preview.resetRule,
        periodYear: preview.periodYear,
        periodLabel: preview.periodLabel,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }
  }

  /**
   * Maps HTTP { startNumber, reason } onto UhidService.setStartNumber for the
   * current period (from effective format config), raise-only.
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

  private assertAgeOrDobExclusive(
    ageYears: number | undefined,
    dateOfBirth: Date | string | null | undefined,
  ): void {
    const hasAge = ageYears !== undefined;
    const hasDob = dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== '';
    if (hasAge && hasDob) {
      const fieldErrors: PatientFieldErrors = {
        date_of_birth: PatientFieldErrorCode.AGE_AND_DOB_BOTH,
        ageYears: PatientFieldErrorCode.AGE_AND_DOB_BOTH,
      };
      throwPatientFieldErrors(fieldErrors, 'Send dateOfBirth or ageYears, not both');
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

  private toBrowseItem(
    row: {
      id: string;
      uhid: string;
      name: string;
      gender: string | null;
      date_of_birth: Date | null;
      dob_is_estimated: boolean;
      phone: string | null;
      registered_branch_id: string;
      registered_branch_name: string;
      is_active: boolean;
      created_at: Date;
    },
    timeZone: string,
  ): PatientBrowseItem {
    return {
      ...this.toListItem(row, timeZone),
      createdAt: row.created_at.toISOString(),
      registeredBranchName: row.registered_branch_name,
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
