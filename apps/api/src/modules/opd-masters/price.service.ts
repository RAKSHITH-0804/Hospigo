import { Injectable } from '@nestjs/common';
import type { ChargeItemPrice, DoctorFee, VisitType } from '../../generated/prisma';
import { TenantDb } from '../../database/tenant-db';
import { requireContext } from '../../common/request-context';

@Injectable()
export class PriceService {
  constructor(private readonly tenantDb: TenantDb) {}

  async getChargeItemPrice(chargeItemId: string, at: Date): Promise<ChargeItemPrice | null> {
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      return tx.chargeItemPrice.findFirst({
        where: {
          tenantId: ctx.tenantId!,
          chargeItemId,
          effectiveFrom: { lte: at },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
    });
  }

  async getDoctorFee(
    doctorProfileId: string,
    visitType: VisitType,
    at: Date,
  ): Promise<DoctorFee | null> {
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      return tx.doctorFee.findFirst({
        where: {
          tenantId: ctx.tenantId!,
          doctorProfileId,
          visitType,
          effectiveFrom: { lte: at },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
    });
  }

  async addChargeItemPrice(input: {
    chargeItemId: string;
    amountPaise: number;
    effectiveFrom: Date;
    createdBy: string;
  }): Promise<ChargeItemPrice> {
    if (input.amountPaise < 0) {
      throw new Error('amount_paise must be >= 0');
    }
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      const tenantId = ctx.tenantId!;
      const latest = await tx.chargeItemPrice.findFirst({
        where: { tenantId, chargeItemId: input.chargeItemId },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (latest && input.effectiveFrom < latest.effectiveFrom) {
        throw new Error(
          'effective_from must not be earlier than the latest existing version for this charge item',
        );
      }
      return tx.chargeItemPrice.create({
        data: {
          tenantId,
          chargeItemId: input.chargeItemId,
          amountPaise: input.amountPaise,
          effectiveFrom: input.effectiveFrom,
          createdBy: input.createdBy,
        },
      });
    });
  }

  async addDoctorFee(input: {
    doctorProfileId: string;
    visitType: VisitType;
    amountPaise: number;
    effectiveFrom: Date;
    createdBy: string;
  }): Promise<DoctorFee> {
    if (input.amountPaise < 0) {
      throw new Error('amount_paise must be >= 0');
    }
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      const tenantId = ctx.tenantId!;
      const latest = await tx.doctorFee.findFirst({
        where: {
          tenantId,
          doctorProfileId: input.doctorProfileId,
          visitType: input.visitType,
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (latest && input.effectiveFrom < latest.effectiveFrom) {
        throw new Error(
          'effective_from must not be earlier than the latest existing version for this doctor fee',
        );
      }
      return tx.doctorFee.create({
        data: {
          tenantId,
          doctorProfileId: input.doctorProfileId,
          visitType: input.visitType,
          amountPaise: input.amountPaise,
          effectiveFrom: input.effectiveFrom,
          createdBy: input.createdBy,
        },
      });
    });
  }
}
