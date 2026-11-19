'use client';

import { useEffect, useRef, useState } from 'react';
import { PaymentLines } from '@/components/opd/payment-lines';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { newIdempotencyKey, opdErrorMessageFor } from '@/lib/opd/client';
import { billTests } from '@/lib/opd/tests-client';
import {
  choicesSignature,
  DEFAULT_CHOICE,
  planBilling,
  type TestChoice,
} from '@/lib/opd/tests-billing';
import type { BillTestsResponse, PendingVisit } from '@/lib/opd/tests-types';
import type { PaymentModesResponse } from '@/lib/opd/types';
import { usePaymentRows } from '@/lib/opd/use-payment-rows';

const copy = staffCopy.opd.tests.reception;
const payCopy = staffCopy.opd.newVisit;

/** Codes after which the list on screen is out of date: nothing was charged, look again. */
const RELOAD_CODES = new Set(['PRICE_CHANGED', 'ORDERS_NOT_AVAILABLE', 'VISIT_NOT_BILLABLE']);

/**
 * Billing the tests of ONE visit: the patient takes some tests (ticked, billed at the price shown)
 * and declines others (unticked, with a reason, never billed). The payment box is the same as on
 * the New visit screen. One idempotency key per attempt: kept while the same choices are retried,
 * dropped as soon as a choice, a reason, a price or a payment row changes, so a double click or a
 * retry can never bill twice. The server sends the total this screen showed back as a safety check.
 */
export function TestsBillPanel({
  visit,
  paymentModes,
  onBilled,
  onReload,
  onClose,
}: {
  visit: PendingVisit;
  paymentModes: Omit<PaymentModesResponse, 'defaultCode'> & { defaultCode: string };
  onBilled: (result: BillTestsResponse) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, TestChoice | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const plan = planBilling(visit.orders, choices);
  const pay = usePaymentRows({
    modes: paymentModes.items,
    defaultCode: paymentModes.defaultCode,
    maxLines: paymentModes.maxLines,
    totalPaise: plan.totalPaise,
  });

  // Any change of what would be sent is a new request: it gets a new key. (A message stays until
  // the receptionist acts: a reloaded price must not wipe the reason it was reloaded.)
  const signature = choicesSignature(plan);
  useEffect(() => {
    keyRef.current = null;
  }, [signature, pay.version]);

  function choose(orderId: string, patch: Partial<TestChoice>) {
    setError(null);
    setChoices((cur) => ({ ...cur, [orderId]: { ...(cur[orderId] ?? DEFAULT_CHOICE), ...patch } }));
  }

  async function submit() {
    if (inFlight.current || !plan.ok || (plan.totalPaise > 0 && !pay.plan.ok)) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const key = keyRef.current ?? (keyRef.current = newIdempotencyKey());
    const result = await billTests(visit.visitId, {
      idempotencyKey: key,
      orderIds: plan.orderIds,
      ...(plan.notTaken.length > 0 ? { notTaken: plan.notTaken } : {}),
      expectedTotalPaise: plan.totalPaise,
      // Free tests take no payment at all (the API refuses a list for them).
      ...(plan.totalPaise > 0 ? { payments: pay.plan.payments } : {}),
    });
    if (result.ok) {
      onBilled(result.data);
      return; // stay locked: the parent replaces this panel
    }
    if (RELOAD_CODES.has(result.code)) {
      // Nothing was charged. Show the list as it is now before anything is collected.
      keyRef.current = null;
      onReload();
    }
    setError(opdErrorMessageFor(result.code));
    inFlight.current = false;
    setSubmitting(false);
  }

  const cashOnly = pay.rows.length === 1 && pay.rows[0]!.modeCode === paymentModes.defaultCode;
  const payLabel =
    plan.totalPaise > 0
      ? (cashOnly ? payCopy.takeCash : payCopy.takePayment).replace(
          '{amount}',
          formatPaise(plan.totalPaise),
        )
      : copy.createFree;
  const problem =
    plan.problem === 'NONE_TAKEN'
      ? copy.noneTaken
      : plan.problem === 'REASON_MISSING'
        ? copy.reasonNeeded
        : null;
  const payBlocked = !plan.ok || (plan.totalPaise > 0 && !pay.plan.ok);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fill(copy.panelTitle, { name: visit.patient.name })}</CardTitle>
        <p className="type-small text-muted-foreground">
          {visit.patient.uhid} · {visit.doctor.name}
          {visit.token ? ` · ${visit.token}` : ''}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--space-3)]">
        <ul className="flex flex-col gap-[var(--space-2)]" aria-label={copy.testsHeading}>
          {visit.orders.map((order) => {
            const choice = choices[order.id] ?? DEFAULT_CHOICE;
            const unpriced = order.pricePaise === null;
            return (
              <li key={order.id} className="flex flex-col gap-[var(--space-1)]">
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                  <label className="flex items-center gap-[var(--space-2)]">
                    <input
                      type="checkbox"
                      checked={!unpriced && choice.taken}
                      disabled={unpriced || submitting}
                      aria-label={fill(copy.takeLabel, { name: order.name })}
                      onChange={(e) => choose(order.id, { taken: e.target.checked })}
                    />
                    <span className="type-label-strong">{order.name}</span>
                  </label>
                  {unpriced ? (
                    <span className="type-small text-destructive">{copy.priceNotSet}</span>
                  ) : (
                    <span className="type-label">{formatPaise(order.pricePaise!)}</span>
                  )}
                </div>
                {!unpriced && !choice.taken ? (
                  <InputField
                    label={fill(copy.reasonLabel, { name: order.name })}
                    value={choice.reason}
                    disabled={submitting}
                    autoComplete="off"
                    onChange={(e) => choose(order.id, { reason: e.target.value })}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="type-label-strong">
          {copy.totalCaption}: {formatPaise(plan.totalPaise)}
        </p>
        {problem ? (
          <p role="status" className="type-label text-muted-foreground">
            {problem}
          </p>
        ) : null}
        {plan.ok && plan.totalPaise > 0 ? (
          <PaymentLines
            modes={paymentModes.items}
            maxLines={paymentModes.maxLines}
            drafts={pay.rows}
            remainingPaise={pay.plan.remainingPaise}
            complete={pay.plan.ok}
            disabled={submitting}
            onMode={(id, code) => {
              setError(null);
              pay.setMode(id, code);
            }}
            onAmount={(id, text) => {
              setError(null);
              pay.setAmount(id, text);
            }}
            onReference={(id, text) => {
              setError(null);
              pay.setReference(id, text);
            }}
            onAdd={() => {
              setError(null);
              pay.addRow();
            }}
            onRemove={(id) => {
              setError(null);
              pay.removeRow(id);
            }}
          />
        ) : null}
        {error ? (
          <p role="alert" className="type-label text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-[var(--space-2)]">
          <Button
            type="button"
            className="touch-target"
            disabled={submitting || payBlocked}
            aria-busy={submitting}
            onClick={() => void submit()}
          >
            {submitting ? payCopy.saving : payLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="touch-target"
            disabled={submitting}
            onClick={onClose}
          >
            {copy.close}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
