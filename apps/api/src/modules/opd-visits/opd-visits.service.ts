import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { NumberSeriesService } from '../numbering/number-series.service';
import { TokenCounterService } from '../numbering/token-counter.service';
import { DoctorAvailabilityService } from '../opd-masters/doctor-availability.service';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { zonedParts } from '../patients/uhid.util';
import { opdError, OpdErrorCode } from './opd-visit.errors';
import { OPD_AUDIT, OPD_VISITS_CONFIG as C } from './opd-visits.config';

export type Actor = { tenantId: string; userId: string; branchId: string };

export type CreateVisitInput = {
  patientId: string;
  doctorProfileId: string;
  visitType: 'NEW' | 'FOLLOW_UP';
  idempotencyKey: string;
  paymentModeCode?: string;
  referenceNo?: string;
};

const VISIT_INCLUDE = {
  patient: { select: { id: true, uhid: true, name: true } },
  doctor: { select: { id: true, code: true, user: { select: { displayName: true } } } },
  branch: { select: { id: true, name: true } },
  bills: {
    include: {
      lines: { orderBy: { lineNo: 'asc' } },
      payments: {
        orderBy: { paidAt: 'asc' },
        include: { paymentMode: { select: { code: true, name: true } } },
      },
    },
  },
} satisfies Prisma.OpdVisitInclude;

type VisitRow = Prisma.OpdVisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

export type BillView = {
  id: string;
  billNumber: string;
  billType: string;
  billDate: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  refundedPaise: number;
  paymentStatus: string;
  lines?: Array<{
    lineNo: number;
    kind: string;
    code: string;
    description: string;
    quantity: number;
    unitPricePaise: number;
    taxPaise: number;
    lineTotalPaise: number;
    pricingNote: string | null;
  }>;
  payments?: Array<{
    id: string;
    receiptNumber: string;
    amountPaise: number;
    paymentMode: { code: string; name: string };
    referenceNo: string | null;
    paidAt: string;
  }>;
};

export type VisitView = {
  id: string;
  status: string;
  visitType: string;
  visitDate: string;
  branch: { id: string; name: string };
  patient: { id: string; uhid: string; name: string };
  doctor: { id: string; code: string; name: string };
  previousVisitId: string | null;
  token: { date: string; no: number; label: string } | null;
  queuedAt: string | null;
  createdAt: string;
  /** Present only for callers with opd.billing.read (doctors and nurses never see money). */
  bill?: BillView | null;
};

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The numbering service throws a plain Error when the hospital has no series settings yet. */
function isMissingSeriesSettings(error: unknown): boolean {
  return error instanceof Error && /^No number_series_settings/.test(error.message);
}

/** The hospital's local calendar day as a UTC-midnight Date (Prisma @db.Date). */
function localDate(now: Date, timeZone: string): Date {
  const { year, month, day } = zonedParts(now, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
  return (
    e?.code === 'P2002' ||
    e?.code === '23505' ||
    e?.cause?.code === '23505' ||
    (typeof e?.message === 'string' && /duplicate key|unique constraint/i.test(e.message))
  );
}

function toBillView(bill: VisitRow['bills'][number], detail: boolean): BillView {
  const base: BillView = {
    id: bill.id,
    billNumber: bill.billNumber,
    billType: bill.billType,
    billDate: bill.billDate.toISOString(),
    subtotalPaise: bill.subtotalPaise,
    taxPaise: bill.taxPaise,
    totalPaise: bill.totalPaise,
    paidPaise: bill.paidPaise,
    refundedPaise: bill.refundedPaise,
    paymentStatus: bill.paymentStatus,
  };
  if (!detail) {
    return base;
  }
  return {
    ...base,
    lines: bill.lines.map((l) => ({
      lineNo: l.lineNo,
      kind: l.kind,
      code: l.codeSnapshot,
      description: l.descriptionSnapshot,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      taxPaise: l.taxPaise,
      lineTotalPaise: l.lineTotalPaise,
      pricingNote: l.pricingNote,
    })),
    payments: bill.payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amountPaise: p.amountPaise,
      paymentMode: p.paymentMode,
      referenceNo: p.referenceNo,
      paidAt: p.paidAt.toISOString(),
    })),
  };
}

