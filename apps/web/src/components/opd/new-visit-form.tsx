'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PaymentLines } from '@/components/opd/payment-lines';
import { EmptyState } from '@/components/states/empty-state';
import { formatPaise, paiseToRupeesText } from '@/config/money';
import { TextareaField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import {
  createVisit,
  newIdempotencyKey,
  opdErrorMessageFor,
  previewVisit,
  visitReceiptPath,
} from '@/lib/opd/client';
import { planPayments, type PaymentDraft } from '@/lib/opd/payment-plan';
import type {
  OpdDoctor,
  PaymentModesResponse,
  PreviewLine,
  VisitPreview,
  VisitType,
} from '@/lib/opd/types';
import { ABORTED_CODE } from '@/lib/patients/client';
import { EMPTY_VALUE } from '@/lib/patients/format';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.newVisit;

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: VisitPreview }
  | { status: 'error'; message: string };

function lineLabel(line: PreviewLine): string {
  switch (line.kind) {
    case 'REGISTRATION':
      return copy.lineRegistration;
    case 'INVESTIGATION':
      return copy.lineInvestigation;
    default:
      return `${copy.lineConsultation} · ${line.description}`;
  }
}

function feeFor(doctor: OpdDoctor, type: VisitType): string {
  const paise = type === 'NEW' ? doctor.feeNewPaise : doctor.feeFollowUpPaise;
  return paise === null ? EMPTY_VALUE : formatPaise(paise);
}

/**
 * Reception: create a visit for one patient, bill it and take payment, in one step.
 * The amount always comes from the server (preview); the click sends the total that was shown
 * and the server refuses if it changed. One idempotency key per attempt: kept while the same
 * choice is retried, replaced when the choice (or the total) changes, so a double click or a
 * retry after a network error can never bill twice. The payment box can split the total over
 * several modes (UPI 300 + cash 200): one receipt, and any change to the rows is a new choice.
 */
