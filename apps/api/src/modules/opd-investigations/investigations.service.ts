import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { lockVisit, ownDoctorId } from '../opd-clinical/clinical-visit';
import { NumberSeriesService } from '../numbering/number-series.service';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import {
  allocateBillingNumber,
  paymentsMatchStored,
  planPayments,
} from '../opd-visits/billing-helpers';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { OPD_AUDIT } from '../opd-visits/opd-visits.config';
import {
  BILL_INCLUDE,
  toBillView,
  type Actor,
  type BillView,
} from '../opd-visits/opd-visits.service';
import type { BillInvestigationsDto, SaveOrdersDto } from './dto/investigations.dto';
import { OPD_INVESTIGATIONS_CONFIG as C } from './opd-investigations.config';

export type OrderView = {
  id: string;
  chargeItemId: string;
  code: string;
  name: string;
  status: string;
  notTakenReason: string | null;
  billNumber: string | null;
  orderedAt: string;
  resolvedAt: string | null;
};

export type BillInvestigationsResult = {
  replayed: boolean;
  visitId: string;
  bill: BillView;
  orders: OrderView[];
};

/**
 * Step 6a: tests the doctor orders during a consultation, the reception list of pending tests and
 * the investigations bill (priced from the price list, paid in one or several modes, ONE receipt).
 * The database refuses the rest (only the visit's doctor orders, only while in consultation, a bill
 * line must belong to an ordered test, the bill equals its lines, the receipt equals its payments).
 * The branch always comes from the token; a test price is never taken from the request.
 */
