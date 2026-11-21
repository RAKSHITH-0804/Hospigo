'use client';

import { Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { SelectField } from '@/components/ui/field';
import { ActionMenu, type MenuAction } from '@/components/ui/menu';
import { staffCopy } from '@/config/staff-copy';
import {
  ALL_BRANCHES,
  activeFilterCount,
  reportFileHref,
  reportHref,
  type FilterKey,
  type ReportQuery,
} from '@/lib/opd/reports';
import type { ReportFilterOptions } from '@/lib/opd/reports-types';

const copy = staffCopy.opd.reports;

/**
 * The controls above the report: the day (a calendar with Today and Yesterday inside it), the
 * branch (branch names, "All branches" last), one dropdown for each of doctor, payment mode,
 * department, bill type and test, and ONE Print menu (print, save as PDF, CSV, Excel). Every
 * choice opens the report again at once. The lists are the hospital's own, from the API: nothing
 * here is a fixed list of names.
 */
export function ReportToolbar({
  query,
  options,
  today,
  weekStart,
}: {
  query: ReportQuery;
  options: ReportFilterOptions;
  /** Today as the hospital counts it. */
  today: string;
  weekStart: number;
}) {
  const router = useRouter();
  const go = (next: ReportQuery) => router.push(reportHref(next));
  const setFilter = (key: FilterKey, value: string) => {
    const filters = { ...query.filters };
    if (value) {
      filters[key] = value;
    } else {
      delete filters[key];
    }
    go({ ...query, filters });
  };

  const branchValue = query.branch ?? options.activeBranchId;
  const selects: Array<{
    key: FilterKey;
    label: string;
    all: string;
    choices: Array<{ value: string; label: string }>;
  }> = [
    {
      key: 'doctor',
      label: copy.doctorLabel,
      all: copy.allDoctors,
      choices: options.doctors.map((d) => ({ value: d.code, label: d.name })),
    },
    {
      key: 'paymentMode',
      label: copy.modeLabel,
      all: copy.allModes,
      choices: options.paymentModes.map((m) => ({ value: m.code, label: m.name })),
    },
    {
      key: 'department',
      label: copy.departmentLabel,
      all: copy.allDepartments,
      choices: options.departments.map((d) => ({
        value: d,
        label: d === '(none)' ? copy.noDepartment : d,
      })),
    },
    {
      key: 'billType',
      label: copy.billTypeLabel,
      all: copy.allBillTypes,
      choices: options.billTypes.map((b) => ({
        value: b,
        label: b === 'CONSULTATION' ? copy.billTypeConsultation : copy.billTypeInvestigation,
      })),
    },
    {
      key: 'test',
      label: copy.testLabel,
      all: copy.allTests,
      choices: options.tests.map((t) => ({ value: t.code, label: t.name })),
    },
  ];

  const actions: MenuAction[] = [
    { id: 'print', label: copy.menuPrint, onSelect: () => window.print() },
    { id: 'pdf', label: copy.menuPdf, onSelect: () => window.print() },
    { id: 'csv', label: copy.menuCsv, href: reportFileHref('csv', query) },
    { id: 'xlsx', label: copy.menuExcel, href: reportFileHref('xlsx', query) },
  ];

  return (
    <div className="report-toolbar no-print" role="group" aria-label={copy.filtersAria}>
      <DatePicker
        label={copy.dateLabel}
        value={query.date}
        max={today}
        todayIso={today}
        weekStart={weekStart}
        quickDays={[]}
        quickPicks={[
          { label: copy.today, days: 0 },
          { label: copy.yesterday, days: -1 },
        ]}
        onChange={(date) => date && go({ ...query, date })}
      />
      <SelectField
        label={copy.branchLabel}
        value={branchValue}
        onChange={(event) => {
          const value = event.target.value;
          go({ ...query, branch: value === options.activeBranchId ? null : value });
        }}
      >
        {options.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        {options.canAllBranches ? <option value={ALL_BRANCHES}>{copy.allBranches}</option> : null}
      </SelectField>
      {selects.map((s) => (
        <SelectField
          key={s.key}
          label={s.label}
          value={query.filters[s.key] ?? ''}
          onChange={(event) => setFilter(s.key, event.target.value)}
        >
          <option value="">{s.all}</option>
          {s.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
      ))}
      <div className="report-toolbar-actions">
        {activeFilterCount(query) > 0 ? (
          <Button type="button" variant="outline" onClick={() => go({ ...query, filters: {} })}>
            {copy.clearFilters}
          </Button>
        ) : null}
        <ActionMenu
          label={copy.printMenu}
          icon={<Printer aria-hidden="true" />}
          actions={actions}
        />
      </div>
    </div>
  );
}
