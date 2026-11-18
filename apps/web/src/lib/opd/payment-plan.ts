import { parseRupeesToPaise } from '@/config/money';
import type { PaymentLinePayload, PaymentMode } from './types';

/** One row of the "payment" box on the new-visit screen (what the receptionist typed). */
export type PaymentDraft = {
  id: number;
  modeCode: string;
  /** Rupees as typed ("300" or "300.50"); only used when there are two or more rows. */
  amountText: string;
  reference: string;
};

export type PaymentPlan = {
  /** True only when the rows can be sent as they are (the API checks everything again). */
  ok: boolean;
  /** The lines to send; empty unless ok. */
  payments: PaymentLinePayload[];
  /** total minus the rows entered, in paise: above 0 = still to collect, below 0 = too much. */
  remainingPaise: number;
};

/**
 * Turns the rows into payment lines. One row always pays the whole total (no amount to type).
 * Two or more rows must each have a valid amount above zero, use different modes, carry a
 * reference where the mode needs one, and add up EXACTLY to the total. All arithmetic is
 * integer paise.
 */
export function planPayments(
  drafts: PaymentDraft[],
  modes: PaymentMode[],
  totalPaise: number,
): PaymentPlan {
  const single = drafts.length === 1;
  const modeByCode = new Map(modes.map((m) => [m.code, m]));
  const seen = new Set<string>();
  const payments: PaymentLinePayload[] = [];
  let ok = drafts.length > 0 && totalPaise > 0;
  let entered = 0;

  for (const draft of drafts) {
    const mode = modeByCode.get(draft.modeCode);
    const amount = single ? totalPaise : parseRupeesToPaise(draft.amountText);
    const reference = draft.reference.trim();
    if (!mode || seen.has(draft.modeCode) || amount === null || amount <= 0) {
      ok = false;
    }
    if (mode?.requiresReference && reference === '') {
      ok = false;
    }
    seen.add(draft.modeCode);
    if (amount !== null) {
      entered += amount;
    }
    payments.push({
      paymentModeCode: draft.modeCode,
      amountPaise: amount ?? 0,
      ...(reference ? { referenceNo: reference } : {}),
    });
  }

  const remainingPaise = totalPaise - entered;
  if (remainingPaise !== 0) {
    ok = false;
  }
  return { ok, payments: ok ? payments : [], remainingPaise };
}