export function NewVisitForm({
  patient,
  doctors,
  paymentModes,
}: {
  patient: { id: string; name: string; uhid: string };
  doctors: OpdDoctor[];
  paymentModes: Omit<PaymentModesResponse, 'defaultCode'> & { defaultCode: string };
}) {
  const router = useRouter();
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [visitType, setVisitType] = useState<VisitType>('NEW');
  const [symptoms, setSymptoms] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [reloadTick, setReloadTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const nextRowId = useRef(1);
  const freshRow = useCallback(
    (): PaymentDraft => ({
      id: nextRowId.current++,
      modeCode: paymentModes.defaultCode,
      amountText: '',
      reference: '',
    }),
    [paymentModes.defaultCode],
  );
  const [rows, setRows] = useState<PaymentDraft[]>(() => [
    { id: 0, modeCode: paymentModes.defaultCode, amountText: '', reference: '' },
  ]);

  // Price preview for the current choice. A new choice always means a new key.
  useEffect(() => {
    keyRef.current = null;
    setSubmitError(null);
    // A new choice (or a new total) starts from one payment row again.
    setRows([freshRow()]);
    if (!doctorId) {
      setPreview({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setPreview({ status: 'loading' });
    void previewVisit(
      { patientId: patient.id, doctorProfileId: doctorId, visitType },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.code === ABORTED_CODE)) {
        return;
      }
      setPreview(
        result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', message: opdErrorMessageFor(result.code) },
      );
    });
    return () => controller.abort();
  }, [patient.id, doctorId, visitType, reloadTick, freshRow]);

  /** Every change of the payment rows is a new request: it gets a new idempotency key. */
  function changeRows(update: (current: PaymentDraft[]) => PaymentDraft[]) {
    keyRef.current = null;
    setSubmitError(null);
    setRows(update);
  }

  function addRow() {
    changeRows((current) => {
      const unused = paymentModes.items.find((m) => !current.some((r) => r.modeCode === m.code));
      if (!unused || current.length >= paymentModes.maxLines || !ready) {
        return current;
      }
      if (current.length === 1) {
        // Becoming a split: the first row shows the whole total to be cut down.
        return [
          { ...current[0]!, amountText: paiseToRupeesText(ready.totalPaise) },
          { ...freshRow(), modeCode: unused.code },
        ];
      }
      const left = plan.remainingPaise;
      return [
        ...current,
        {
          ...freshRow(),
          modeCode: unused.code,
          amountText: left > 0 ? paiseToRupeesText(left) : '',
        },
      ];
    });
  }

  function removeRow(id: number) {
    changeRows((current) => {
      const next = current.filter((r) => r.id !== id);
      // Back to one row: it pays the whole total again, no amount to type.
      return next.length === 1 ? [{ ...next[0]!, amountText: '' }] : next;
    });
  }

  async function submit() {
    if (preview.status !== 'ready' || !doctorId || inFlightRef.current) {
      return;
    }
    if (preview.data.totalPaise > 0 && !plan.ok) {
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const key = keyRef.current ?? (keyRef.current = newIdempotencyKey());
    const result = await createVisit({
      patientId: patient.id,
      doctorProfileId: doctorId,
      visitType,
      idempotencyKey: key,
      expectedTotalPaise: preview.data.totalPaise,
      ...(symptoms.trim() ? { receptionSymptoms: symptoms.trim() } : {}),
      // A free visit sends no payment at all (the API refuses a list for it).
      ...(preview.data.totalPaise > 0 ? { payments: plan.payments } : {}),
    });
    if (result.ok) {
      router.push(visitReceiptPath(result.data.id));
      return; // stay locked: the receipt page replaces this screen
    }
    if (result.code === 'PRICE_CHANGED') {
      // Nothing was charged. Show the new total before anything is collected.
      keyRef.current = null;
      setReloadTick((tick) => tick + 1);
    }
    setSubmitError(opdErrorMessageFor(result.code));
    inFlightRef.current = false;
    setSubmitting(false);
  }

  const patientPath = `/app/patients/${encodeURIComponent(patient.id)}`;
  const ready = preview.status === 'ready' ? preview.data : null;
  const plan = planPayments(rows, paymentModes.items, ready?.totalPaise ?? 0);
  const cashOnly = rows.length === 1 && rows[0]!.modeCode === paymentModes.defaultCode;
  const payLabel =
    ready === null
      ? ''
      : ready.totalPaise > 0
        ? (cashOnly ? copy.takeCash : copy.takePayment).replace(
            '{amount}',
            formatPaise(ready.totalPaise),
          )
        : copy.createFree;
  const payBlocked = ready !== null && ready.totalPaise > 0 && !plan.ok;

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <PageHeader
        title={copy.title}
        description={`${patient.name} · ${patient.uhid}`}
        backHref={patientPath}
      />

      {doctors.length === 0 ? (
        <EmptyState title={copy.noDoctors} />
      ) : (
        <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="section-heading">{copy.visitTypeHeading}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-[var(--space-3)]">
              <div
                role="radiogroup"
                aria-label={copy.visitTypeHeading}
                className="flex gap-[var(--space-3)]"
              >
                {(
                  [
                    ['NEW', copy.typeNew],
                    ['FOLLOW_UP', copy.typeFollowUp],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-[var(--space-2)] type-label">
                    <input
                      type="radio"
                      name="visit-type"
                      value={value}
                      checked={visitType === value}
                      disabled={submitting}
                      onChange={() => setVisitType(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <TextareaField
                label={staffCopy.opd.symptoms.label}
                hint={staffCopy.opd.symptoms.hint}
                placeholder={staffCopy.opd.symptoms.placeholder}
                maxLength={staffCopy.opd.symptoms.maxLength}
                value={symptoms}
                disabled={submitting}
                onChange={(event) => setSymptoms(event.target.value)}
              />

              <p className="section-heading">{copy.doctorHeading}</p>
              <div
                role="radiogroup"
                aria-label={copy.doctorHeading}
                className="flex flex-col gap-[var(--space-2)]"
              >
                {doctors.map((doctor) => {
                  const selected = doctorId === doctor.id;
                  return (
                    <label
                      key={doctor.id}
                      className={cn(
                        'flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-card)] border border-border p-[var(--space-2)]',
                        selected && 'border-ring bg-accent',
                        !doctor.available && 'opacity-60',
                      )}
                    >
                      <span className="flex items-center gap-[var(--space-2)]">
                        <input
                          type="radio"
                          name="doctor"
                          value={doctor.id}
                          checked={selected}
                          disabled={!doctor.available || submitting}
                          onChange={() => setDoctorId(doctor.id)}
                        />
                        <span>
                          <span className="type-label font-medium">{doctor.name}</span>
                          {doctor.department ? (
                            <span className="type-small block text-muted-foreground">
                              {doctor.department}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex items-center gap-[var(--space-2)]">
                        {!doctor.available ? (
                          <Badge variant="danger">{copy.doctorUnavailable}</Badge>
                        ) : doctor.outsideTimings ? (
                          <Badge variant="warning">{copy.doctorOutsideTimings}</Badge>
                        ) : null}
                        <span className="type-label">
                          {copy.feeCaption}: {feeFor(doctor, visitType)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="section-heading">{copy.billHeading}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-[var(--space-3)]">
              {preview.status === 'idle' ? (
                <p className="type-label text-muted-foreground">{copy.billEmpty}</p>
              ) : null}
              {preview.status === 'loading' ? (
                <p role="status" aria-busy="true" className="type-label text-muted-foreground">
                  {copy.billLoading}
                </p>
              ) : null}
              {preview.status === 'error' ? (
                <p role="alert" className="type-label text-destructive">
                  {preview.message}
                </p>
              ) : null}
              {ready ? (
                <>
                  <dl className="flex flex-col gap-[var(--space-2)]">
                    {ready.lines.map((line) => (
                      <div
                        key={`${line.kind}-${line.code}`}
                        className="flex justify-between gap-[var(--space-3)]"
                      >
                        <dt className="type-label">{lineLabel(line)}</dt>
                        <dd className="type-label font-medium">
                          {formatPaise(line.lineTotalPaise)}
                        </dd>
                      </div>
                    ))}
                    <div className="flex justify-between gap-[var(--space-3)] border-t border-border pt-[var(--space-2)]">
                      <dt className="type-label font-semibold">{copy.totalCaption}</dt>
                      <dd className="type-heading font-semibold">
                        {formatPaise(ready.totalPaise)}
                      </dd>
                    </div>
                  </dl>
                  {ready.followUpFree ? (
                    <p role="status" className="type-label text-muted-foreground">
                      {copy.freeFollowUp}
                    </p>
                  ) : null}
                  {ready.repeatVisitFree ? (
                    <p role="status" className="type-label text-muted-foreground">
                      {copy.freeRepeatVisit}
                    </p>
                  ) : null}
                  {ready.sameDayVisitWithDoctor ? (
                    <p role="status" className="type-label text-[var(--badge-warning-foreground)]">
                      {copy.sameDayWarning}
                    </p>
                  ) : null}
                </>
              ) : null}
              {ready && ready.totalPaise > 0 ? (
                <PaymentLines
                  modes={paymentModes.items}
                  maxLines={paymentModes.maxLines}
                  drafts={rows}
                  remainingPaise={plan.remainingPaise}
                  complete={plan.ok}
                  disabled={submitting}
                  onMode={(id, code) =>
                    changeRows((cur) =>
                      cur.map((r) => (r.id === id ? { ...r, modeCode: code } : r)),
                    )
                  }
                  onAmount={(id, text) =>
                    changeRows((cur) =>
                      cur.map((r) => (r.id === id ? { ...r, amountText: text } : r)),
                    )
                  }
                  onReference={(id, text) =>
                    changeRows((cur) =>
                      cur.map((r) => (r.id === id ? { ...r, reference: text } : r)),
                    )
                  }
                  onAdd={addRow}
                  onRemove={removeRow}
                />
              ) : null}
              {submitError ? (
                <p role="alert" className="type-label text-destructive">
                  {submitError}
                </p>
              ) : null}
              <div className="flex gap-[var(--space-2)]">
                <Button
                  type="button"
                  className="touch-target"
                  disabled={ready === null || submitting || payBlocked}
                  aria-busy={submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? copy.saving : payLabel || copy.takeCash.replace('{amount}', '')}
                </Button>
                <Link
                  href={patientPath}
                  className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
                >
                  {copy.cancel}
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
