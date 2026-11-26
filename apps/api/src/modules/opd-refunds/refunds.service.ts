import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { NumberSeriesService } from '../numbering/number-series.service';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { allocateBillingNumber } from '../opd-visits/billing-helpers';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { OPD_AUDIT } from '../opd-visits/opd-visits.config';
import type { Actor } from '../opd-visits/opd-visits.service';
import { OPD_REFUNDS_CONFIG as C } from './opd-refunds.config';
import type {
  ApproveRefundDto,
  RejectRefundDto,
  RequestCancelDto,
  RequestRefundDto,
} from './dto/refunds.dto';

const REQUEST_INCLUDE = {
  bill: {
    select: {
      billNumber: true,
      billType: true,
      totalPaise: true,
      paidPaise: true,
      refundedPaise: true,
    },
  },
  visit: {
    select: {
      id: true,
      status: true,
      consultationStartedAt: true,
      tokenNo: true,
      patient: { select: { id: true, uhid: true, name: true } },
      doctor: { select: { code: true, user: { select: { displayName: true } } } },
    },
  },
  requester: { select: { id: true, displayName: true } },
  decider: { select: { id: true, displayName: true } },
  refunds: {
    orderBy: [{ refundedAt: 'asc' }, { id: 'asc' }],
    include: { paymentMode: { select: { code: true, name: true } } },
  },
} satisfies Prisma.RefundRequestInclude;

type RequestRow = Prisma.RefundRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export type RefundRequestView = {
  id: string;
  type: string;
  status: string;
  amountPaise: number;
  reason: string;
  bill: {
    id: string;
    billNumber: string;
    billType: string;
    totalPaise: number;
    paidPaise: number;
    refundedPaise: number;
    refundablePaise: number;
  };
  visit: {
    id: string;
    status: string;
    token: string | null;
    consultationStarted: boolean;
    patient: { id: string; uhid: string; name: string };
    doctor: { code: string; name: string };
  };
  requestedBy: { id: string; name: string };
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The refund voucher number; present only when money was returned. */
  refundNumber: string | null;
  refunds: Array<{
    paymentMode: { code: string; name: string };
    amountPaise: number;
    referenceNo: string | null;
    refundedAt: string;
  }>;
};

const clean = (s: string | undefined): string | null => {
  const t = s?.trim() ?? '';
  return t === '' ? null : t;
};

/** A database rule (check violation, SQLSTATE 23514) refused the change. */
function isRuleViolation(error: unknown): boolean {
  const e = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; originalCode?: unknown };
    meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } };
  } | null;
  return (
    e?.code === '23514' ||
    e?.cause?.code === '23514' ||
    e?.cause?.originalCode === '23514' ||
    e?.meta?.code === '23514' ||
    e?.meta?.driverAdapterError?.cause?.originalCode === '23514'
  );
}

type NewRequest = {
  type: 'REFUND' | 'CANCEL_VISIT';
  billId: string;
  amountPaise: number | null;
  reason: string;
  idempotencyKey: string;
};

