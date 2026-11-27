'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fieldControlClass } from '@/components/ui/field';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import {
  addDays,
  isWithin,
  localTodayIso,
  monthGrid,
  parseIsoDay,
  shiftMonth,
  weekdayOrder,
} from '@/lib/dates/calendar';
import { cn } from '@/lib/utils';

const copy = staffCopy.calendar;
const SUNDAY_2026_11_01 = Date.UTC(2026, 10, 1);

function format(iso: string, options: Intl.DateTimeFormatOptions, locale: string): string {
  const date = parseIsoDay(iso);
  return date ? new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date) : '';
}

/**
 * A calendar to pick one day: month grid with previous/next, today marked, quick picks (tomorrow,
 * in 3 days, ...), clear. Days outside min/max cannot be picked. The value is "YYYY-MM-DD" or ""
 * (never a time). Closes with Escape, a click outside, or after a pick.
 */
export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  weekStart,
  quickDays,
  quickPicks,
  todayIso,
  disabled,
  jump = false,
  hideLabel = false,
  locale = patientsWebConfig.dateLocale,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  weekStart: number;
  quickDays: readonly number[];
  /** Quick picks with their own words, in days from today (0 today, -1 yesterday). They replace `quickDays`. */
  quickPicks?: ReadonlyArray<{ label: string; days: number }>;
  /** Today as the hospital counts it (a time zone may differ from the browser's). */
  todayIso?: string;
  disabled?: boolean;
  /** Month and year dropdowns in the header (for a birth date: 1962 is two clicks away). */
  jump?: boolean;
  hideLabel?: boolean;
  locale?: string;
}) {
  const fieldId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const today = useMemo(() => todayIso ?? localTodayIso(), [open, todayIso]);
  const startDay = parseIsoDay(value) ?? parseIsoDay(min ?? today) ?? parseIsoDay(today)!;
  const [view, setView] = useState({
    year: startDay.getUTCFullYear(),
    month0: startDay.getUTCMonth(),
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const base = parseIsoDay(value) ?? parseIsoDay(min && min > today ? min : today)!;
      setView({ year: base.getUTCFullYear(), month0: base.getUTCMonth() });
    }
    setOpen((o) => !o);
  }

  function pick(iso: string) {
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const cells = monthGrid(view.year, view.month0, weekStart);
  const monthTitle = format(
    `${view.year}-${String(view.month0 + 1).padStart(2, '0')}-01`,
    { month: 'long', year: 'numeric' },
    locale,
  );
  const weekdays = weekdayOrder(weekStart);
  const shown = value
    ? format(value, { day: '2-digit', month: 'short', year: 'numeric' }, locale)
    : copy.placeholder;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-[var(--space-1)]">
      <label htmlFor={fieldId} className={hideLabel ? 'sr-only' : 'type-label'}>
        {label}
      </label>
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          fieldControlClass,
          'border-[var(--input-border)] text-left',
          value ? '' : 'text-muted-foreground',
        )}
      >
        {shown}
      </button>
      {open ? (
        <div role="dialog" aria-label={copy.dialogTitle} className="calendar-popover">
          <div className="flex items-center justify-between gap-[var(--space-2)]">
            <Button
              type="button"
              variant="outline"
              aria-label={copy.previousMonth}
              onClick={() => setView((v) => shiftMonth(v.year, v.month0, -1))}
            >
              <ChevronLeft aria-hidden="true" className="size-[var(--size-icon-menu)]" />
            </Button>
            {jump ? (
              <div className="flex items-center gap-[var(--space-1)]">
                <select
                  aria-label={copy.monthSelect}
                  className="calendar-select"
                  value={view.month0}
                  onChange={(e) => setView((v) => ({ ...v, month0: Number(e.target.value) }))}
                >
                  {Array.from({ length: 12 }, (_, m) => (
                    <option key={m} value={m}>
                      {new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
                        new Date(Date.UTC(2026, m, 1)),
                      )}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={copy.yearSelect}
                  className="calendar-select"
                  value={view.year}
                  onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
                >
                  {Array.from(
                    {
                      length:
                        (parseIsoDay(max ?? today)?.getUTCFullYear() ?? view.year) -
                        (parseIsoDay(min ?? '')?.getUTCFullYear() ??
                          (parseIsoDay(max ?? today)?.getUTCFullYear() ?? view.year) -
                            patientsWebConfig.ageMax) +
                        1,
                    },
                    (_, i) => (parseIsoDay(max ?? today)?.getUTCFullYear() ?? view.year) - i,
                  ).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p role="status" className="type-label-strong">
                {monthTitle}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              aria-label={copy.nextMonth}
              onClick={() => setView((v) => shiftMonth(v.year, v.month0, 1))}
            >
              <ChevronRight aria-hidden="true" className="size-[var(--size-icon-menu)]" />
            </Button>
          </div>
          <table className="calendar-table">
            <thead>
              <tr>
                {weekdays.map((w) => (
                  <th key={w} scope="col" className="calendar-weekday">
                    {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
                      new Date(SUNDAY_2026_11_01 + w * 86_400_000),
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, week) => (
                <tr key={week}>
                  {cells.slice(week * 7, week * 7 + 7).map((cell) => (
                    <td key={cell.iso}>
                      <button
                        type="button"
                        className={cn(
                          'calendar-day',
                          cell.inMonth ? '' : 'calendar-day-outside',
                          cell.iso === today ? 'calendar-day-today' : '',
                        )}
                        aria-label={format(
                          cell.iso,
                          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
                          locale,
                        )}
                        aria-pressed={cell.iso === value}
                        disabled={!isWithin(cell.iso, min, max)}
                        onClick={() => pick(cell.iso)}
                      >
                        {cell.day}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div
            role="group"
            aria-label={copy.quickHeading}
            className="flex flex-wrap gap-[var(--space-1)]"
          >
            {(
              quickPicks ??
              quickDays.map((days) => ({
                days,
                label:
                  days === 1 ? copy.quickTomorrow : copy.quickDays.replace('{n}', String(days)),
              }))
            ).map(({ days, label }) => {
              const iso = addDays(today, days);
              return (
                <Button
                  key={`${days}-${label}`}
                  type="button"
                  variant="outline"
                  disabled={!isWithin(iso, min, max)}
                  onClick={() => pick(iso)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <div className="flex justify-between gap-[var(--space-2)]">
            <Button
              type="button"
              variant="outline"
              disabled={value === ''}
              onClick={() => pick('')}
            >
              {copy.clear}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {copy.close}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