function toVisitView(
  row: VisitRow,
  tokenPrefix: string,
  opts: { withMoney: boolean; detail: boolean },
): VisitView {
  const consultationBill = row.bills.find((b) => b.billType === 'CONSULTATION') ?? row.bills[0];
  return {
    id: row.id,
    status: row.status,
    visitType: row.visitType,
    visitDate: isoDate(row.visitDate),
    branch: row.branch,
    patient: row.patient,
    doctor: { id: row.doctor.id, code: row.doctor.code, name: row.doctor.user.displayName },
    previousVisitId: row.previousVisitId,
    token:
      row.tokenNo !== null && row.tokenDate !== null
        ? { date: isoDate(row.tokenDate), no: row.tokenNo, label: `${tokenPrefix}${row.tokenNo}` }
        : null,
    queuedAt: row.queuedAt ? row.queuedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    ...(opts.withMoney
      ? { bill: consultationBill ? toBillView(consultationBill, opts.detail) : null }
      : {}),
  };
}

/**
 * Step 4a: OPD visit, consultation bill and cash payment.
 *
 * Everything for one "Take payment" click happens in ONE database transaction (visit, bill,
 * lines, registration-fee record, payment, ledger by trigger, token, audit), so nothing half-done
 * is ever stored and bill/receipt/token numbers have no gaps. The database itself refuses wrong
 * money (see migration 20261118100000). The branch always comes from the token.
 */
