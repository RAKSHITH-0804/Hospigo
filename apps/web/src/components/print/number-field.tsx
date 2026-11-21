'use client';

import { useEffect, useState } from 'react';
import { InputField } from '@/components/ui/field';

/**
 * A millimetre or point value. While typing, the text is kept as typed ("12." is fine) and a value is
 * passed on only when it reads as a number; the box follows the value again when the value is changed
 * from somewhere else (a drag on the page, undo). With `keepUnreadable` an empty or unreadable text is
 * passed on as NaN so the API can refuse it (used by the page settings).
 */
export function NumberField({
  label,
  value,
  onChange,
  keepUnreadable,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  keepUnreadable?: boolean;
  disabled?: boolean;
}) {
  const show = (n: number | null) => (n === null || Number.isNaN(n) ? '' : String(n));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : show(value)));
  }, [value]);
  return (
    <InputField
      label={label}
      type="number"
      inputMode="decimal"
      step="0.1"
      value={text}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = raw.trim() === '' ? Number.NaN : Number(raw);
        if (Number.isFinite(parsed)) {
          onChange(parsed);
        } else if (keepUnreadable) {
          onChange(Number.NaN);
        }
      }}
    />
  );
}
