'use client';

import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { PaymentDraft } from '@/lib/opd/payment-plan';
import type { PaymentMode } from '@/lib/opd/types';

const copy = staffCopy.opd.newVisit;

/**
 * The "payment" box: one row pays the whole total with one mode; "Add payment mode" turns it
 * into a split (for example UPI 300 + cash 200) that must add up exactly to the total. All
 * rows share ONE receipt. The screen only helps: the API and the database check the sum again.
 */
export function PaymentLines({
  modes,
  maxLines,
  drafts,
  remainingPaise,
  complete,
  disabled,
  onMode,
  onAmount,
  onReference,
  onAdd,
  onRemove,
}: {
  modes: PaymentMode[];
  maxLines: number;
  drafts: PaymentDraft[];
  remainingPaise: number;
  /** True when the rows can be sent as they are. */
  complete: boolean;
  disabled: boolean;
  onMode: (id: number, code: string) => void;
  onAmount: (id: number, text: string) => void;
  onReference: (id: number, text: string) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  const split = drafts.length > 1;
  const canAdd = drafts.length < maxLines && drafts.length < modes.length;
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-[var(--space-2)]">
      <legend className="section-heading">{copy.paymentHeading}</legend>
      {drafts.map((draft, index) => {
        const mode = modes.find((m) => m.code === draft.modeCode);
        const n = index + 1;
        return (
          <div key={draft.id} className="flex flex-wrap items-start gap-[var(--space-2)]">
            <SelectField
              label={`${copy.paymentModeLabel} ${n}`}
              value={draft.modeCode}
              onChange={(e) => onMode(draft.id, e.target.value)}
            >
              {modes.map((m) => (
                <option
                  key={m.code}
                  value={m.code}
                  disabled={m.code !== draft.modeCode && drafts.some((d) => d.modeCode === m.code)}
                >
                  {m.name}
                </option>
              ))}
            </SelectField>
            {split ? (
              <InputField
                label={`${copy.paymentAmountLabel} ${n}`}
                inputMode="decimal"
                autoComplete="off"
                value={draft.amountText}
                onChange={(e) => onAmount(draft.id, e.target.value)}
              />
            ) : null}
            {mode?.requiresReference ? (
              <InputField
                label={`${copy.paymentReferenceLabel} ${n}`}
                autoComplete="off"
                value={draft.reference}
                onChange={(e) => onReference(draft.id, e.target.value)}
              />
            ) : null}
            {split ? (
              <Button
                type="button"
                variant="outline"
                aria-label={`${copy.removePayment} ${n}`}
                onClick={() => onRemove(draft.id)}
              >
                {copy.removePayment}
              </Button>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        {canAdd ? (
          <Button type="button" variant="outline" onClick={onAdd}>
            {copy.addPayment}
          </Button>
        ) : null}
        {split ? (
          <p
            role="status"
            className={
              remainingPaise === 0
                ? 'type-label text-muted-foreground'
                : remainingPaise > 0
                  ? 'type-label'
                  : 'type-label text-destructive'
            }
          >
            {remainingPaise === 0
              ? complete
                ? copy.paymentCovered
                : copy.paymentIncomplete
              : remainingPaise > 0
                ? copy.paymentRemaining.replace('{amount}', formatPaise(remainingPaise))
                : copy.paymentOver.replace('{amount}', formatPaise(-remainingPaise))}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
