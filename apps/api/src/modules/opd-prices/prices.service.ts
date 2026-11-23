import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { Prisma } from '../../generated/prisma';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import type { Actor } from '../opd-visits/opd-visits.service';
import { OpdErrorCode, opdError } from '../opd-visits/opd-visit.errors';
import {
  OPD_PRICES_CONFIG as C,
  PRICE_AUDIT,
  type PriceKind,
  type PriceVisitType,
} from './opd-prices.config';
import { localDate } from './local-date';
import { planPriceChange } from './price-plan';

export type PriceRowView = {
  /** Stable key of the row for the screen. */
  key: string;
  kind: PriceKind;
  itemId: string | null;
  doctorProfileId: string | null;
  visitType: PriceVisitType | null;
  code: string;
  name: string;
  currentAmountPaise: number | null;
  currentFrom: string | null;
  nextAmountPaise: number | null;
  nextFrom: string | null;
};

export type PriceVersionView = {
  id: string;
  amountPaise: number;
  effectiveFrom: string;
  createdAt: string;
  createdByName: string | null;
  inEffect: boolean;
};

export type PriceChangeResult = {
  /** False when the amount was already the latest price: nothing was written. */
  changed: boolean;
  previousAmountPaise: number | null;
  price: { id: string; amountPaise: number; effectiveFrom: string };
};

type RawRow = {
  kind: string;
  item_id: string | null;
  doctor_profile_id: string | null;
  visit_type: string | null;
  code: string;
  name: string;
  cur_amount: number | null;
  cur_from: Date | null;
  next_amount: number | null;
  next_from: Date | null;
};

function priceInvalid(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.PRICE_INVALID, { field, reason });
}

