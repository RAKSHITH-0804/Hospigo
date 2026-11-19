import type { TenantTx } from '../../database/tenant-db';
import type { NumberSeriesService } from '../numbering/number-series.service';
import { opdError, OpdErrorCode } from './opd-visit.errors';
import { OPD_VISITS_CONFIG as C } from './opd-visits.config';

/** One payment line, checked and resolved against the payment modes master. */
export type PaymentPlanLine = {
  modeId: string;
  modeCode: string;
  amountPaise: number;
  referenceNo: string | null;
};

/** What a "take payment" request may carry (the same shape for a visit and for a tests bill). */
export type PaymentRequestInput = {
  paymentModeCode?: string;
  referenceNo?: string;
  /** Split payment: one line per mode; replaces paymentModeCode / referenceNo. */
  payments?: Array<{ paymentModeCode: string; amountPaise: number; referenceNo?: string }>;
};

/** The numbering service throws a plain Error when the hospital has no series settings yet. */
function isMissingSeriesSettings(error: unknown): boolean {
  return error instanceof Error && /^No number_series_settings/.test(error.message);
}

/**
 * The payment lines of a request, checked: one line (the old single mode, default CASH) or a
 * split list that adds up EXACTLY to the total. Nothing is taken from the request that the
 * database does not check again (sum, one mode once per receipt).
 */
export async function planPayments(
  tx: TenantTx,
  input: PaymentRequestInput,
  totalPaise: number,
  tenantId: string,
): Promise<PaymentPlanLine[]> {
  if (
    input.payments !== undefined &&
    (input.paymentModeCode !== undefined || input.referenceNo !== undefined)
  ) {
    throw opdError(400, OpdErrorCode.PAYMENT_FIELDS_CONFLICT);
  }
  if (totalPaise === 0) {
    // A free bill takes no money: a payment list for it is a mistake, not something to ignore.
    if (input.payments !== undefined) {
      throw opdError(400, OpdErrorCode.PAYMENT_NOT_EXPECTED);
    }
    return [];
  }
  const requested = input.payments ?? [
    {
      paymentModeCode: input.paymentModeCode ?? C.defaultPaymentModeCode,
      amountPaise: totalPaise,
      referenceNo: input.referenceNo,
    },
  ];
  const codes = requested.map((r) => r.paymentModeCode);
  if (new Set(codes).size !== codes.length) {
    throw opdError(400, OpdErrorCode.PAYMENT_MODE_DUPLICATE);
  }
  const paidPaise = requested.reduce((sum, r) => sum + r.amountPaise, 0);
  if (paidPaise !== totalPaise) {
    throw opdError(400, OpdErrorCode.PAYMENT_SUM_MISMATCH, { totalPaise, paidPaise });
  }
  const plan: PaymentPlanLine[] = [];
  for (const r of requested) {
    const mode = await tx.paymentMode.findFirst({
      where: { tenantId, code: r.paymentModeCode, active: true },
    });
    if (!mode) {
      throw opdError(400, OpdErrorCode.PAYMENT_MODE_NOT_AVAILABLE);
    }
    if (mode.requiresReference && !(r.referenceNo ?? '').trim()) {
      throw opdError(400, OpdErrorCode.REFERENCE_REQUIRED);
    }
    plan.push({
      modeId: mode.id,
      modeCode: mode.code,
      amountPaise: r.amountPaise,
      referenceNo: r.referenceNo?.trim() || null,
    });
  }
  return plan;
}

/**
 * The next bill, receipt or refund number, taken on the caller's transaction (a rollback leaves no
 * gap). A hospital without series settings gets a clean 409 instead of a crash.
 */
export async function allocateBillingNumber(
  numbering: NumberSeriesService,
  tx: TenantTx,
  tenantId: string,
  series: 'BILL' | 'RECEIPT' | 'REFUND',
  now: Date,
) {
  try {
    return await numbering.allocate({ tenantId, series, tx, now });
  } catch (error) {
    if (isMissingSeriesSettings(error)) {
      throw opdError(409, OpdErrorCode.NUMBER_SERIES_NOT_CONFIGURED, { series });
    }
    throw error;
  }
}

/**
 * Replay check: does a request carry the SAME payment lines as the ones already stored for the bill
 * (order does not matter)? A single mode counts as one line of any amount; a split list must match
 * mode and amount for every line. A request without any payment fields matches anything.
 */
export async function paymentsMatchStored(
  tx: TenantTx,
  tenantId: string,
  billId: string,
  input: PaymentRequestInput,
): Promise<boolean> {
  if (input.payments === undefined && input.paymentModeCode === undefined) {
    return true;
  }
  const stored = await tx.payment.findMany({
    where: { tenantId, billId },
    select: { amountPaise: true, paymentMode: { select: { code: true } } },
  });
  const asKey = (rows: Array<{ code: string; amount?: number }>) =>
    rows
      .map((r) => `${r.code}:${r.amount ?? ''}`)
      .sort()
      .join('|');
  const storedRows = stored.map((p) => ({ code: p.paymentMode.code, amount: p.amountPaise }));
  if (input.payments !== undefined) {
    return (
      asKey(input.payments.map((p) => ({ code: p.paymentModeCode, amount: p.amountPaise }))) ===
      asKey(storedRows)
    );
  }
  return stored.length === 1 && storedRows[0]!.code === input.paymentModeCode;
}
