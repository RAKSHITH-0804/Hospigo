'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { InputField, SelectField } from '@/components/ui/field';
import { opdWebConfig } from '@/config/opd';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import {
  addLeave,
  getAvailability,
  removeLeave,
  saveSwitch,
  saveTimings,
} from '@/lib/availability/client';
import { availabilityErrorMessage } from '@/lib/availability/errors';
import type { Availability, SlotBody } from '@/lib/availability/types';
import { errorMessageFor } from '@/lib/patients/client';
import { formatDateOnly } from '@/lib/patients/format';

const copy = staffCopy.availability;

type Row = { key: number; weekday: string; start: string; end: string };
type Drafts = Record<string, Row[]>;
type Flash = { kind: 'ok' | 'error'; text: string } | null;

const minutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** The same checks the API makes, so a mistake is shown before anything is sent. */
function localProblem(rows: Row[]): string | null {
  for (const row of rows) {
    if (!row.start || !row.end) {
      return copy.errors.localTime;
    }
    if (minutes(row.end) <= minutes(row.start)) {
      return copy.errors.localEndBeforeStart;
    }
  }
  for (let day = 0; day <= 6; day += 1) {
    const ofDay = rows
      .filter((r) => Number(r.weekday) === day)
      .sort((a, b) => minutes(a.start) - minutes(b.start));
    for (let i = 1; i < ofDay.length; i += 1) {
      if (minutes(ofDay[i]!.start) < minutes(ofDay[i - 1]!.end)) {
        return copy.errors.localOverlap;
      }
    }
  }
  return null;
}

/**
 * Availability of one doctor: the on/off switch, the weekly times per branch and leave periods.
 * Every change goes through the API, which checks the permission, the branch scope and every value.
 */
