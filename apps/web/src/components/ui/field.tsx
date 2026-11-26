import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { staffCopy } from '@/config/staff-copy';
import { PasswordInput } from './password-input';
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

export const fieldControlClass =
  'field-control min-h-[var(--size-input-height)] h-[var(--size-input-height)] w-full rounded-[var(--radius-control)] border bg-card px-[var(--space-2)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

function omitType<T extends { type?: string }>(p: T): Omit<T, 'type'> {
  const { type: _type, ...rest } = p;
  void _type;
  return rest;
}

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
      ) : props.type === 'password' ? (
        <PasswordInput
          ref={ref}
          id={fieldId}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          className={cn(fieldControlClass, borderClass, widthClass, className)}
          {...omitType(props)}
        />
      ) : (
        <input
          ref={ref}
          id={fieldId}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          className={cn(fieldControlClass, borderClass, widthClass, className)}
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
          fieldControlClass,
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

export type TextareaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  hideLabel?: boolean;
};

/** Multi-line text (consultation notes). Same label, hint and error rules as InputField. */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField(
    { label, hint, error, required, hideLabel, id, className, ...props },
    ref,
  ) {
    const autoId = useId();
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    const setRefs = (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };
    // Starts small and grows with the text (the CSS max height then makes it scroll).
    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) {
        return;
      }
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
    }, [props.value]);
    const fieldId = id ?? autoId;
    const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
    const borderClass = error ? 'border-destructive' : 'border-[var(--input-border)]';
    return (
      <FieldShell
        label={label}
        hint={hint}
        error={error}
        htmlFor={fieldId}
        required={required}
        hideLabel={hideLabel}
      >
        <textarea
          ref={setRefs}
          rows={1}
          id={fieldId}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'field-control textarea-grow w-full rounded-[var(--radius-control)] border bg-card p-[var(--space-2)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
            borderClass,
            className,
          )}
          {...props}
        />
      </FieldShell>
    );
  },
);
