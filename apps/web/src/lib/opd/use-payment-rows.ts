'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { paiseToRupeesText } from '@/config/money';
import { planPayments, type PaymentDraft, type PaymentPlan } from './payment-plan';
import type { PaymentMode } from './types';

/**
 * The rows of the "payment" box (one row pays everything; more rows split it, for example UPI 300
 * + cash 200). A new total starts again from one row. `version` goes up on EVERY change of the
 * rows so the caller can drop its idempotency key: a changed request is never a retry.
 */
export function usePaymentRows({
  modes,
  defaultCode,
  maxLines,
  totalPaise,
}: {
  modes: PaymentMode[];
  defaultCode: string;
  maxLines: number;
  totalPaise: number;
}) {
  const nextId = useRef(1);
  const fresh = useCallback(
    (): PaymentDraft => ({
      id: nextId.current++,
      modeCode: defaultCode,
      amountText: '',
      reference: '',
    }),
    [defaultCode],
  );
  const [rows, setRows] = useState<PaymentDraft[]>(() => [
    { id: 0, modeCode: defaultCode, amountText: '', reference: '' },
  ]);
  const [version, setVersion] = useState(0);

  // A new total (a changed choice or price) starts from one payment row again.
  useEffect(() => {
    setRows([fresh()]);
    setVersion((v) => v + 1);
  }, [totalPaise, fresh]);

  const plan: PaymentPlan = planPayments(rows, modes, totalPaise);

  const change = useCallback((update: (current: PaymentDraft[]) => PaymentDraft[]) => {
    setRows(update);
    setVersion((v) => v + 1);
  }, []);

  const setMode = (id: number, code: string) =>
    change((cur) => cur.map((r) => (r.id === id ? { ...r, modeCode: code } : r)));
  const setAmount = (id: number, text: string) =>
    change((cur) => cur.map((r) => (r.id === id ? { ...r, amountText: text } : r)));
  const setReference = (id: number, text: string) =>
    change((cur) => cur.map((r) => (r.id === id ? { ...r, reference: text } : r)));

  const addRow = () =>
    change((current) => {
      const unused = modes.find((m) => !current.some((r) => r.modeCode === m.code));
      if (!unused || current.length >= maxLines || totalPaise <= 0) {
        return current;
      }
      if (current.length === 1) {
        // Becoming a split: the first row shows the whole total to be cut down.
        return [
          { ...current[0]!, amountText: paiseToRupeesText(totalPaise) },
          { ...fresh(), modeCode: unused.code },
        ];
      }
      const left = plan.remainingPaise;
      return [
        ...current,
        { ...fresh(), modeCode: unused.code, amountText: left > 0 ? paiseToRupeesText(left) : '' },
      ];
    });

  const removeRow = (id: number) =>
    change((current) => {
      const next = current.filter((r) => r.id !== id);
      // Back to one row: it pays the whole total again, no amount to type.
      return next.length === 1 ? [{ ...next[0]!, amountText: '' }] : next;
    });

  return { rows, plan, version, setMode, setAmount, setReference, addRow, removeRow };
}
