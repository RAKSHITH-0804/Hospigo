import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
};

function FieldShell({ label, hint, error, htmlFor, children }: FieldShellProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <label htmlFor={htmlFor} className="type-label font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="type-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="type-small text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-[var(--size-touch)] w-full rounded-[var(--radius-control)] border border-[var(--input-border)] bg-card px-[var(--space-3)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
      />
    </FieldShell>
  );
});

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, id, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-[var(--size-touch)] w-full rounded-[var(--radius-control)] border border-[var(--input-border)] bg-card px-[var(--space-3)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});
