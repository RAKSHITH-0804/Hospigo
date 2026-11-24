'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { formatPaise, paiseToRupeesText, parseRupeesToPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { loadVisit, newIdempotencyKey, opdErrorMessageFor } from '@/lib/opd/client';
import { requestCancel, requestRefund } from '@/lib/opd/tests-client';

const copy = staffCopy.opd.tests.refund;

export type RefundActionKind = 'REFUND' | 'CANCEL';

type BillFacts = {
  billId: string;
  billNumber: string;
  refundablePaise: number;
};

/**
 * "Request refund" (money back on one bill) or "Cancel visit" (a waiting visit, with its fee) for
 * reception. It only ASKS: an Admin decides on the Refund requests screen and nothing moves until
 * then. One idempotency key per attempt: kept while the same request is retried, dropped when the
 * amount or the reason changes, so a double click or a retry can never ask twice. The form opens in
 * a Modal so a table row never changes height. Cancel from the queue may omit the bill facts: the
 * visit is loaded when the dialog opens. The API checks everything again.
 */
export function RefundRequestAction({
  kind,
  visitId,
  billId,
  billNumber,
  refundablePaise,
  onSent,
}: {
  kind: RefundActionKind;
  visitId: string;
  /** Required for REFUND. Optional for CANCEL: loaded from the visit when omitted. */
  billId?: string;
  billNumber?: string;
  refundablePaise?: number;
  /** Called after a request is accepted (for example to refresh the queue). */
  onSent?: () => void;
}) {
  const cancel = kind === 'CANCEL';
  const known: BillFacts | null =
    billId !== undefined && billNumber !== undefined && refundablePaise !== undefined
      ? { billId, billNumber, refundablePaise }
      : null;
  const [open, setOpen] = useState(false);
  const [bill, setBill] = useState<BillFacts | null>(known);
  const [amountText, setAmountText] = useState(() =>
    known ? paiseToRupeesText(known.refundablePaise) : '',
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentPaise, setSentPaise] = useState<number | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const amount = parseRupeesToPaise(amountText);
  const refundable = bill?.refundablePaise ?? 0;
  const amountOk =
    bill !== null && amount !== null && amount <= refundable && (cancel ? amount >= 0 : amount > 0);
  const reasonOk = reason.trim() !== '';
  const label = cancel ? copy.cancelVisit : copy.requestRefund;
  const shownBill = bill?.billNumber ?? '';

  async function openDialog() {
    setError(null);
    if (bill) {
      setOpen(true);
      return;
    }
    if (!cancel) {
      setError(opdErrorMessageFor('UNKNOWN'));
      return;
    }
    setLoading(true);
    const result = await loadVisit(visitId);
    setLoading(false);
    if (!result.ok) {
      setError(opdErrorMessageFor(result.code));
      return;
    }
    const visitBill = result.data.bill;
    if (!visitBill) {
      setError(opdErrorMessageFor('FORBIDDEN'));
      return;
    }
    const next: BillFacts = {
      billId: visitBill.id,
      billNumber: visitBill.billNumber,
      refundablePaise: Math.max(visitBill.paidPaise - visitBill.refundedPaise, 0),
    };
    setBill(next);
    setAmountText(paiseToRupeesText(next.refundablePaise));
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
  }

  async function submit() {
    if (inFlight.current || !amountOk || !reasonOk || amount === null || !bill) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const key = keyRef.current ?? (keyRef.current = newIdempotencyKey());
    const result = cancel
      ? await requestCancel(visitId, {
          reason: reason.trim(),
          idempotencyKey: key,
          amountPaise: amount,
        })
      : await requestRefund(bill.billId, {
          amountPaise: amount,
          reason: reason.trim(),
          idempotencyKey: key,
        });
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      setSentPaise(result.data.request.amountPaise);
      setOpen(false);
      onSent?.();
      return;
    }
    setError(
      result.code === 'REFUND_EXCEEDS_REFUNDABLE' &&
        result.refundablePaise !== undefined &&
        result.pendingPaise !== undefined
        ? fill(copy.exceeds, {
            refundable: formatPaise(result.refundablePaise),
            pending: formatPaise(result.pendingPaise),
          })
        : opdErrorMessageFor(result.code),
    );
  }

  if (sentPaise !== null) {
    return (
      <p role="status" className="type-small text-muted-foreground">
        {cancel
          ? copy.sentCancel
          : fill(copy.sentRefund, {
              amount: formatPaise(sentPaise),
              bill: shownBill || billNumber || '',
            })}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-[var(--space-2)]">
      <Button
        type="button"
        variant="outline"
        className="touch-target"
        aria-haspopup="dialog"
        aria-label={
          shownBill || billNumber
            ? fill(copy.openLabel, { action: label, bill: shownBill || billNumber || '' })
            : label
        }
        disabled={loading}
        onClick={() => void openDialog()}
      >
        {label}
      </Button>
      {error && !open ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      {open && bill ? (
        <Modal
          narrow
          title={fill(cancel ? copy.cancelTitle : copy.refundTitle, { bill: bill.billNumber })}
          onClose={closeDialog}
        >
          <form
            className="flex flex-col gap-[var(--space-2)]"
            aria-label={fill(cancel ? copy.cancelTitle : copy.refundTitle, {
              bill: bill.billNumber,
            })}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="type-small text-muted-foreground">
              {fill(copy.refundableLine, { amount: formatPaise(bill.refundablePaise) })}
              {cancel ? ` ${copy.cancelAmountHint}` : ''}
            </p>
            <InputField
              label={copy.amountLabel}
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              disabled={submitting}
              error={
                amountText !== '' && !amountOk
                  ? cancel
                    ? copy.cancelAmountInvalid
                    : copy.amountInvalid
                  : undefined
              }
              onChange={(e) => {
                keyRef.current = null;
                setError(null);
                setAmountText(e.target.value);
              }}
            />
            <InputField
              label={copy.reasonLabel}
              autoComplete="off"
              value={reason}
              disabled={submitting}
              onChange={(e) => {
                keyRef.current = null;
                setError(null);
                setReason(e.target.value);
              }}
            />
            {error ? (
              <p role="alert" className="type-label text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex gap-[var(--space-2)]">
              <Button
                type="submit"
                className="touch-target"
                disabled={submitting || !amountOk || !reasonOk}
                aria-busy={submitting}
              >
                {submitting ? copy.sending : copy.send}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                disabled={submitting}
                onClick={closeDialog}
              >
                {copy.close}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
