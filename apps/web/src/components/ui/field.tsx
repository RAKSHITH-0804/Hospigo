import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  required?: boolean;
  /** Always reserve one line for hint/error so sibling controls do not jump. */
  reserveHintSpace?: boolean;
  hideLabel?: boolean;
  children: ReactNode;
};

function FieldShell({
  label,
  hint,
  error,
  htmlFor,
  required,
  reserveHintSpace,
  hideLabel,
  children,
}: FieldShellProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const showHint = Boolean(hint && !error);
  const showError = Boolean(error);
  const showReserve = reserveHintSpace && !showHint && !showError;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      {hideLabel ? null : (
        <label htmlFor={htmlFor} className="type-label">
          {label}
          {required ? (
            <span className="text-destructive" aria-hidden="true">
              {' '}
              {staffCopy.field.requiredMark}
            </span>
          ) : null}
        </label>
      )}
      {children}
      {showHint ? (
        <p id={hintId} className="type-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {showError ? (
        <p id={errorId} role="alert" className="type-small text-destructive">
          {error}
        </p>
      ) : null}
      {showReserve ? (
        <p className="type-small invisible select-none" aria-hidden="true">
          {'\u00a0'}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  'field-control min-h-[var(--size-input-height)] h-[var(--size-input-height)] w-full rounded-[var(--radius-control)] border bg-card px-[var(--space-2)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  reserveHintSpace?: boolean;
  hideLabel?: boolean;
  /** Non-editable prefix inside the control (e.g. +91). */
  startAdornment?: ReactNode;
  /** Narrow control for short digit fields. */
  narrow?: boolean;
};

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  {
    label,
    hint,
    error,
    required,
    reserveHintSpace,
    hideLabel,
    startAdornment,
    narrow,
    id,
    className,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const borderClass = error ? 'border-destructive' : 'border-[var(--input-border)]';
  const widthClass = narrow ? 'max-w-[var(--size-branch-select)]' : undefined;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      htmlFor={fieldId}
      required={required}
      reserveHintSpace={reserveHintSpace}
      hideLabel={hideLabel}
    >
      {startAdornment ? (
        <div
          className={cn(
            'flex h-[var(--size-input-height)] min-h-[var(--size-input-height)] w-full overflow-hidden rounded-[var(--radius-control)] border bg-card',
            borderClass,
            widthClass,
          )}
        >
          <span className="flex shrink-0 items-center border-r border-[var(--input-border)] bg-muted px-[var(--space-2)] type-label">
            {startAdornment}
          </span>
          <input
            ref={ref}
            id={fieldId}
            aria-label={hideLabel ? label : undefined}
            aria-invalid={error ? true : undefined}
            aria-required={required ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              'field-control min-h-[var(--size-input-height)] h-[var(--size-input-height)] w-full border-0 bg-transparent px-[var(--space-2)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-0',
              className,
            )}
            {...props}
          />
        </div>
      ) : (
        <input
          ref={ref}
          id={fieldId}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, borderClass, widthClass, className)}
          {...props}
        />
      )}
    </FieldShell>
  );
});

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  reserveHintSpace?: boolean;
  hideLabel?: boolean;
  narrow?: boolean;
  children: ReactNode;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    hint,
    error,
    required,
    reserveHintSpace,
    hideLabel,
    narrow,
    id,
    className,
    children,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      htmlFor={fieldId}
      required={required}
      reserveHintSpace={reserveHintSpace}
      hideLabel={hideLabel}
    >
      <select
        ref={ref}
        id={fieldId}
        aria-label={hideLabel ? label : undefined}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          controlClass,
          error ? 'border-destructive' : 'border-[var(--input-border)]',
          narrow ? 'max-w-[var(--size-branch-select)]' : undefined,
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});