export function AvailabilityPanel({ doctorId }: { doctorId: string }) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string>(copy.loadError);
  const [data, setData] = useState<Availability | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const busy = useRef(false);
  const keys = useRef(0);

  const draftsOf = useCallback((next: Availability, only?: string): Drafts => {
    const out: Drafts = {};
    for (const branch of next.branches) {
      if (only && branch.id !== only) {
        continue;
      }
      out[branch.id] = next.timings
        .filter((t) => t.branchId === branch.id)
        .map((t) => ({
          key: (keys.current += 1),
          weekday: String(t.weekday),
          start: t.start,
          end: t.end,
        }));
    }
    return out;
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    const result = await getAvailability(doctorId);
    if (!result.ok) {
      setLoadError(
        result.status === 404 || result.status === 0
          ? copy.loadError
          : errorMessageFor(result.code) || copy.loadError,
      );
      setStatus('error');
      return;
    }
    setData(result.data);
    setDrafts(draftsOf(result.data));
    setStatus('ready');
  }, [doctorId, draftsOf]);

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

  async function run(
    id: string,
    call: () => ReturnType<typeof getAvailability>,
    okText: string,
    onDone?: (next: Availability) => void,
  ) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(id);
    setFlash(null);
    const result = await call();
    busy.current = false;
    setSaving(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: availabilityErrorMessage(result) });
      return;
    }
    setData(result.data);
    onDone?.(result.data);
    setFlash({ kind: 'ok', text: okText });
  }

  if (status === 'loading') {
    return (
      <p role="status" className="type-label text-muted-foreground">
        {copy.loading}
      </p>
    );
  }
  if (status === 'error' || !data) {
    return (
      <div className="cluster">
        <p role="alert" className="type-label text-destructive">
          {loadError}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const canWrite = data.canWrite;
  const setRows = (branchId: string, update: (rows: Row[]) => Row[]) =>
    setDrafts((d) => ({ ...d, [branchId]: update(d[branchId] ?? []) }));

  async function saveBranch(branchId: string) {
    const rows = drafts[branchId] ?? [];
    const problem = localProblem(rows);
    if (problem) {
      setFlash({ kind: 'error', text: problem });
      return;
    }
    const slots: SlotBody[] = rows.map((r) => ({
      weekday: Number(r.weekday),
      start: r.start,
      end: r.end,
    }));
    await run(
      `timings:${branchId}`,
      () => saveTimings(doctorId, branchId, slots),
      copy.saved,
      (next) => setDrafts((d) => ({ ...d, ...draftsOf(next, branchId) })),
    );
  }

  async function onAddLeave() {
    if (!from || !to) {
      setFlash({ kind: 'error', text: copy.pickDates });
      return;
    }
    await run(
      'leave:add',
      () => addLeave(doctorId, from, to),
      copy.leaveSaved,
      () => {
        setFrom('');
        setTo('');
      },
    );
  }

  const dateText = (iso: string) => formatDateOnly(iso);

  return (
    <div className="settings-panel">
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
      <p
        role={flash?.kind === 'error' ? 'alert' : 'status'}
        className={`type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {flash?.text ?? ''}
      </p>

      <section className="settings-part" aria-label={copy.switchTitle}>
        <p className="type-label-strong">{copy.switchTitle}</p>
        <p className="type-label">{data.availabilityOn ? copy.switchOn : copy.switchOff}</p>
        {canWrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving !== null}
            onClick={() =>
              void run('switch', () => saveSwitch(doctorId, !data.availabilityOn), copy.switchSaved)
            }
          >
            {data.availabilityOn ? copy.turnOff : copy.turnOn}
          </Button>
        ) : null}
      </section>

      <section className="settings-part" aria-label={copy.timetableTitle}>
        <p className="type-label-strong">{copy.timetableTitle}</p>
        <p className="type-small text-muted-foreground">{copy.timetableHint}</p>
        {data.branches.length === 0 ? (
          <p className="type-label text-muted-foreground">{copy.noBranches}</p>
        ) : (
          data.branches.map((branch) => {
            const rows = drafts[branch.id] ?? [];
            const editable = canWrite && branch.editable;
            return (
              <div key={branch.id} className="settings-doctor" aria-label={branch.name}>
                <p className="type-label-strong">{branch.name}</p>
                {!branch.editable ? (
                  <p className="type-small text-muted-foreground">{copy.branchReadOnly}</p>
                ) : null}
                {rows.length === 0 ? (
                  <p className="type-small text-muted-foreground">{copy.noSlots}</p>
                ) : null}
                {rows.map((row) => (
                  <div key={row.key} className="cluster">
                    <SelectField
                      label={copy.day}
                      value={row.weekday}
                      disabled={!editable || saving !== null}
                      onChange={(event) =>
                        setRows(branch.id, (list) =>
                          list.map((r) =>
                            r.key === row.key ? { ...r, weekday: event.target.value } : r,
                          ),
                        )
                      }
                    >
                      {copy.weekdays.map((name, index) => (
                        <option key={name} value={String(index)}>
                          {name}
                        </option>
                      ))}
                    </SelectField>
                    <InputField
                      label={copy.from}
                      type="time"
                      value={row.start}
                      disabled={!editable || saving !== null}
                      onChange={(event) =>
                        setRows(branch.id, (list) =>
                          list.map((r) =>
                            r.key === row.key ? { ...r, start: event.target.value } : r,
                          ),
                        )
                      }
                    />
                    <InputField
                      label={copy.to}
                      type="time"
                      value={row.end}
                      disabled={!editable || saving !== null}
                      onChange={(event) =>
                        setRows(branch.id, (list) =>
                          list.map((r) =>
                            r.key === row.key ? { ...r, end: event.target.value } : r,
                          ),
                        )
                      }
                    />
                    {editable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving !== null}
                        aria-label={`${branch.name}: ${copy.removeSlot} ${copy.weekdays[Number(row.weekday)] ?? ''} ${row.start}`}
                        onClick={() =>
                          setRows(branch.id, (list) => list.filter((r) => r.key !== row.key))
                        }
                      >
                        {copy.removeSlot}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {editable ? (
                  <div className="settings-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving !== null}
                      onClick={() =>
                        setRows(branch.id, (list) => [
                          ...list,
                          { key: (keys.current += 1), weekday: '1', start: '', end: '' },
                        ])
                      }
                    >
                      {copy.addSlot}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving !== null}
                      onClick={() => void saveBranch(branch.id)}
                    >
                      {saving === `timings:${branch.id}` ? copy.saving : copy.saveTimetable}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      <section className="settings-part" aria-label={copy.leaveTitle}>
        <p className="type-label-strong">{copy.leaveTitle}</p>
        <p className="type-small text-muted-foreground">{copy.leaveHint}</p>
        {data.leaves.length === 0 ? (
          <p className="type-label text-muted-foreground">{copy.noLeave}</p>
        ) : (
          <ul>
            {data.leaves.map((leave) => (
              <li key={leave.id} className="cluster">
                <span className="type-label">
                  {leave.fromDate === leave.toDate
                    ? dateText(leave.fromDate)
                    : `${dateText(leave.fromDate)} – ${dateText(leave.toDate)}`}
                  {leave.toDate < data.today ? ` · ${copy.ended}` : ''}
                </span>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving !== null}
                    aria-label={`${copy.removeLeave} ${dateText(leave.fromDate)}`}
                    onClick={() =>
                      void run(
                        `leave:${leave.id}`,
                        () => removeLeave(doctorId, leave.id),
                        copy.leaveRemoved,
                      )
                    }
                  >
                    {copy.removeLeave}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="cluster">
            <DatePicker
              label={copy.leaveFrom}
              value={from}
              min={data.today}
              todayIso={data.today}
              weekStart={opdWebConfig.calendarWeekStart}
              quickDays={[]}
              quickPicks={[
                { label: copy.today, days: 0 },
                { label: copy.tomorrow, days: 1 },
              ]}
              onChange={(iso) => {
                setFrom(iso);
                if (to && to < iso) {
                  setTo(iso);
                }
              }}
            />
            <DatePicker
              label={copy.leaveTo}
              value={to}
              min={from || data.today}
              todayIso={data.today}
              weekStart={opdWebConfig.calendarWeekStart}
              quickDays={[]}
              quickPicks={[
                { label: copy.today, days: 0 },
                { label: copy.tomorrow, days: 1 },
              ]}
              onChange={setTo}
            />
            <Button
              type="button"
              size="sm"
              disabled={saving !== null}
              onClick={() => void onAddLeave()}
            >
              {saving === 'leave:add' ? copy.saving : copy.addLeave}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
