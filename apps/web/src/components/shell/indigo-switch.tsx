'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.admin.switchHospital;

type Row = { id: string; name: string };

/**
 * For an Indigo person already inside a hospital: pick another hospital and go there at once, without
 * signing out. The API issues a new token for it through the ordinary entry (audited like an entry)
 * and the old session ends; the list is only what this person may enter.
 */
export function IndigoSwitch({
  currentName,
  navigate = (url: string) => window.location.assign(url),
}: {
  currentName: string;
  /** Where to go after the switch (the browser's own navigation unless a test gives one). */
  navigate?: (url: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stopped = false;
    void fetch('/api/staff/indigo-hospitals', { cache: 'no-store' })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { items: Row[] }) : null,
      )
      .then((data) => {
        if (!stopped && data) {
          setRows(data.items);
          setPicked(data.items.find((r) => r.name !== currentName)?.id ?? '');
        }
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [currentName]);

  async function go() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/auth/indigo-enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalId: picked }),
      });
      if (response.ok) {
        navigate(sessionConfig.homeHospital);
        return;
      }
      setError(true);
    } catch {
      setError(true);
    }
    setBusy(false);
  }

  if (rows.length < 2) {
    return null;
  }
  return (
    <div className="flex items-end gap-[var(--space-2)]">
      <SelectField
        label={copy.label}
        hideLabel
        narrow
        value={picked}
        disabled={busy}
        onChange={(event) => setPicked(event.target.value)}
      >
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      <Button
        type="button"
        variant="outline"
        disabled={busy || picked === ''}
        onClick={() => void go()}
      >
        {copy.button}
      </Button>
      {error ? (
        <span role="alert" className="type-small text-destructive">
          {copy.failed}
        </span>
      ) : null}
    </div>
  );
}