/**
 * Step 8b, part B: price change for the registration fee, tests and doctor fees.
 *
 * Prices are append-only (a database trigger refuses update and delete): a change adds a new
 * version with an effective date, and only NEW bills use it (a bill line keeps the price it was
 * billed with). The row of the item (or of the doctor) is locked while a change is made, so two
 * changes at the same moment queue up and the second one sees the first.
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------------------- list

  async list(
    actor: Actor,
    query: { q?: string; kind?: PriceKind; page: number; pageSize: number },
  ): Promise<{
    items: PriceRowView[];
    total: number;
    page: number;
    pageSize: number;
    /** Today's date (YYYY-MM-DD) in the hospital time zone: the earliest date a price change may start. */
    today: string;
  }> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    const q = (query.q ?? '').trim().toLowerCase().slice(0, C.searchMaxLength);
    const search = q
      ? Prisma.sql`AND (strpos(lower(code), ${q}) > 0 OR strpos(lower(name), ${q}) > 0)`
      : Prisma.empty;
    const kindFilter = query.kind ? Prisma.sql`AND kind = ${query.kind}` : Prisma.empty;

    const rows = Prisma.sql`
      SELECT * FROM (
        SELECT ci.kind::text AS kind, ci.id AS item_id, NULL::text AS doctor_profile_id,
               NULL::text AS visit_type, ci.code AS code, ci.name AS name,
               cur.amount_paise AS cur_amount, cur.effective_from AS cur_from,
               nxt.amount_paise AS next_amount, nxt.effective_from AS next_from
          FROM charge_items ci
          LEFT JOIN LATERAL (
            SELECT p.amount_paise, p.effective_from FROM charge_item_prices p
             WHERE p.tenant_id = ci.tenant_id AND p.charge_item_id = ci.id
               AND p.effective_from <= ${now}::timestamptz
             ORDER BY p.effective_from DESC LIMIT 1) cur ON true
          LEFT JOIN LATERAL (
            SELECT p.amount_paise, p.effective_from FROM charge_item_prices p
             WHERE p.tenant_id = ci.tenant_id AND p.charge_item_id = ci.id
               AND p.effective_from > ${now}::timestamptz
             ORDER BY p.effective_from ASC LIMIT 1) nxt ON true
         WHERE ci.tenant_id = ${tenantId} AND ci.active AND ci.kind IN ('REGISTRATION', 'INVESTIGATION')
        UNION ALL
        SELECT 'DOCTOR_FEE', NULL, dp.id, vt.visit_type, dp.code, u.display_name,
               cur.amount_paise, cur.effective_from, nxt.amount_paise, nxt.effective_from
          FROM doctor_profiles dp
          JOIN users u ON u.tenant_id = dp.tenant_id AND u.id = dp.user_id
          CROSS JOIN (VALUES ('NEW'), ('FOLLOW_UP')) AS vt(visit_type)
          LEFT JOIN LATERAL (
            SELECT f.amount_paise, f.effective_from FROM doctor_fees f
             WHERE f.tenant_id = dp.tenant_id AND f.doctor_profile_id = dp.id
               AND f.visit_type = vt.visit_type::visit_type AND f.effective_from <= ${now}::timestamptz
             ORDER BY f.effective_from DESC LIMIT 1) cur ON true
          LEFT JOIN LATERAL (
            SELECT f.amount_paise, f.effective_from FROM doctor_fees f
             WHERE f.tenant_id = dp.tenant_id AND f.doctor_profile_id = dp.id
               AND f.visit_type = vt.visit_type::visit_type AND f.effective_from > ${now}::timestamptz
             ORDER BY f.effective_from ASC LIMIT 1) nxt ON true
         WHERE dp.tenant_id = ${tenantId} AND dp.active
      ) all_rows
      WHERE true ${kindFilter} ${search}`;

    return this.tenantDb.withTenant(async (tx) => {
      const counted = await tx.$queryRaw<Array<{ n: bigint }>>(
        Prisma.sql`SELECT count(*)::bigint AS n FROM (${rows}) counted`,
      );
      const n = counted[0]?.n ?? BigInt(0);
      const page = await tx.$queryRaw<RawRow[]>(
        Prisma.sql`SELECT * FROM (${rows}) listed
          ORDER BY CASE kind WHEN 'REGISTRATION' THEN 0 WHEN 'DOCTOR_FEE' THEN 1 ELSE 2 END,
                   code, visit_type NULLS FIRST
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      );
      const timeZone = await this.timeZoneOf(tx, tenantId);
      return {
        items: page.map((r) => this.toRow(r)),
        total: Number(n),
        page: query.page,
        pageSize: query.pageSize,
        today: localDate(now, timeZone),
      };
    });
  }

  private toRow(r: RawRow): PriceRowView {
    const kind = r.kind as PriceKind;
    return {
      key:
        kind === 'DOCTOR_FEE' ? `fee:${r.doctor_profile_id}:${r.visit_type}` : `item:${r.item_id}`,
      kind,
      itemId: r.item_id,
      doctorProfileId: r.doctor_profile_id,
      visitType: r.visit_type as PriceVisitType | null,
      code: r.code,
      name: r.name,
      currentAmountPaise: r.cur_amount,
      currentFrom: r.cur_from ? r.cur_from.toISOString() : null,
      nextAmountPaise: r.next_amount,
      nextFrom: r.next_from ? r.next_from.toISOString() : null,
    };
  }

  // ----------------------------------------------------------------------------- history

  async history(
    actor: Actor,
    target:
      | { kind: 'ITEM'; itemId: string }
      | { kind: 'DOCTOR_FEE'; doctorProfileId: string; visitType: PriceVisitType },
  ): Promise<{ items: PriceVersionView[] }> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    return this.tenantDb.withTenant(async (tx) => {
      type Version = {
        id: string;
        amountPaise: number;
        effectiveFrom: Date;
        createdAt: Date;
        createdBy: string;
      };
      let versions: Version[];
      if (target.kind === 'ITEM') {
        const item = await tx.chargeItem.findFirst({
          where: { tenantId, id: target.itemId, kind: { in: ['REGISTRATION', 'INVESTIGATION'] } },
          select: { id: true },
        });
        if (!item) {
          throw opdError(404, OpdErrorCode.PRICE_ITEM_NOT_FOUND);
        }
        versions = await tx.chargeItemPrice.findMany({
          where: { tenantId, chargeItemId: target.itemId },
          orderBy: { effectiveFrom: 'desc' },
          take: C.historyLimit,
          select: {
            id: true,
            amountPaise: true,
            effectiveFrom: true,
            createdAt: true,
            createdBy: true,
          },
        });
      } else {
        const doctor = await tx.doctorProfile.findFirst({
          where: { tenantId, id: target.doctorProfileId },
          select: { id: true },
        });
        if (!doctor) {
          throw opdError(404, OpdErrorCode.PRICE_ITEM_NOT_FOUND);
        }
        versions = await tx.doctorFee.findMany({
          where: { tenantId, doctorProfileId: target.doctorProfileId, visitType: target.visitType },
          orderBy: { effectiveFrom: 'desc' },
          take: C.historyLimit,
          select: {
            id: true,
            amountPaise: true,
            effectiveFrom: true,
            createdAt: true,
            createdBy: true,
          },
        });
      }
      const users = await tx.user.findMany({
        where: { tenantId, id: { in: [...new Set(versions.map((v) => v.createdBy))] } },
        select: { id: true, displayName: true },
      });
      const names = new Map(users.map((u) => [u.id, u.displayName]));
      // The version in effect is the newest one that has already started.
      const inEffectId = versions.find((v) => v.effectiveFrom <= now)?.id ?? null;
      return {
        items: versions.map((v) => ({
          id: v.id,
          amountPaise: v.amountPaise,
          effectiveFrom: v.effectiveFrom.toISOString(),
          createdAt: v.createdAt.toISOString(),
          createdByName: names.get(v.createdBy) ?? null,
          inEffect: v.id === inEffectId,
        })),
      };
    });
  }

  // ---------------------------------------------------------------------------- changes

  private async timeZoneOf(tx: TenantTx, tenantId: string): Promise<string> {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    return settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
  }

  async changeChargeItemPrice(
    itemId: string,
    input: { amountPaise: number; effectiveFrom?: string },
    actor: Actor,
  ): Promise<PriceChangeResult> {
    return this.tenantDb.withTenant((tx) =>
      this.changeChargeItemPriceInTx(tx, itemId, input, actor),
    );
  }

  /** The same change inside a transaction of the caller (the Excel upload posts many in one). */
  async changeChargeItemPriceInTx(
    tx: TenantTx,
    itemId: string,
    input: { amountPaise: number; effectiveFrom?: string },
    actor: Actor,
  ): Promise<PriceChangeResult> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    // Lock the item: two changes at the same moment queue here and the second sees the first.
    const locked = await tx.$queryRaw<Array<{ kind: string; active: boolean }>>(
      Prisma.sql`SELECT kind::text AS kind, active FROM charge_items
                    WHERE tenant_id = ${tenantId} AND id = ${itemId} FOR UPDATE`,
    );
    const item = locked[0];
    if (!item || (item.kind !== 'REGISTRATION' && item.kind !== 'INVESTIGATION')) {
      throw opdError(404, OpdErrorCode.PRICE_ITEM_NOT_FOUND);
    }
    if (!item.active) {
      priceInvalid('item', 'ITEM_INACTIVE');
    }
    const latest = await tx.chargeItemPrice.findFirst({
      where: { tenantId, chargeItemId: itemId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const timeZone = await this.timeZoneOf(tx, tenantId);
    const plan = planPriceChange({
      requested: input.effectiveFrom,
      now,
      timeZone,
      latest,
      amountPaise: input.amountPaise,
    });
    if (plan.kind === 'invalid') {
      priceInvalid(plan.field, plan.reason);
    }
    if (plan.kind === 'unchanged' && latest) {
      // The same amount again (also a repeated request): no new version.
      return {
        changed: false,
        previousAmountPaise: latest.amountPaise,
        price: {
          id: latest.id,
          amountPaise: latest.amountPaise,
          effectiveFrom: latest.effectiveFrom.toISOString(),
        },
      };
    }
    if (plan.kind !== 'new') {
      throw new Error('unreachable price plan');
    }
    const start = plan.start;
    const created = await tx.chargeItemPrice.create({
      data: {
        tenantId,
        chargeItemId: itemId,
        amountPaise: input.amountPaise,
        effectiveFrom: start,
        createdBy: actor.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actor.userId,
        branchId: actor.branchId,
        action: PRICE_AUDIT.chargeItemPriceChanged,
        entityType: 'charge_item_price',
        entityId: created.id,
        // Ids and amounts only, no free text.
        metadata: {
          chargeItemId: itemId,
          oldAmountPaise: latest?.amountPaise ?? null,
          newAmountPaise: created.amountPaise,
          effectiveFrom: created.effectiveFrom.toISOString(),
        },
      },
    });
    return {
      changed: true,
      previousAmountPaise: latest?.amountPaise ?? null,
      price: {
        id: created.id,
        amountPaise: created.amountPaise,
        effectiveFrom: created.effectiveFrom.toISOString(),
      },
    };
  }

  async changeDoctorFee(
    input: {
      doctorProfileId: string;
      visitType: PriceVisitType;
      amountPaise: number;
      effectiveFrom?: string;
    },
    actor: Actor,
  ): Promise<PriceChangeResult> {
    return this.tenantDb.withTenant((tx) => this.changeDoctorFeeInTx(tx, input, actor));
  }

  async changeDoctorFeeInTx(
    tx: TenantTx,
    input: {
      doctorProfileId: string;
      visitType: PriceVisitType;
      amountPaise: number;
      effectiveFrom?: string;
    },
    actor: Actor,
  ): Promise<PriceChangeResult> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    // Lock the doctor's row (the fee rows are append-only and cannot be locked for a new insert).
    const locked = await tx.$queryRaw<Array<{ active: boolean }>>(
      Prisma.sql`SELECT active FROM doctor_profiles
                    WHERE tenant_id = ${tenantId} AND id = ${input.doctorProfileId} FOR UPDATE`,
    );
    const doctor = locked[0];
    if (!doctor) {
      throw opdError(404, OpdErrorCode.PRICE_ITEM_NOT_FOUND);
    }
    if (!doctor.active) {
      priceInvalid('doctor', 'ITEM_INACTIVE');
    }
    const latest = await tx.doctorFee.findFirst({
      where: { tenantId, doctorProfileId: input.doctorProfileId, visitType: input.visitType },
      orderBy: { effectiveFrom: 'desc' },
    });
    const timeZone = await this.timeZoneOf(tx, tenantId);
    const plan = planPriceChange({
      requested: input.effectiveFrom,
      now,
      timeZone,
      latest,
      amountPaise: input.amountPaise,
    });
    if (plan.kind === 'invalid') {
      priceInvalid(plan.field, plan.reason);
    }
    if (plan.kind === 'unchanged' && latest) {
      // The same amount again (also a repeated request): no new version.
      return {
        changed: false,
        previousAmountPaise: latest.amountPaise,
        price: {
          id: latest.id,
          amountPaise: latest.amountPaise,
          effectiveFrom: latest.effectiveFrom.toISOString(),
        },
      };
    }
    if (plan.kind !== 'new') {
      throw new Error('unreachable price plan');
    }
    const start = plan.start;
    const created = await tx.doctorFee.create({
      data: {
        tenantId,
        doctorProfileId: input.doctorProfileId,
        visitType: input.visitType,
        amountPaise: input.amountPaise,
        effectiveFrom: start,
        createdBy: actor.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actor.userId,
        branchId: actor.branchId,
        action: PRICE_AUDIT.doctorFeeChanged,
        entityType: 'doctor_fee',
        entityId: created.id,
        metadata: {
          doctorProfileId: input.doctorProfileId,
          visitType: input.visitType,
          oldAmountPaise: latest?.amountPaise ?? null,
          newAmountPaise: created.amountPaise,
          effectiveFrom: created.effectiveFrom.toISOString(),
        },
      },
    });
    return {
      changed: true,
      previousAmountPaise: latest?.amountPaise ?? null,
      price: {
        id: created.id,
        amountPaise: created.amountPaise,
        effectiveFrom: created.effectiveFrom.toISOString(),
      },
    };
  }
}