@Injectable()
export class InvestigationsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    private readonly numbering: NumberSeriesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------------ tests list

  /** Active tests of the hospital matching a text (name or code). No prices: doctors never see money. */
  async searchTests(actor: Actor, q: string, limit: number) {
    const text = q.trim().slice(0, C.searchMaxLength);
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.chargeItem.findMany({
        where: {
          tenantId: actor.tenantId,
          kind: 'INVESTIGATION',
          active: true,
          ...(text
            ? {
                OR: [
                  { name: { contains: text, mode: 'insensitive' } },
                  { code: { contains: text, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: Math.min(Math.max(limit, 1), C.searchMaxLimit),
        select: { id: true, code: true, name: true },
      });
      return { items: rows };
    });
  }

  // ------------------------------------------------------------------ doctor orders tests

  /**
   * The assigned doctor sets the tests for the visit while it is IN_CONSULTATION. The list REPLACES
   * the tests that are still only ORDERED; a test already billed or marked not taken stays as it is.
   */
  async saveOrders(visitId: string, body: SaveOrdersDto, actor: Actor) {
    const ids = body.chargeItemIds;
    if (new Set(ids).size !== ids.length) {
      throw opdError(400, OpdErrorCode.TEST_DUPLICATE);
    }
    return this.tenantDb.withTenant(async (tx) => {
      const own = await ownDoctorId(tx, actor);
      if (!own) {
        throw opdError(403, OpdErrorCode.DOCTOR_PROFILE_REQUIRED);
      }
      // A visit of another doctor, branch or hospital is simply "not found".
      await lockVisit(tx, actor, visitId, own);
      const visit = await tx.opdVisit.findFirstOrThrow({
        where: { id: visitId, tenantId: actor.tenantId, branchId: actor.branchId },
        select: { status: true },
      });
      if (visit.status !== 'IN_CONSULTATION') {
        throw opdError(409, OpdErrorCode.VISIT_NOT_IN_CONSULTATION, { status: visit.status });
      }
      const items =
        ids.length === 0
          ? []
          : await tx.chargeItem.findMany({
              where: {
                tenantId: actor.tenantId,
                id: { in: ids },
                kind: 'INVESTIGATION',
                active: true,
              },
              select: { id: true, code: true, name: true },
            });
      if (items.length !== ids.length) {
        throw opdError(404, OpdErrorCode.TEST_NOT_FOUND);
      }

      const existing = await tx.investigationOrder.findMany({
        where: { tenantId: actor.tenantId, visitId },
        select: { id: true, chargeItemId: true, status: true },
      });
      const wanted = new Set(ids);
      const drop = existing.filter((o) => o.status === 'ORDERED' && !wanted.has(o.chargeItemId));
      const have = new Set(existing.map((o) => o.chargeItemId));
      const add = items.filter((i) => !have.has(i.id));
      if (existing.length - drop.length + add.length > C.maxTestsPerVisit) {
        throw opdError(400, OpdErrorCode.TOO_MANY_TESTS, { max: C.maxTestsPerVisit });
      }
      if (drop.length > 0) {
        await tx.investigationOrder.deleteMany({
          where: {
            tenantId: actor.tenantId,
            id: { in: drop.map((o) => o.id) },
            status: 'ORDERED',
          },
        });
      }
      for (const item of add) {
        await tx.investigationOrder.create({
          data: {
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            visitId,
            doctorProfileId: own,
            chargeItemId: item.id,
            codeSnapshot: item.code,
            nameSnapshot: item.name,
            orderedBy: actor.userId,
          },
        });
      }
      // Audit: how many tests, never which (no clinical content in the audit trail).
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          branchId: actor.branchId,
          action: OPD_AUDIT.testsOrdered,
          entityType: 'opd_visit',
          entityId: visitId,
          metadata: { added: add.length, removed: drop.length, total: ids.length },
        },
      });
      return { orders: await this.ordersInTx(tx, actor, visitId) };
    });
  }

  /**
   * The tests of one visit. A doctor sees their own visits; reception (who bills tests) sees the
   * visits of the branch and, with opd.billing.read, the investigations bills too.
   */
  async getForVisit(visitId: string, actor: Actor) {
    const [canBill, canOrder, canSeeMoney] = await Promise.all([
      this.access.can('opd.investigations.bill', actor.branchId, 'OPD'),
      this.access.can('opd.investigations.order', actor.branchId, 'OPD'),
      this.access.can('opd.billing.read', actor.branchId, 'OPD'),
    ]);
    if (!canBill && !canOrder) {
      throw opdError(403, OpdErrorCode.FORBIDDEN);
    }
    return this.tenantDb.withTenant(async (tx) => {
      let own: string | null = null;
      if (!canBill) {
        own = await ownDoctorId(tx, actor);
        if (!own) {
          throw opdError(403, OpdErrorCode.DOCTOR_PROFILE_REQUIRED);
        }
      }
      const visit = await tx.opdVisit.findFirst({
        where: {
          id: visitId,
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          ...(own ? { doctorProfileId: own } : {}),
        },
        select: { id: true, status: true },
      });
      if (!visit) {
        throw opdError(404, OpdErrorCode.VISIT_NOT_FOUND);
      }
      const orders = await this.ordersInTx(tx, actor, visitId);
      const bills = canSeeMoney
        ? (
            await tx.bill.findMany({
              where: { tenantId: actor.tenantId, visitId, billType: 'INVESTIGATION' },
              include: BILL_INCLUDE,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            })
          ).map((b) => toBillView(b, true))
        : undefined;
      return { visitId, visitStatus: visit.status, orders, ...(bills ? { bills } : {}) };
    });
  }

  // ------------------------------------------------------------------ reception: pending

  /**
   * Visits of the active branch that still have tests waiting to be billed (ordered, not yet billed
   * or declined), oldest order first, with each test's CURRENT price (paise) so the screen can show
   * the total before taking payment.
   */
  async listPending(actor: Actor) {
    const now = this.clock.now();
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.investigationOrder.findMany({
        where: { tenantId: actor.tenantId, branchId: actor.branchId, status: 'ORDERED' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          visit: {
            select: {
              id: true,
              status: true,
              tokenNo: true,
              doctor: { select: { code: true, user: { select: { displayName: true } } } },
              patient: { select: { id: true, uhid: true, name: true } },
            },
          },
        },
      });
      const prices = await this.currentPrices(
        tx,
        actor.tenantId,
        [...new Set(rows.map((r) => r.chargeItemId))],
        now,
      );
      const settings = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
      const prefix = settings?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix;

      const byVisit = new Map<
        string,
        {
          visitId: string;
          visitStatus: string;
          token: string | null;
          patient: { id: string; uhid: string; name: string };
          doctor: { code: string; name: string };
          orders: Array<{
            id: string;
            chargeItemId: string;
            code: string;
            name: string;
            pricePaise: number | null;
            orderedAt: string;
          }>;
          totalPaise: number;
        }
      >();
      for (const r of rows) {
        let entry = byVisit.get(r.visitId);
        if (!entry) {
          if (byVisit.size >= C.pendingMaxVisits) {
            continue;
          }
          entry = {
            visitId: r.visitId,
            visitStatus: r.visit.status,
            token: r.visit.tokenNo === null ? null : `${prefix}${r.visit.tokenNo}`,
            patient: r.visit.patient,
            doctor: { code: r.visit.doctor.code, name: r.visit.doctor.user.displayName },
            orders: [],
            totalPaise: 0,
          };
          byVisit.set(r.visitId, entry);
        }
        const price = prices.get(r.chargeItemId) ?? null;
        entry.orders.push({
          id: r.id,
          chargeItemId: r.chargeItemId,
          code: r.codeSnapshot,
          name: r.nameSnapshot,
          pricePaise: price,
          orderedAt: r.createdAt.toISOString(),
        });
        entry.totalPaise += price ?? 0;
      }
      return { items: [...byVisit.values()] };
    });
  }

  // ------------------------------------------------------------------ reception: bill

  async billInvestigations(
    visitId: string,
    input: BillInvestigationsDto,
    actor: Actor,
  ): Promise<BillInvestigationsResult> {
    // The route needs opd.investigations.bill; taking the money is a separate permission.
    if (!(await this.access.can('opd.billing.collect', actor.branchId, 'OPD'))) {
      throw opdError(403, OpdErrorCode.FORBIDDEN);
    }
    try {
      return await this.tenantDb.withTenant((tx) => this.billInTx(tx, visitId, input, actor));
    } catch (error) {
      // The same key sent at the same moment (double click): the other request won and has
      // already committed, so return ITS result.
      const replay = await this.tenantDb.withTenant((tx) =>
        this.replayInTx(tx, visitId, input, actor),
      );
      if (replay) {
        return replay;
      }
      throw error;
    }
  }

  private async replayInTx(
    tx: TenantTx,
    visitId: string,
    input: BillInvestigationsDto,
    actor: Actor,
  ): Promise<BillInvestigationsResult | null> {
    const bill = await tx.bill.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey },
      },
      include: { lines: { select: { id: true } } },
    });
    if (!bill) {
      return null;
    }
    // The same key must never mean a different request.
    if (
      bill.billType !== 'INVESTIGATION' ||
      bill.visitId !== visitId ||
      bill.branchId !== actor.branchId
    ) {
      throw opdError(409, OpdErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    const billed = await tx.investigationOrder.findMany({
      where: { tenantId: actor.tenantId, billLineId: { in: bill.lines.map((l) => l.id) } },
      select: { id: true },
    });
    const sameOrders =
      [...billed.map((o) => o.id)].sort().join('|') === [...input.orderIds].sort().join('|');
    const samePay = await paymentsMatchStored(tx, actor.tenantId, bill.id, input);
    if (!sameOrders || !samePay) {
      throw opdError(409, OpdErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    return this.resultInTx(tx, actor, visitId, bill.id, true);
  }

  private async billInTx(
    tx: TenantTx,
    visitId: string,
    input: BillInvestigationsDto,
    actor: Actor,
  ): Promise<BillInvestigationsResult> {
    const replay = await this.replayInTx(tx, visitId, input, actor);
    if (replay) {
      return replay;
    }
    const { tenantId, branchId, userId } = actor;
    const now = this.clock.now();

    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    if (settings?.taxEnabled) {
      // Tax columns exist but the tax rules are not decided yet: never bill wrongly in silence.
      throw opdError(501, OpdErrorCode.TAX_NOT_SUPPORTED);
    }
    const visit = await tx.opdVisit.findFirst({
      where: { id: visitId, tenantId, branchId },
      select: { id: true, status: true },
    });
    if (!visit) {
      throw opdError(404, OpdErrorCode.VISIT_NOT_FOUND);
    }
    if (visit.status !== 'IN_CONSULTATION' && visit.status !== 'COMPLETED') {
      throw opdError(409, OpdErrorCode.VISIT_NOT_BILLABLE, { status: visit.status });
    }

    const declined = input.notTaken ?? [];
    const allIds = [...input.orderIds, ...declined.map((d) => d.orderId)];
    if (new Set(allIds).size !== allIds.length) {
      throw opdError(400, OpdErrorCode.TEST_DUPLICATE);
    }
    // Only tests of THIS visit (and so of this branch and hospital) that are still ORDERED.
    const orders = await tx.investigationOrder.findMany({
      where: { tenantId, visitId, branchId, id: { in: allIds }, status: 'ORDERED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (orders.length !== allIds.length) {
      throw opdError(409, OpdErrorCode.ORDERS_NOT_AVAILABLE);
    }
    const billedOrders = orders.filter((o) => input.orderIds.includes(o.id));

    // ---- prices (never taken from the request)
    const items = await tx.chargeItem.findMany({
      where: {
        tenantId,
        id: { in: billedOrders.map((o) => o.chargeItemId) },
        kind: 'INVESTIGATION',
        active: true,
      },
      select: { id: true, code: true, name: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    const prices = await this.currentPrices(
      tx,
      tenantId,
      billedOrders.map((o) => o.chargeItemId),
      now,
    );
    const lines = billedOrders.map((o) => {
      const item = itemById.get(o.chargeItemId);
      if (!item) {
        throw opdError(404, OpdErrorCode.TEST_NOT_FOUND);
      }
      const unit = prices.get(o.chargeItemId);
      if (unit === undefined) {
        throw opdError(409, OpdErrorCode.FEE_NOT_CONFIGURED, { what: 'INVESTIGATION' });
      }
      return { order: o, item, unit };
    });
    const totalPaise = lines.reduce((sum, l) => sum + l.unit, 0);
    if (input.expectedTotalPaise !== undefined && input.expectedTotalPaise !== totalPaise) {
      // The screen showed another total: collect nothing, let the receptionist look again.
      throw opdError(409, OpdErrorCode.PRICE_CHANGED, {
        totalPaise,
        expectedTotalPaise: input.expectedTotalPaise,
      });
    }
    const plan = await planPayments(tx, input, totalPaise, tenantId);

    // ---- write everything (numbers are taken on THIS transaction: a rollback leaves no gap)
    const billNumber = await allocateBillingNumber(this.numbering, tx, tenantId, 'BILL', now);
    const bill = await tx.bill.create({
      data: {
        tenantId,
        branchId,
        visitId,
        billType: 'INVESTIGATION',
        billNumber: billNumber.formatted,
        subtotalPaise: totalPaise,
        taxPaise: 0,
        totalPaise,
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      },
    });
    for (const [index, l] of lines.entries()) {
      const line = await tx.billLine.create({
        data: {
          tenantId,
          billId: bill.id,
          lineNo: index + 1,
          kind: 'INVESTIGATION',
          chargeItemId: l.item.id,
          codeSnapshot: l.item.code,
          descriptionSnapshot: l.item.name,
          quantity: 1,
          unitPricePaise: l.unit,
          taxRateBp: 0,
          taxPaise: 0,
          lineTotalPaise: l.unit,
        },
      });
      // Atomic hand-over: a second request for the same test finds it no longer ORDERED.
      const moved = await tx.investigationOrder.updateMany({
        where: { id: l.order.id, tenantId, status: 'ORDERED' },
        data: { status: 'BILLED', billLineId: line.id, resolvedBy: userId, resolvedAt: now },
      });
      if (moved.count !== 1) {
        throw opdError(409, OpdErrorCode.ORDERS_NOT_AVAILABLE);
      }
    }
    for (const d of declined) {
      const moved = await tx.investigationOrder.updateMany({
        where: { id: d.orderId, tenantId, status: 'ORDERED' },
        data: {
          status: 'NOT_TAKEN',
          notTakenReason: d.reason.trim(),
          resolvedBy: userId,
          resolvedAt: now,
        },
      });
      if (moved.count !== 1) {
        throw opdError(409, OpdErrorCode.ORDERS_NOT_AVAILABLE);
      }
    }

    const paid: Array<{ id: string; modeCode: string; amountPaise: number }> = [];
    if (plan.length > 0) {
      // ONE receipt (one number) for all payment lines of this bill.
      const receiptNo = await allocateBillingNumber(this.numbering, tx, tenantId, 'RECEIPT', now);
      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          billId: bill.id,
          branchId,
          receiptNumber: receiptNo.formatted,
          totalPaise,
          issuedBy: userId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      for (const [index, line] of plan.entries()) {
        const payment = await tx.payment.create({
          data: {
            tenantId,
            billId: bill.id,
            branchId,
            receiptId: receipt.id,
            paymentModeId: line.modeId,
            amountPaise: line.amountPaise,
            referenceNo: line.referenceNo,
            receivedBy: userId,
            // The first line keeps the request key; later lines get a derived key that a
            // caller's key can never equal (the key pattern has no '#').
            idempotencyKey:
              index === 0 ? input.idempotencyKey : `${input.idempotencyKey}#${index + 1}`,
          },
        });
        paid.push({ id: payment.id, modeCode: line.modeCode, amountPaise: line.amountPaise });
      }
    }

    // Audit: ids, counts, amounts and codes only (no names or other personal values).
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId,
        action: OPD_AUDIT.testsBilled,
        entityType: 'bill',
        entityId: bill.id,
        metadata: { visitId, tests: lines.length, notTaken: declined.length, totalPaise },
      },
    });
    if (declined.length > 0) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: OPD_AUDIT.testsNotTaken,
          entityType: 'opd_visit',
          entityId: visitId,
          metadata: { count: declined.length },
        },
      });
    }
    for (const p of paid) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: OPD_AUDIT.paymentReceived,
          entityType: 'payment',
          entityId: p.id,
          metadata: {
            billId: bill.id,
            amountPaise: p.amountPaise,
            paymentModeCode: p.modeCode,
            paymentLines: paid.length,
          },
        },
      });
    }
    return this.resultInTx(tx, actor, visitId, bill.id, false);
  }

  // ------------------------------------------------------------------------ helpers

  private async resultInTx(
    tx: TenantTx,
    actor: Actor,
    visitId: string,
    billId: string,
    replayed: boolean,
  ): Promise<BillInvestigationsResult> {
    const bill = await tx.bill.findFirstOrThrow({
      where: { id: billId, tenantId: actor.tenantId },
      include: BILL_INCLUDE,
    });
    return {
      replayed,
      visitId,
      bill: toBillView(bill, true),
      orders: await this.ordersInTx(tx, actor, visitId),
    };
  }

  private async ordersInTx(tx: TenantTx, actor: Actor, visitId: string): Promise<OrderView[]> {
    const rows = await tx.investigationOrder.findMany({
      where: { tenantId: actor.tenantId, visitId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { billLine: { select: { bill: { select: { billNumber: true } } } } },
    });
    return rows.map((o) => ({
      id: o.id,
      chargeItemId: o.chargeItemId,
      code: o.codeSnapshot,
      name: o.nameSnapshot,
      status: o.status,
      notTakenReason: o.notTakenReason,
      billNumber: o.billLine?.bill.billNumber ?? null,
      orderedAt: o.createdAt.toISOString(),
      resolvedAt: o.resolvedAt ? o.resolvedAt.toISOString() : null,
    }));
  }

  /** The price in force now for each test (the latest effective one); tests without a price are absent. */
  private async currentPrices(
    tx: TenantTx,
    tenantId: string,
    chargeItemIds: string[],
    now: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (chargeItemIds.length === 0) {
      return out;
    }
    const rows = await tx.chargeItemPrice.findMany({
      where: { tenantId, chargeItemId: { in: chargeItemIds }, effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      select: { chargeItemId: true, amountPaise: true },
    });
    for (const r of rows) {
      if (!out.has(r.chargeItemId)) {
        out.set(r.chargeItemId, r.amountPaise);
      }
    }
    return out;
  }
}
