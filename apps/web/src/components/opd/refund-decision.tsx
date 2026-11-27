'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { opdErrorMessageFor } from '@/lib/opd/client';
import { approveRefund, rejectRefund } from '@/lib/opd/tests-client';
import type { RefundRequestView } from '@/lib/opd/tests-types';

const copy = staffCopy.opd.tests.refunds;

type Mode = 'idle' | 'approve' | 'reject';

/**
 * The Admin's decision on one request. Approving returns the money in the ORIGINAL payment modes;
 * when a mode such as UPI needs a reference number the API says which, and the screen asks for it
 * and sends the approval again. Rejecting needs a note. Nothing is decided by this screen: the API
 * checks the permission, the branch, that the asker is not the decider and that the consultation
 * has not started. A second click on the same button sends one request.
 */
export function RefundDecision({
  request,
  canDecide,
  isOwn,
}: {
  request: RefundRequestView;
  canDecide: boolean;
  /** The signed-in person asked for this request: another Admin must decide it. */
  isOwn: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [note, setNote] = useState('');
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [needed, setNeeded] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (request.status !== 'REQUESTED') {
    return null;
  }
  if (done) {
    return (
      <p role="status" className="type-small text-muted-foreground">
        {done}
      </p>
    );
  }
  if (!canDecide) {
    return null;
  }
  if (isOwn) {
    return <p className="type-small text-muted-foreground">{copy.ownRequest}</p>;
  }

  const cancel = request.type === 'CANCEL_VISIT';
  const amountText = formatPaise(request.amountPaise);
  const refsReady = needed.every((code) => (refs[code] ?? '').trim() !== '');

  async function approve() {
    if (inFlight.current || !refsReady) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const references = Object.fromEntries(
      Object.entries(refs)
        .map(([code, value]) => [code, value.trim()] as const)
        .filter(([, value]) => value !== ''),
    );
    const result = await approveRefund(request.id, {
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(Object.keys(references).length > 0 ? { references } : {}),
    });
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      const decided = result.data.request;
      setDone(
        decided.refundNumber
          ? fill(copy.doneApproved, { number: decided.refundNumber })
          : copy.doneApprovedFree,
      );
      router.refresh();
      return;
    }
    if (result.code === 'REFERENCE_REQUIRED' && result.paymentModeCode) {
      const code = result.paymentModeCode;
      setNeeded((cur) => (cur.includes(code) ? cur : [...cur, code]));
      setError(fill(copy.needReference, { mode: code }));
      return;
    }
    setError(opdErrorMessageFor(result.code));
  }

  async function reject() {
    if (inFlight.current || note.trim() === '') {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await rejectRefund(request.id, note.trim());
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      setDone(copy.doneRejected);
      router.refresh();
      return;
    }
    setError(opdErrorMessageFor(result.code));
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Button
          type="button"
          variant="success"
          className="touch-target"
          aria-label={fill(copy.approveLabel, { amount: amountText })}
          onClick={() => setMode('approve')}
        >
          {copy.approve}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="touch-target"
          aria-label={fill(copy.rejectLabel, { amount: amountText })}
          onClick={() => setMode('reject')}
        >
          {copy.reject}
        </Button>
      </div>
    );
  }

  const approving = mode === 'approve';
  return (
    <form
      className="flex flex-col gap-[var(--space-2)]"
      aria-label={approving ? copy.approveFormLabel : copy.rejectFormLabel}
      onSubmit={(e) => {
        e.preventDefault();
        void (approving ? approve() : reject());
      }}
    >
      {approving
        ? needed.map((code) => (
            <InputField
              key={code}
              label={fill(copy.referenceLabel, { mode: code })}
              autoComplete="off"
              value={refs[code] ?? ''}
              disabled={submitting}
              onChange={(e) => {
                setError(null);
                setRefs((cur) => ({ ...cur, [code]: e.target.value }));
              }}
            />
          ))
        : null}
      <InputField
        label={approving ? copy.noteLabel : copy.rejectNoteLabel}
        autoComplete="off"
        value={note}
        disabled={submitting}
        onChange={(e) => {
          setError(null);
          setNote(e.target.value);
        }}
      />
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Button
          type="submit"
          variant={approving ? 'success' : 'danger'}
          className="touch-target"
          disabled={submitting || (approving ? !refsReady : note.trim() === '')}
          aria-busy={submitting}
        >
          {submitting
            ? copy.saving
            : approving
              ? cancel && request.amountPaise === 0
                ? copy.confirmApproveFree
                : fill(copy.confirmApprove, { amount: amountText })
              : copy.confirmReject}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="touch-target"
          disabled={submitting}
          onClick={() => {
            setMode('idle');
            setError(null);
          }}
        >
          {copy.close}
        </Button>
      </div>
    </form>
  );
}