@Injectable()
export class OpdVisitsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    private readonly availability: DoctorAvailabilityService,
    private readonly numbering: NumberSeriesService,
    private readonly tokens: TokenCounterService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ----------------------------------------------------------------------------- doctors

  /** Doctors of the ACTIVE branch with today's availability and current fees (paise). */
  async listDoctors(actor: Actor) {
    const now = this.clock.now();
    return this.tenantDb.withTenant(async (tx) => {
      const profiles = await tx.doctorProfile.findMany({
        where: {
          tenantId: actor.tenantId,
          active: true,
          user: {
            isActive: true,
            userBranches: { some: { branchId: actor.branchId, isActive: true } },
          },
        },
        include: { user: { select: { displayName: true } } },
        orderBy: { code: 'asc' },
      });
      const fees = await tx.doctorFee.findMany({
        where: {
          tenantId: actor.tenantId,
          doctorProfileId: { in: profiles.map((p) => p.id) },
          effectiveFrom: { lte: now },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      const items = [];
      for (const profile of profiles) {
        const availability = await this.availability.getAvailabilityInTx(
          tx,
          actor.tenantId,
          profile.id,
          actor.branchId,
          now,
        );
        const feeFor = (type: 'NEW' | 'FOLLOW_UP') =>
          fees.find((f) => f.doctorProfileId === profile.id && f.visitType === type)?.amountPaise ??
          null;
        items.push({
          id: profile.id,
          code: profile.code,
          name: profile.user.displayName,
          department: profile.department,
          available: availability.available,
          unavailableReason: availability.reason,
          outsideTimings: availability.outsideTimings,
          feeNewPaise: feeFor('NEW'),
          feeFollowUpPaise: feeFor('FOLLOW_UP'),
        });
      }
      return { items };
    });
  }

  // ------------------------------------------------------------------- create + take payment

  async createVisit(
    input: CreateVisitInput,
    actor: Actor,
  ): Promise<{ replayed: boolean; visit: VisitView }> {
    // The route needs opd.visits.create; taking the money is a separate permission.
    if (!(await this.access.can('opd.billing.collect', actor.branchId, 'OPD'))) {
      throw opdError(403, OpdErrorCode.FORBIDDEN);
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.tenantDb.withTenant((tx) => this.createInTx(tx, input, actor));
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Same key sent at the same moment (double click): the other request won, return its result.
        const replay = await this.tenantDb.withTenant((tx) => this.replayInTx(tx, input, actor));
        if (replay) {
          return replay;
        }
        // Another visit of the same patient took the registration fee a moment before: retry once
        // so this request sees it and leaves the fee out.
        if (attempt >= C.createMaxAttempts) {
          throw error;
        }
      }
    }
  }

  private async replayInTx(
    tx: TenantTx,
    input: CreateVisitInput,
    actor: Actor,
  ): Promise<{ replayed: true; visit: VisitView } | null> {
    const bill = await tx.bill.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey },
      },
      include: { visit: true },
    });
    if (!bill) {
      return null;
    }
    const v = bill.visit;
    if (
      v.patientId !== input.patientId ||
      v.doctorProfileId !== input.doctorProfileId ||
      v.visitType !== input.visitType ||
      v.branchId !== actor.branchId
    ) {
      // The same key must never mean a different request.
      throw opdError(409, OpdErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    const visit = await this.viewInTx(tx, actor, v.id, { withMoney: true, detail: true });
    return { replayed: true, visit };
  }

  private async createInTx(
    tx: TenantTx,
    input: CreateVisitInput,
    actor: Actor,
  ): Promise<{ replayed: boolean; visit: VisitView }> {
    const replay = await this.replayInTx(tx, input, actor);
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
    const timeZone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
    const followUpFreeDays = settings?.followUpFreeDays ?? OPD_SETTINGS_DEFAULTS.followUpFreeDays;

    const patient = await tx.patient.findFirst({
      where: { id: input.patientId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!patient) {
      throw opdError(404, OpdErrorCode.PATIENT_NOT_FOUND);
    }

    const doctor = await tx.doctorProfile.findFirst({
      where: { id: input.doctorProfileId, tenantId, active: true, user: { isActive: true } },
      include: { user: { select: { displayName: true } } },
    });
    if (!doctor) {
      throw opdError(404, OpdErrorCode.DOCTOR_NOT_FOUND);
    }
    const inBranch = await tx.userBranch.findFirst({
      where: { tenantId, userId: doctor.userId, branchId, isActive: true },
      select: { id: true },
    });
    if (!inBranch) {
      throw opdError(400, OpdErrorCode.DOCTOR_NOT_IN_BRANCH);
    }
    const availability = await this.availability.getAvailabilityInTx(
      tx,
      tenantId,
      doctor.id,
      branchId,
      now,
    );
    if (!availability.available) {
      throw opdError(400, OpdErrorCode.DOCTOR_UNAVAILABLE, { reason: availability.reason });
    }

    // ---- prices (the amount is never taken from the request)
    const fee = await tx.doctorFee.findFirst({
      where: {
        tenantId,
        doctorProfileId: doctor.id,
        visitType: input.visitType,
        effectiveFrom: { lte: now },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!fee) {
      throw opdError(409, OpdErrorCode.FEE_NOT_CONFIGURED, { what: 'CONSULTATION' });
    }
    const today = localDate(now, timeZone);

    let previousVisitId: string | null = null;
    let consultationUnit = fee.amountPaise;
    let pricingNote: string | null = null;
    if (input.visitType === 'FOLLOW_UP') {
      const previous = await tx.opdVisit.findFirst({
        where: {
          tenantId,
          patientId: patient.id,
          doctorProfileId: doctor.id,
          status: 'COMPLETED',
        },
        orderBy: { visitDate: 'desc' },
        select: { id: true, visitDate: true },
      });
      if (!previous) {
        throw opdError(400, OpdErrorCode.FOLLOW_UP_NEEDS_PREVIOUS_VISIT);
      }
      previousVisitId = previous.id;
      const daysSince = Math.floor((today.getTime() - previous.visitDate.getTime()) / C.msPerDay);
      if (daysSince <= followUpFreeDays) {
        consultationUnit = 0;
        pricingNote = 'FOLLOW_UP_FREE_WINDOW';
      }
    }

    // Registration fee: once per patient, across all branches (the database guarantees it).
    let registration: { itemId: string; code: string; name: string; unit: number } | null = null;
    const alreadyCharged = await tx.patientRegistrationFee.findFirst({
      where: { tenantId, patientId: patient.id, voidedAt: null },
      select: { id: true },
    });
    if (!alreadyCharged) {
      const item = await tx.chargeItem.findFirst({
        where: { tenantId, kind: 'REGISTRATION', active: true },
        orderBy: { code: 'asc' },
      });
      if (item) {
        const price = await tx.chargeItemPrice.findFirst({
          where: { tenantId, chargeItemId: item.id, effectiveFrom: { lte: now } },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!price) {
          throw opdError(409, OpdErrorCode.FEE_NOT_CONFIGURED, { what: 'REGISTRATION' });
        }
        registration = {
          itemId: item.id,
          code: item.code,
          name: item.name,
          unit: price.amountPaise,
        };
      }
    }
    const totalPaise = consultationUnit + (registration?.unit ?? 0);

    // ---- payment mode (only needed when money is due)
    let modeId: string | null = null;
    let modeCode: string | null = null;
    if (totalPaise > 0) {
      const code = input.paymentModeCode ?? C.defaultPaymentModeCode;
      const mode = await tx.paymentMode.findFirst({ where: { tenantId, code, active: true } });
      if (!mode) {
        throw opdError(400, OpdErrorCode.PAYMENT_MODE_NOT_AVAILABLE);
      }
      if (mode.requiresReference && !(input.referenceNo ?? '').trim()) {
        throw opdError(400, OpdErrorCode.REFERENCE_REQUIRED);
      }
      modeId = mode.id;
      modeCode = mode.code;
    }

    // ---- write everything (numbers are taken on THIS transaction: a rollback leaves no gap)
    const billNumber = await this.allocateNumber(tx, tenantId, 'BILL', now);
    const visit = await tx.opdVisit.create({
      data: {
        tenantId,
        branchId,
        patientId: patient.id,
        doctorProfileId: doctor.id,
        visitType: input.visitType,
        visitDate: today,
        previousVisitId,
        createdBy: userId,
      },
    });
    const bill = await tx.bill.create({
      data: {
        tenantId,
        branchId,
        visitId: visit.id,
        billType: 'CONSULTATION',
        billNumber: billNumber.formatted,
        subtotalPaise: totalPaise,
        taxPaise: 0,
        totalPaise,
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      },
    });
    await tx.billLine.create({
      data: {
        tenantId,
        billId: bill.id,
        lineNo: 1,
        kind: 'CONSULTATION',
        doctorFeeId: fee.id,
        codeSnapshot: doctor.code,
        descriptionSnapshot: doctor.user.displayName,
        quantity: 1,
        unitPricePaise: consultationUnit,
        taxRateBp: 0,
        taxPaise: 0,
        lineTotalPaise: consultationUnit,
        pricingNote,
      },
    });
    if (registration) {
      const line = await tx.billLine.create({
        data: {
          tenantId,
          billId: bill.id,
          lineNo: 2,
          kind: 'REGISTRATION',
          chargeItemId: registration.itemId,
          codeSnapshot: registration.code,
          descriptionSnapshot: registration.name,
          quantity: 1,
          unitPricePaise: registration.unit,
          taxRateBp: 0,
          taxPaise: 0,
          lineTotalPaise: registration.unit,
        },
      });
      await tx.patientRegistrationFee.create({
        data: { tenantId, patientId: patient.id, billLineId: line.id },
      });
    }

    let receiptNumber: string | null = null;
    let paymentId: string | null = null;
    if (totalPaise > 0 && modeId) {
      const receipt = await this.allocateNumber(tx, tenantId, 'RECEIPT', now);
      receiptNumber = receipt.formatted;
      const payment = await tx.payment.create({
        data: {
          tenantId,
          billId: bill.id,
          branchId,
          receiptNumber,
          paymentModeId: modeId,
          amountPaise: totalPaise,
          referenceNo: input.referenceNo?.trim() || null,
          receivedBy: userId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      paymentId = payment.id;
    }

    // The bill is settled (paid, or a free follow-up): the visit joins the queue (the database
    // refuses this transition for an unpaid bill).
    const token = await this.tokens.allocate({ tenantId, branchId, tx, now });
    await tx.opdVisit.update({
      where: { id: visit.id },
      data: {
        status: 'WAITING',
        tokenDate: new Date(`${token.tokenDate}T00:00:00.000Z`),
        tokenNo: token.tokenNo,
        queuedAt: now,
      },
    });

    // Audit: ids, amounts and codes only (no names, phones or other personal values).
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId,
        action: OPD_AUDIT.visitCreated,
        entityType: 'opd_visit',
        entityId: visit.id,
        metadata: {
          billId: bill.id,
          visitType: input.visitType,
          doctorProfileId: doctor.id,
          totalPaise,
          registrationCharged: registration !== null,
          freeFollowUp: pricingNote !== null,
        },
      },
    });
    if (paymentId) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: OPD_AUDIT.paymentReceived,
          entityType: 'payment',
          entityId: paymentId,
          metadata: { billId: bill.id, amountPaise: totalPaise, paymentModeCode: modeCode },
        },
      });
    }

    const view = await this.viewInTx(tx, actor, visit.id, { withMoney: true, detail: true });
    return { replayed: false, visit: view };
  }

  // ------------------------------------------------------------------------------- reads

  /** One visit of the ACTIVE branch. Money only for callers with opd.billing.read. */
  async getVisit(visitId: string, actor: Actor): Promise<VisitView> {
    return this.tenantDb.withTenant(async (tx) => {
      const scope = await this.readScope(tx, actor);
      const row = await tx.opdVisit.findFirst({
        where: {
          id: visitId,
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          ...(scope.ownDoctorId ? { doctorProfileId: scope.ownDoctorId } : {}),
        },
        include: VISIT_INCLUDE,
      });
      if (!row) {
        throw opdError(404, OpdErrorCode.VISIT_NOT_FOUND);
      }
      return toVisitView(row, await this.tokenPrefix(tx, actor.tenantId), {
        withMoney: scope.withMoney,
        detail: true,
      });
    });
  }

  /** Visits of one patient in the ACTIVE branch, newest first (bill summary only). */
  async listForPatient(patientId: string, actor: Actor, page: number, pageSize: number) {
    return this.tenantDb.withTenant(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (!patient) {
        throw opdError(404, OpdErrorCode.PATIENT_NOT_FOUND);
      }
      const scope = await this.readScope(tx, actor);
      const where: Prisma.OpdVisitWhereInput = {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        patientId,
        ...(scope.ownDoctorId ? { doctorProfileId: scope.ownDoctorId } : {}),
      };
      const [total, rows, prefix] = await Promise.all([
        tx.opdVisit.count({ where }),
        tx.opdVisit.findMany({
          where,
          include: VISIT_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.tokenPrefix(tx, actor.tenantId),
      ]);
      return {
        items: rows.map((r) =>
          toVisitView(r, prefix, { withMoney: scope.withMoney, detail: false }),
        ),
        total,
        page,
        pageSize,
      };
    });
  }

  // ----------------------------------------------------------------------------- helpers

  private async viewInTx(
    tx: TenantTx,
    actor: Actor,
    visitId: string,
    opts: { withMoney: boolean; detail: boolean },
  ): Promise<VisitView> {
    const row = await tx.opdVisit.findFirstOrThrow({
      where: { id: visitId, tenantId: actor.tenantId },
      include: VISIT_INCLUDE,
    });
    return toVisitView(row, await this.tokenPrefix(tx, actor.tenantId), opts);
  }

  private async allocateNumber(
    tx: TenantTx,
    tenantId: string,
    series: 'BILL' | 'RECEIPT',
    now: Date,
  ) {
    try {
      return await this.numbering.allocate({ tenantId, series, tx, now });
    } catch (error) {
      if (isMissingSeriesSettings(error)) {
        throw opdError(409, OpdErrorCode.NUMBER_SERIES_NOT_CONFIGURED, { series });
      }
      throw error;
    }
  }

  private async tokenPrefix(tx: TenantTx, tenantId: string): Promise<string> {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
    return settings?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix;
  }

  /**
   * Who sees what: money needs opd.billing.read; a doctor (who cannot read bills) sees only
   * their own visits. Everyone sees only the ACTIVE branch.
   */
  private async readScope(
    tx: TenantTx,
    actor: Actor,
  ): Promise<{ withMoney: boolean; ownDoctorId: string | null }> {
    const withMoney = await this.access.can('opd.billing.read', actor.branchId, 'OPD');
    const profile = await tx.doctorProfile.findFirst({
      where: { tenantId: actor.tenantId, userId: actor.userId },
      select: { id: true },
    });
    return { withMoney, ownDoctorId: profile && !withMoney ? profile.id : null };
  }
}
