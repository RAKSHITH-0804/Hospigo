'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { formatPaise, paiseToRupeesText, parseRupeesToPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { newIdempotencyKey, opdErrorMessageFor } from '@/lib/opd/client';
import { requestCancel, requestRefund } from '@/lib/opd/tests-client';

const copy = staffCopy.opd.tests.refund;

export type RefundActionKind = 'REFUND' | 'CANCEL';

/**
 * "Request refund" (money back on one bill) or "Cancel visit" (a waiting visit, with its fee) for
 * reception. It only ASKS: an Admin decides on the Refund requests screen and nothing moves until
 * then. One idempotency key per attempt: kept while the same request is retried, dropped when the
 * amount or the reason changes, so a double click or a retry can never ask twice. The API checks
 * everything again (permission, branch, amount, "no refund once the consultation started").
 */
export function RefundRequestAction({
  kind,
  billId,
  visitId,
  billNumber,
  refundablePaise,
}: {
  kind: RefundActionKind;
  billId: string;
  visitId: string;
  billNumber: string;
  /** Paid minus already refunded, in whole paise. */
  refundablePaise: number;
}) {
  const cancel = kind === 'CANCEL';
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState(() => paiseToRupeesText(refundablePaise));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentPaise, setSentPaise] = useState<number | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const amount = parseRupeesToPaise(amountText);
  const amountOk =
    amount !== null && amount <= refundablePaise && (cancel ? amount >= 0 : amount > 0);
  const reasonOk = reason.trim() !== '';
  const label = cancel ? copy.cancelVisit : copy.requestRefund;

  async function submit() {
    if (inFlight.current || !amountOk || !reasonOk || amount === null) {
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
      : await requestRefund(billId, {
          amountPaise: amount,
          reason: reason.trim(),
          idempotencyKey: key,
        });
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      setSentPaise(result.data.request.amountPaise);
      setOpen(false);
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
          : fill(copy.sentRefund, { amount: formatPaise(sentPaise), bill: billNumber })}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-[var(--space-2)]">
      <Button
        type="button"
        variant="outline"
        className="touch-target"
        aria-expanded={open}
        aria-label={fill(copy.openLabel, { action: label, bill: billNumber })}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Button>
      {open ? (
        <form
          className="flex flex-col gap-[var(--space-2)]"
          aria-label={fill(cancel ? copy.cancelTitle : copy.refundTitle, { bill: billNumber })}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="type-small text-muted-foreground">
            {fill(copy.refundableLine, { amount: formatPaise(refundablePaise) })}
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
              onClick={() => setOpen(false)}
            >
              {copy.close}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