/**
 * Step 6a: refund and cancellation requests. The Receptionist asks (with a reason); an Admin
 * approves or rejects; approving writes REFUND ledger rows in the ORIGINAL payment modes and, for a
 * cancellation, cancels the visit (its token leaves the queue). The original bill is never changed.
 *
 * The database is the last line of defence (bill locked first, never more than paid minus
 * refunded, never more than a payment received, no refund of the consultation once it started, the
 * asker never decides); this service gives clean errors first. The branch always comes from the
 * token: a request of another branch is "not found".
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly numbering: NumberSeriesService,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------------- ask

  /** Ask for money back on one bill: any amount up to what was paid and not yet refunded. */
  async requestRefund(billId: string, body: RequestRefundDto, actor: Actor) {
    return this.run(() =>
      this.tenantDb.withTenant((tx) =>
        this.requestInTx(
          tx,
          {
            type: 'REFUND',
            billId,
            amountPaise: body.amountPaise,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey,
          },
          actor,
        ),
      ),
    );
  }

  /** Ask to cancel a waiting visit and return its consultation fee (all of it unless a figure is given). */
  async requestCancel(visitId: string, body: RequestCancelDto, actor: Actor) {
    return this.run(() =>
      this.tenantDb.withTenant(async (tx) => {
        const bill = await tx.bill.findFirst({
          where: {
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            visitId,
            billType: 'CONSULTATION',
          },
          select: { id: true },
        });
        if (!bill) {
          throw opdError(404, OpdErrorCode.VISIT_NOT_FOUND);
        }
        return this.requestInTx(
          tx,
          {
            type: 'CANCEL_VISIT',
            billId: bill.id,
            amountPaise: body.amountPaise ?? null,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey,
          },
          actor,
        );
      }),
    );
  }

  private async requestInTx(tx: TenantTx, input: NewRequest, actor: Actor) {
    const { tenantId, branchId, userId } = actor;
    const reason = input.reason.trim();
    if (reason === '') {
      throw opdError(400, OpdErrorCode.REASON_REQUIRED);
    }
    const bill = await tx.bill.findFirst({
      where: { id: input.billId, tenantId, branchId },
      select: {
        id: true,
        visitId: true,
        billType: true,
        paidPaise: true,
        refundedPaise: true,
        visit: { select: { status: true, consultationStartedAt: true } },
      },
    });
    if (!bill) {
      throw opdError(404, OpdErrorCode.BILL_NOT_FOUND);
    }
    const open = await tx.refundRequest.findMany({
      where: { tenantId, billId: bill.id, status: 'REQUESTED' },
      select: { amountPaise: true, requestType: true },
    });
    const pendingPaise = open.reduce((sum, r) => sum + r.amountPaise, 0);
    const refundablePaise = bill.paidPaise - bill.refundedPaise;
    // A cancellation without a figure returns everything that is still free to return.
    const amountPaise = input.amountPaise ?? Math.max(refundablePaise - pendingPaise, 0);

    // Replay: the same key means the same request, never a different one.
    const same = await tx.refundRequest.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
      include: REQUEST_INCLUDE,
    });
    if (same) {
      if (
        same.billId !== bill.id ||
        same.requestType !== input.type ||
        same.reason !== reason ||
        (input.amountPaise !== null && same.amountPaise !== input.amountPaise)
      ) {
        throw opdError(409, OpdErrorCode.IDEMPOTENCY_KEY_REUSED);
      }
      return { replayed: true, request: await this.toView(tx, same) };
    }

    if (bill.billType === 'CONSULTATION' && bill.visit.consultationStartedAt !== null) {
      throw opdError(409, OpdErrorCode.CONSULTATION_STARTED);
    }
    if (input.type === 'CANCEL_VISIT') {
      if (bill.visit.status !== 'WAITING') {
        throw opdError(409, OpdErrorCode.VISIT_NOT_WAITING, { status: bill.visit.status });
      }
      if (open.some((r) => r.requestType === 'CANCEL_VISIT')) {
        throw opdError(409, OpdErrorCode.REFUND_REQUEST_OPEN);
      }
    }
    if (amountPaise > refundablePaise - pendingPaise) {
      throw opdError(409, OpdErrorCode.REFUND_EXCEEDS_REFUNDABLE, {
        refundablePaise,
        pendingPaise,
      });
    }

    const created = await tx.refundRequest.create({
      data: {
        tenantId,
        branchId,
        billId: bill.id,
        visitId: bill.visitId,
        requestType: input.type,
        amountPaise,
        reason,
        requestedBy: userId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    // Audit: ids and amounts only (the reason text stays on the request, not in the audit trail).
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId,
        action: OPD_AUDIT.refundRequested,
        entityType: 'refund_request',
        entityId: created.id,
        metadata: {
          billId: bill.id,
          visitId: bill.visitId,
          type: input.type,
          amountPaise,
        },
      },
    });
    const row = await tx.refundRequest.findUniqueOrThrow({
      where: { id: created.id },
      include: REQUEST_INCLUDE,
    });
    return { replayed: false, request: await this.toView(tx, row) };
  }

  // ------------------------------------------------------------------------- read

  /**
   * How many requests wait for a decision (status REQUESTED), in the branches where the caller may
   * approve (Step 2.1c). It is what the badge next to the OPD queue shows; the route needs the
   * approve permission, so only people who can decide ever ask.
   */
  async pendingCount(actor: Actor): Promise<{ count: number }> {
    const branchIds = await this.access.permittedBranches('opd.refunds.approve', 'OPD');
    if (branchIds.length === 0) {
      return { count: 0 };
    }
    return this.tenantDb.withTenant(async (tx) => ({
      count: await tx.refundRequest.count({
        where: { tenantId: actor.tenantId, status: 'REQUESTED', branchId: { in: branchIds } },
      }),
    }));
  }

  async list(actor: Actor, filter: { status?: string; page: number; pageSize: number }) {
    return this.tenantDb.withTenant(async (tx) => {
      const where: Prisma.RefundRequestWhereInput = {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        ...(filter.status
          ? { status: filter.status as 'REQUESTED' | 'APPROVED' | 'REJECTED' }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.refundRequest.count({ where }),
        tx.refundRequest.findMany({
          where,
          include: REQUEST_INCLUDE,
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      const prefix = await this.tokenPrefix(tx, actor.tenantId);
      return {
        items: rows.map((r) => this.mapRow(r, prefix)),
        total,
        page: filter.page,
        pageSize: filter.pageSize,
      };
    });
  }

  async getOne(id: string, actor: Actor): Promise<RefundRequestView> {
    return this.tenantDb.withTenant(async (tx) => {
      const row = await tx.refundRequest.findFirst({
        where: { id, tenantId: actor.tenantId, branchId: actor.branchId },
        include: REQUEST_INCLUDE,
      });
      if (!row) {
        throw opdError(404, OpdErrorCode.REFUND_REQUEST_NOT_FOUND);
      }
      return this.toView(tx, row);
    });
  }

  // --------------------------------------------------------------------- decide

  /**
   * An Admin approves: the REFUND rows are written in the original payment modes (latest payment
   * first), the voucher number is taken, and a cancellation cancels the visit. Everything happens
   * in ONE transaction. Two approvals at the same moment: one wins, the other gets
   * REQUEST_ALREADY_DECIDED.
   */
  async approve(id: string, body: ApproveRefundDto, actor: Actor) {
    return this.run(() => this.tenantDb.withTenant((tx) => this.approveInTx(tx, id, body, actor)));
  }

  private async approveInTx(tx: TenantTx, id: string, body: ApproveRefundDto, actor: Actor) {
    const { tenantId, branchId, userId } = actor;
    const now = this.clock.now();
    const req = await tx.refundRequest.findFirst({
      where: { id, tenantId, branchId },
      include: {
        bill: { select: { billType: true, paidPaise: true, refundedPaise: true } },
        visit: { select: { status: true, consultationStartedAt: true } },
      },
    });
    if (!req) {
      throw opdError(404, OpdErrorCode.REFUND_REQUEST_NOT_FOUND);
    }
    if (req.status !== 'REQUESTED') {
      // A second click on "Approve" by the same person returns the same result.
      if (req.status === 'APPROVED' && req.decidedBy === userId) {
        return { replayed: true, request: await this.getInTx(tx, id, actor) };
      }
      throw opdError(409, OpdErrorCode.REQUEST_ALREADY_DECIDED, { status: req.status });
    }
    if (req.requestedBy === userId) {
      throw opdError(403, OpdErrorCode.SELF_APPROVAL_FORBIDDEN);
    }
    // The state may have moved on since the request was made: check again, with clean errors.
    if (req.bill.billType === 'CONSULTATION' && req.visit.consultationStartedAt !== null) {
      throw opdError(409, OpdErrorCode.CONSULTATION_STARTED);
    }
    if (req.requestType === 'CANCEL_VISIT' && req.visit.status !== 'WAITING') {
      throw opdError(409, OpdErrorCode.VISIT_NOT_WAITING, { status: req.visit.status });
    }
    if (req.amountPaise > req.bill.paidPaise - req.bill.refundedPaise) {
      throw opdError(409, OpdErrorCode.REFUND_EXCEEDS_REFUNDABLE, {
        refundablePaise: req.bill.paidPaise - req.bill.refundedPaise,
      });
    }

    // The voucher number exists exactly when money is returned (taken on THIS transaction).
    const number =
      req.amountPaise > 0
        ? await allocateBillingNumber(this.numbering, tx, tenantId, 'REFUND', now)
        : null;
    // The status change is the gate: it takes the row lock, and the database locks the bill and
    // re-checks every rule. A second approval waits here and then finds the request decided.
    const moved = await tx.refundRequest.updateMany({
      where: { id, tenantId, branchId, status: 'REQUESTED' },
      data: {
        status: 'APPROVED',
        decidedBy: userId,
        decidedAt: now,
        decisionNote: clean(body.note),
        refundNumber: number?.formatted ?? null,
      },
    });
    if (moved.count !== 1) {
      throw opdError(409, OpdErrorCode.REQUEST_ALREADY_DECIDED);
    }

    const written: Array<{ modeCode: string; amountPaise: number }> = [];
    if (req.amountPaise > 0) {
      // The bill is locked by now: these reads are the latest committed state.
      const payments = await tx.payment.findMany({
        where: { tenantId, billId: req.billId },
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        include: { paymentMode: { select: { code: true, requiresReference: true } } },
      });
      const done = await tx.refund.groupBy({
        by: ['paymentId'],
        where: { tenantId, billId: req.billId },
        _sum: { amountPaise: true },
      });
      const doneBy = new Map(done.map((d) => [d.paymentId, d._sum.amountPaise ?? 0]));
      let left = req.amountPaise;
      const plan: Array<{
        paymentId: string;
        modeId: string;
        modeCode: string;
        requiresReference: boolean;
        amountPaise: number;
      }> = [];
      for (const p of payments) {
        if (left === 0) {
          break;
        }
        const available = p.amountPaise - (doneBy.get(p.id) ?? 0);
        if (available <= 0) {
          continue;
        }
        const take = Math.min(available, left);
        plan.push({
          paymentId: p.id,
          modeId: p.paymentModeId,
          modeCode: p.paymentMode.code,
          requiresReference: p.paymentMode.requiresReference,
          amountPaise: take,
        });
        left -= take;
      }
      if (left > 0) {
        throw opdError(409, OpdErrorCode.REFUND_EXCEEDS_REFUNDABLE);
      }
      for (const line of plan) {
        // The reference comes from a free-form object: only TEXT of a sane length is accepted.
        const raw: unknown = Object.prototype.hasOwnProperty.call(
          body.references ?? {},
          line.modeCode,
        )
          ? body.references![line.modeCode]
          : undefined;
        if (raw !== undefined && (typeof raw !== 'string' || raw.length > C.referenceMaxLength)) {
          throw opdError(400, OpdErrorCode.REFERENCE_INVALID, { paymentModeCode: line.modeCode });
        }
        const reference = clean(raw as string | undefined);
        if (line.requiresReference && reference === null) {
          throw opdError(400, OpdErrorCode.REFERENCE_REQUIRED, { paymentModeCode: line.modeCode });
        }
        await tx.refund.create({
          data: {
            tenantId,
            branchId,
            billId: req.billId,
            requestId: req.id,
            paymentId: line.paymentId,
            paymentModeId: line.modeId,
            amountPaise: line.amountPaise,
            referenceNo: reference,
            refundedBy: userId,
          },
        });
        written.push({ modeCode: line.modeCode, amountPaise: line.amountPaise });
      }
    }

    if (req.requestType === 'CANCEL_VISIT') {
      // The visit leaves the queue (the database allows this only for an approved cancellation).
      const cancelled = await tx.opdVisit.updateMany({
        where: { id: req.visitId, tenantId, branchId, status: 'WAITING' },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledReason: req.reason },
      });
      if (cancelled.count !== 1) {
        throw opdError(409, OpdErrorCode.VISIT_NOT_WAITING);
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: OPD_AUDIT.visitCancelled,
          entityType: 'opd_visit',
          entityId: req.visitId,
          metadata: { requestId: req.id },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId,
        action: OPD_AUDIT.refundApproved,
        entityType: 'refund_request',
        entityId: req.id,
        metadata: {
          billId: req.billId,
          type: req.requestType,
          amountPaise: req.amountPaise,
          paymentModes: written.map((w) => ({ code: w.modeCode, amountPaise: w.amountPaise })),
        },
      },
    });
    return { replayed: false, request: await this.getInTx(tx, id, actor) };
  }

  /** An Admin rejects, with a note. The asker never decides (the database refuses it too). */
  async reject(id: string, body: RejectRefundDto, actor: Actor) {
    return this.run(() =>
      this.tenantDb.withTenant(async (tx) => {
        const { tenantId, branchId, userId } = actor;
        const req = await tx.refundRequest.findFirst({
          where: { id, tenantId, branchId },
          select: { id: true, status: true, requestedBy: true, billId: true, requestType: true },
        });
        if (!req) {
          throw opdError(404, OpdErrorCode.REFUND_REQUEST_NOT_FOUND);
        }
        if (req.status !== 'REQUESTED') {
          throw opdError(409, OpdErrorCode.REQUEST_ALREADY_DECIDED, { status: req.status });
        }
        if (req.requestedBy === userId) {
          throw opdError(403, OpdErrorCode.SELF_APPROVAL_FORBIDDEN);
        }
        const note = body.note.trim();
        if (note === '') {
          throw opdError(400, OpdErrorCode.REASON_REQUIRED);
        }
        const moved = await tx.refundRequest.updateMany({
          where: { id, tenantId, branchId, status: 'REQUESTED' },
          data: {
            status: 'REJECTED',
            decidedBy: userId,
            decidedAt: this.clock.now(),
            decisionNote: note,
          },
        });
        if (moved.count !== 1) {
          throw opdError(409, OpdErrorCode.REQUEST_ALREADY_DECIDED);
        }
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: userId,
            branchId,
            action: OPD_AUDIT.refundRejected,
            entityType: 'refund_request',
            entityId: id,
            metadata: { billId: req.billId, type: req.requestType },
          },
        });
        return { replayed: false, request: await this.getInTx(tx, id, actor) };
      }),
    );
  }

  // ------------------------------------------------------------------- helpers

  /** A rule of the database refusing the change becomes a clean 409 (never a crash). */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isRuleViolation(error)) {
        throw opdError(409, OpdErrorCode.RULE_REFUSED);
      }
      throw error;
    }
  }

  private async getInTx(tx: TenantTx, id: string, actor: Actor): Promise<RefundRequestView> {
    const row = await tx.refundRequest.findFirstOrThrow({
      where: { id, tenantId: actor.tenantId, branchId: actor.branchId },
      include: REQUEST_INCLUDE,
    });
    return this.toView(tx, row);
  }

  private async tokenPrefix(tx: TenantTx, tenantId: string): Promise<string> {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    return settings?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix;
  }

  private async toView(tx: TenantTx, row: RequestRow): Promise<RefundRequestView> {
    return this.mapRow(row, await this.tokenPrefix(tx, row.tenantId));
  }

  private mapRow(row: RequestRow, tokenPrefix: string): RefundRequestView {
    return {
      id: row.id,
      type: row.requestType,
      status: row.status,
      amountPaise: row.amountPaise,
      reason: row.reason,
      bill: {
        id: row.billId,
        billNumber: row.bill.billNumber,
        billType: row.bill.billType,
        totalPaise: row.bill.totalPaise,
        paidPaise: row.bill.paidPaise,
        refundedPaise: row.bill.refundedPaise,
        refundablePaise: row.bill.paidPaise - row.bill.refundedPaise,
      },
      visit: {
        id: row.visit.id,
        status: row.visit.status,
        token: row.visit.tokenNo === null ? null : `${tokenPrefix}${row.visit.tokenNo}`,
        consultationStarted: row.visit.consultationStartedAt !== null,
        patient: row.visit.patient,
        doctor: { code: row.visit.doctor.code, name: row.visit.doctor.user.displayName },
      },
      requestedBy: { id: row.requester.id, name: row.requester.displayName },
      requestedAt: row.requestedAt.toISOString(),
      decidedBy: row.decider ? { id: row.decider.id, name: row.decider.displayName } : null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decisionNote: row.decisionNote,
      refundNumber: row.refundNumber,
      refunds: row.refunds.map((r) => ({
        paymentMode: r.paymentMode,
        amountPaise: r.amountPaise,
        referenceNo: r.referenceNo,
        refundedAt: r.refundedAt.toISOString(),
      })),
    };
  }
}
