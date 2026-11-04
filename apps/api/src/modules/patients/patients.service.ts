import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import { TenantDb } from '../../database/tenant-db';
import { PatientFieldsService, type PatientFieldPayload } from './patient-fields.service';
import { UhidService } from './uhid.service';

export type RegisterPatientInput = PatientFieldPayload & {
  tenantId: string;
  registeredBranchId: string;
  createdBy: string;
};

@Injectable()
export class PatientsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly fields: PatientFieldsService,
    private readonly uhid: UhidService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  /**
   * Register a patient: allocate UHID + insert in one DB transaction.
   * Any insert failure (including UNIQUE uhid collision) rolls back the counter increment (no gaps).
   */
  async register(input: RegisterPatientInput): Promise<{ id: string; uhid: string }> {
    const { cleaned, ignoredDisabled } = await this.fields.validateForRegistration(
      input.tenantId,
      input,
    );
    void ignoredDisabled;

    try {
      return await this.tenantDb.withTenant(async (tx) => {
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

        return { id: patient.id, uhid: patient.uhid };
      });
    } catch (error) {
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
   * Search by exact UHID, phone, or name prefix. Tenant-scoped. No Aadhaar/identifier search.
   */
  async search(input: {
    tenantId: string;
    uhid?: string;
    phone?: string;
    namePrefix?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<{ id: string; uhid: string; name: string; phone: string | null }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const maxPage = this.config.get('PATIENT_SEARCH_MAX_PAGE_SIZE', { infer: true }) ?? 50;
    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), maxPage);
    const page = Math.max(input.page ?? 1, 1);
    const skip = (page - 1) * pageSize;

    return this.tenantDb.withTenant(async (tx) => {
      if (input.namePrefix) {
        const pattern = `${input.namePrefix.toLowerCase()}%`;
        const totalRows = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM patients
          WHERE tenant_id = ${input.tenantId} AND is_active = true
            AND lower(name) LIKE ${pattern}
        `;
        const rows = await tx.$queryRaw<
          Array<{ id: string; uhid: string; name: string; phone: string | null }>
        >`
          SELECT id, uhid, name, phone FROM patients
          WHERE tenant_id = ${input.tenantId} AND is_active = true
            AND lower(name) LIKE ${pattern}
          ORDER BY name ASC, id ASC
          OFFSET ${skip} LIMIT ${pageSize}
        `;
        return { items: rows, total: Number(totalRows[0]?.count ?? 0n), page, pageSize };
      }

      const where: { tenantId: string; uhid?: string; phone?: string; isActive: boolean } = {
        tenantId: input.tenantId,
        isActive: true,
      };
      if (input.uhid) {
        where.uhid = input.uhid;
      } else if (input.phone) {
        where.phone = input.phone;
      }

      const [total, rows] = await Promise.all([
        tx.patient.count({ where }),
        tx.patient.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take: pageSize,
          select: { id: true, uhid: true, name: true, phone: true },
        }),
      ]);

      return { items: rows, total, page, pageSize };
    });
  }
}
