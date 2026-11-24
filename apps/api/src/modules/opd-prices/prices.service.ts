import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { AccessService } from '../access/access.service';
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
  /** A follow-up fee row with no separate follow-up fee: it costs the same as the new-visit fee. */
  followsBase: boolean;
  /**
   * Doctor fees only: where the fee shown comes from. BRANCH = a fee set for the branch asked for,
   * HOSPITAL = the doctor's hospital-wide fee, null = no fee yet (and for tests and the registration fee).
   */
  feeScope: 'BRANCH' | 'HOSPITAL' | null;
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
  follows_base: boolean;
  fee_is_branch: boolean | null;
};

/**
 * One lookup of a doctor fee row for the price list, in the order the billing code uses: a row of the
 * branch asked for beats a hospital-wide row (whatever their dates); with no branch only hospital-wide
 * rows count. `cur` = the row in effect now, `nxt` = the next scheduled row (a hospital-wide row is
 * only a candidate when the current fee is not a branch fee, since a branch fee would still win).
 */
function feeLateral(
  alias: 'cur' | 'nxt' | 'curb' | 'nxtb',
  visitType: Prisma.Sql,
  now: Date,
  branchId: string | null,
  currentAlias: 'cur' | 'curb' | null,
): Prisma.Sql {
  const a = Prisma.raw(alias);
  const scope = Prisma.sql`(f.branch_id IS NULL OR f.branch_id = ${branchId}::text)`;
  if (currentAlias === null) {
    return Prisma.sql`LEFT JOIN LATERAL (
            SELECT f.amount_paise, f.effective_from, (f.branch_id IS NOT NULL) AS is_branch
              FROM doctor_fees f
             WHERE f.tenant_id = dp.tenant_id AND f.doctor_profile_id = dp.id
               AND f.visit_type = ${visitType} AND f.effective_from <= ${now}::timestamptz AND ${scope}
             ORDER BY (f.branch_id IS NULL), f.effective_from DESC LIMIT 1) ${a} ON true`;
  }
  const c = Prisma.raw(currentAlias);
  return Prisma.sql`LEFT JOIN LATERAL (
            SELECT f.amount_paise, f.effective_from
              FROM doctor_fees f
             WHERE f.tenant_id = dp.tenant_id AND f.doctor_profile_id = dp.id
               AND f.visit_type = ${visitType} AND f.effective_from > ${now}::timestamptz AND ${scope}
               AND (f.branch_id IS NOT NULL OR ${c}.is_branch IS NOT TRUE)
             ORDER BY f.effective_from ASC LIMIT 1) ${a} ON true`;
}

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
    private readonly access: AccessService,
  ) {}

  // ------------------------------------------------------------------------------- list

  async list(
    actor: Actor,
    query: { q?: string; kind?: PriceKind; branchId?: string; page: number; pageSize: number },
  ): Promise<{
    items: PriceRowView[];
    total: number;
    page: number;
    pageSize: number;
    /** Today's date (YYYY-MM-DD) in the hospital time zone: the earliest date a price change may start. */
    today: string;
    /** True when the caller may set the doctor's hospital-wide fee (a hospital-wide Admin). */
    canSetHospitalWide: boolean;
  }> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    const q = (query.q ?? '').trim().toLowerCase().slice(0, C.searchMaxLength);
    const search = q
      ? Prisma.sql`AND (strpos(lower(code), ${q}) > 0 OR strpos(lower(name), ${q}) > 0)`
      : Prisma.empty;
    const kindFilter = query.kind ? Prisma.sql`AND kind = ${query.kind}` : Prisma.empty;
    // Step 8c: with a branch, only doctors who work in it (fees stay per doctor, never per branch).
    // The registration fee and the tests are hospital-wide and are not filtered.
    const doctorBranch = query.branchId
      ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM user_branches ub
             WHERE ub.tenant_id = dp.tenant_id AND ub.user_id = dp.user_id
               AND ub.branch_id = ${query.branchId} AND ub.is_active)`
      : Prisma.empty;

    const branchParam = query.branchId ?? null;
    const rows = Prisma.sql`
      SELECT * FROM (
        SELECT ci.kind::text AS kind, ci.id AS item_id, NULL::text AS doctor_profile_id,
               NULL::text AS visit_type, ci.code AS code, ci.name AS name,
               cur.amount_paise AS cur_amount, cur.effective_from AS cur_from,
               nxt.amount_paise AS next_amount, nxt.effective_from AS next_from,
               false AS follows_base, NULL::boolean AS fee_is_branch
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
               CASE WHEN vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL
                    THEN curb.amount_paise ELSE cur.amount_paise END,
               CASE WHEN vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL
                    THEN curb.effective_from ELSE cur.effective_from END,
               CASE WHEN vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL AND nxt.amount_paise IS NULL
                    THEN nxtb.amount_paise ELSE nxt.amount_paise END,
               CASE WHEN vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL AND nxt.amount_paise IS NULL
                    THEN nxtb.effective_from ELSE nxt.effective_from END,
               (vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL),
               CASE WHEN vt.visit_type = 'FOLLOW_UP' AND cur.amount_paise IS NULL
                    THEN curb.is_branch ELSE cur.is_branch END
          FROM doctor_profiles dp
          JOIN users u ON u.tenant_id = dp.tenant_id AND u.id = dp.user_id
          CROSS JOIN (VALUES ('NEW'), ('FOLLOW_UP')) AS vt(visit_type)
          ${feeLateral('cur', Prisma.sql`vt.visit_type::visit_type`, now, branchParam, null)}
          ${feeLateral('nxt', Prisma.sql`vt.visit_type::visit_type`, now, branchParam, 'cur')}
          ${feeLateral('curb', Prisma.sql`'NEW'::visit_type`, now, branchParam, null)}
          ${feeLateral('nxtb', Prisma.sql`'NEW'::visit_type`, now, branchParam, 'curb')}
         WHERE dp.tenant_id = ${tenantId} AND dp.active ${doctorBranch}
      ) all_rows
      WHERE true ${kindFilter} ${search}`;

    return this.tenantDb.withTenant(async (tx) => {
      if (query.branchId) {
        await this.assertMayReadBranch(tx, tenantId, query.branchId);
      }
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
        canSetHospitalWide:
          (await this.access.hospitalWideBranches('opd.prices.write', 'OPD')).length > 0,
      };
    });
  }

  /**
   * The branch must be one of this hospital (a branch of another hospital is invisible under row
   * level security and refused like an unknown one: 400 BRANCH_NOT_FOUND). A hospital-wide Admin may
   * look at any branch; anyone else only at the branches they hold the permission in (403).
   */
  private async assertMayReadBranch(
    tx: TenantTx,
    tenantId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      priceInvalid('branchId', 'BRANCH_NOT_FOUND');
    }
    if ((await this.access.hospitalWideBranches('opd.prices.write', 'OPD')).length > 0) {
      return;
    }
    if (!(await this.access.permittedBranches('opd.prices.write', 'OPD')).includes(branchId)) {
      throw opdError(403, OpdErrorCode.PRICE_SCOPE_FORBIDDEN);
    }
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
      followsBase: r.follows_base === true,
      feeScope:
        kind === 'DOCTOR_FEE' && r.fee_is_branch !== null
          ? r.fee_is_branch
            ? 'BRANCH'
            : 'HOSPITAL'
          : null,
    };
  }

  // ----------------------------------------------------------------------------- history

  async history(
    actor: Actor,
    target:
      | { kind: 'ITEM'; itemId: string }
      | {
          kind: 'DOCTOR_FEE';
          doctorProfileId: string;
          visitType: PriceVisitType;
          /** null or absent = the hospital-wide versions; a branch id = the versions set for that branch. */
          branchId?: string | null;
        },
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
        const scope = target.branchId ?? null;
        if (scope) {
          await this.assertMayReadBranch(tx, tenantId, scope);
        }
        versions = await tx.doctorFee.findMany({
          where: {
            tenantId,
            doctorProfileId: target.doctorProfileId,
            visitType: target.visitType,
            branchId: scope,
          },
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

  /**
   * Who may set a doctor fee: the hospital-wide fee needs the permission in EVERY branch (a
   * hospital-wide Admin); a branch fee needs it in that branch (a Branch Admin only for their own
   * branches, a hospital-wide Admin for any). The registration fee and test prices keep the rule of
   * Step 8b (hospital-wide, permission opd.prices.write) and are not touched here.
   */
  private async assertMayChangeDoctorFee(
    tx: TenantTx,
    tenantId: string,
    branchId: string | null,
  ): Promise<void> {
    if (branchId === null) {
      if ((await this.access.hospitalWideBranches('opd.prices.write', 'OPD')).length === 0) {
        throw opdError(403, OpdErrorCode.PRICE_SCOPE_FORBIDDEN);
      }
      return;
    }
    await this.assertMayReadBranch(tx, tenantId, branchId);
  }

  async changeDoctorFee(
    input: {
      doctorProfileId: string;
      visitType: PriceVisitType;
      amountPaise: number;
      effectiveFrom?: string;
      /** null or absent = the hospital-wide fee; a branch id = the fee in that branch only. */
      branchId?: string | null;
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
      branchId?: string | null;
    },
    actor: Actor,
  ): Promise<PriceChangeResult> {
    const now = this.clock.now();
    const tenantId = actor.tenantId;
    const branchId = input.branchId ?? null;
    await this.assertMayChangeDoctorFee(tx, tenantId, branchId);
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
    if (branchId) {
      // A branch fee is only for a doctor who works in that branch.
      const works = await tx.userBranch.findFirst({
        where: {
          tenantId,
          branchId,
          isActive: true,
          user: { doctorProfiles: { some: { id: input.doctorProfileId } } },
        },
        select: { id: true },
      });
      if (!works) {
        priceInvalid('doctor', 'DOCTOR_NOT_IN_BRANCH');
      }
    }
    const latest = await tx.doctorFee.findFirst({
      where: {
        tenantId,
        doctorProfileId: input.doctorProfileId,
        visitType: input.visitType,
        branchId,
      },
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
        branchId,
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
          branchId,
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
