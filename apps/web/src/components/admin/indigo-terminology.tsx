'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { getTerms, saveTerms } from '@/lib/indigo/library';

const copy = staffCopy.terms;
const KEYS = Object.keys(copy.keys);

/**
 * The words a hospital prefers for a few terms. The Owner works on any hospital, an Employee on the
 * assigned ones (the API decides). An empty box means the standard word.
 */
export function IndigoTerminology({
  hospitals,
}: {
  hospitals: Array<{ id: string; name: string }>;
}) {
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      return undefined;
    }
    let stopped = false;
    setNotice(null);
    void getTerms(hospitalId).then((result) => {
      if (!stopped && result.ok) {
        setValues(result.data.items);
      }
    });
    return () => {
      stopped = true;
    };
  }, [hospitalId]);

  async function save() {
    setBusy(true);
    const items: Record<string, string | null> = {};
    for (const key of KEYS) {
      const text = (values[key] ?? '').trim();
      items[key] = text === '' ? null : text;
    }
    const result = await saveTerms(hospitalId, items);
    setBusy(false);
    if (result.ok) {
      setValues(result.data.items);
      setNotice({ ok: true, text: copy.saved });
    } else {
      setNotice({ ok: false, text: copy.failed });
    }
  }

  return (
    <div className="section-stack content-container-inner">
      <h1 className="type-heading font-medium">{copy.consoleTitle}</h1>
      <p className="type-label text-muted-foreground">{copy.consoleHint}</p>
      <SelectField
        label={copy.chooseHospital}
        value={hospitalId}
        onChange={(event) => setHospitalId(event.target.value)}
      >
        {hospitals.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </SelectField>
      <div className="terms-grid">
        {KEYS.map((key) => (
          <InputField
            key={key}
            label={copy.keys[key]!}
            hint={fill(copy.standard, { text: copy.keys[key]! })}
            maxLength={60}
            value={values[key] ?? ''}
            disabled={busy}
            onChange={(event) =>
              setValues((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button type="button" disabled={busy || !hospitalId} onClick={() => void save()}>
          {busy ? copy.saving : copy.save}
        </Button>
        {notice ? (
          <p role={notice.ok ? 'status' : 'alert'} className="type-small">
            {notice.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
