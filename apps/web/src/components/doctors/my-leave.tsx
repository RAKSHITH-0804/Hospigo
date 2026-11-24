'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { opdWebConfig } from '@/config/opd';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { askForLeave, cancelMyLeaveRequest, listMyLeaveRequests } from '@/lib/leave/client';
import { leaveErrorMessage } from '@/lib/leave/errors';
import type { LeaveRequestStatus, MyLeaveRequest } from '@/lib/leave/types';
import { errorMessageFor } from '@/lib/patients/client';
import { formatDateOnly } from '@/lib/patients/format';

const copy = staffCopy.leave;
type Flash = { kind: 'ok' | 'error'; text: string } | null;

const TONE: Record<LeaveRequestStatus, BadgeVariant> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export const periodText = (from: string, to: string): string =>
  from === to ? formatDateOnly(from) : `${formatDateOnly(from)} – ${formatDateOnly(to)}`;

/**
 * "My leave" on My profile (only for a person with a doctor profile): ask for leave, see the state of
 * every request, cancel one that still waits. An Admin approves; the doctor never edits leave directly.
 */
export function MyLeave() {
  const [items, setItems] = useState<MyLeaveRequest[] | null>(null);
  const [today, setToday] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await listMyLeaveRequests();
    if (!result.ok) {
      setLoadError(errorMessageFor(result.code) || copy.loadError);
      return;
    }
    setItems(result.data.items);
    setToday(result.data.today);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  async function onAsk() {
    if (busy.current) {
      return;
    }
    if (!from || !to) {
      setFlash({ kind: 'error', text: copy.pickDates });
      return;
    }
    busy.current = true;
    setSaving('ask');
    setFlash(null);
    const result = await askForLeave(from, to);
    busy.current = false;
    setSaving(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: leaveErrorMessage(result) });
      return;
    }
    setItems((rows) => [result.data, ...(rows ?? [])]);
    setFrom('');
    setTo('');
    setFlash({ kind: 'ok', text: copy.asked });
  }

  async function onCancel(id: string) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(id);
    setFlash(null);
    const result = await cancelMyLeaveRequest(id);
    busy.current = false;
    setSaving(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: leaveErrorMessage(result) });
      // the state may have changed meanwhile (decided by an Admin): show the real one
      void load();
      return;
    }
    setItems((rows) => (rows ?? []).map((r) => (r.id === id ? result.data : r)));
    setFlash({ kind: 'ok', text: copy.cancelled });
  }

  const quickPicks = [
    { label: staffCopy.availability.today, days: 0 },
    { label: staffCopy.availability.tomorrow, days: 1 },
  ];

  return (
    <SettingBlock title={copy.mineTitle} description={copy.mineDescription}>
      <p
        role={flash?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {flash?.text ?? ''}
      </p>
      {loadError ? (
        <div className="cluster">
          <p role="alert" className="type-label text-destructive">
            {loadError}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {copy.retry}
          </Button>
        </div>
      ) : items === null ? (
        <p className="type-label text-muted-foreground">{copy.loading}</p>
      ) : (
        <>
          {today ? (
            <div className="cluster-end">
              <DatePicker
                label={copy.from}
                value={from}
                min={today}
                todayIso={today}
                weekStart={opdWebConfig.calendarWeekStart}
                quickDays={[]}
                quickPicks={quickPicks}
                onChange={(iso) => {
                  setFrom(iso);
                  if (to && to < iso) {
                    setTo(iso);
                  }
                }}
              />
              <DatePicker
                label={copy.to}
                value={to}
                min={from || today}
                todayIso={today}
                weekStart={opdWebConfig.calendarWeekStart}
                quickDays={[]}
                quickPicks={quickPicks}
                onChange={setTo}
              />
              <Button
                type="button"
                size="sm"
                disabled={saving !== null}
                onClick={() => void onAsk()}
              >
                {saving === 'ask' ? copy.asking : copy.ask}
              </Button>
            </div>
          ) : null}
          {items.length === 0 ? (
            <p className="type-label text-muted-foreground">{copy.none}</p>
          ) : (
            <ul className="section-stack">
              {items.map((r) => (
                <li key={r.id} className="cluster-between">
                  <div className="settings-cell-name">
                    <span className="type-label-strong">{periodText(r.fromDate, r.toDate)}</span>
                    <span className="type-small text-muted-foreground">
                      {copy.requestedOn.replace('{date}', formatDateOnly(r.requestedAt))}
                      {r.decidedAt
                        ? ` · ${copy.decidedOn.replace('{date}', formatDateOnly(r.decidedAt))}`
                        : ''}
                    </span>
                  </div>
                  <div className="cluster">
                    <Badge variant={TONE[r.status]}>{copy.status[r.status] ?? r.status}</Badge>
                    {r.status === 'PENDING' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving !== null}
                        aria-label={`${copy.cancel} ${periodText(r.fromDate, r.toDate)}`}
                        onClick={() => void onCancel(r.id)}
                      >
                        {saving === r.id ? copy.asking : copy.cancel}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="type-small text-muted-foreground">{copy.pendingNote}</p>
        </>
      )}
    </SettingBlock>
  );
}
