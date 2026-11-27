'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { RefundRequestAction } from '@/components/opd/refund-request-action';
import { CLINICAL_STATUS_VARIANT, ageText } from '@/components/opd/visit-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { consultPath, loadQueue, vitalsPath } from '@/lib/opd/clinical-client';
import { fill, formatClock } from '@/lib/opd/clinical-format';
import type { QueueItem, QueueResponse } from '@/lib/opd/clinical-types';
import { ABORTED_CODE } from '@/lib/patients/client';
import { EMPTY_VALUE, formatDateOnly, genderLabel } from '@/lib/patients/format';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.clinical.queue;

type Filter = 'WAITING' | 'COMPLETED' | 'ALL';

const STATUS_LABEL = {
  WAITING: copy.statusWaiting,
  IN_CONSULTATION: copy.statusInConsultation,
  COMPLETED: copy.statusCompleted,
} as const;

function matches(item: QueueItem, filter: Filter): boolean {
  if (filter === 'ALL') {
    return true;
  }
  return filter === 'COMPLETED' ? item.status === 'COMPLETED' : item.status !== 'COMPLETED';
}

/**
 * The OPD list for a doctor (own patients), a nurse or reception (the whole branch, read only):
 * who is waiting now, who is in consultation and who was completed today, with the vitals state.
 * Staff who act (doctor, nurse) start on "Waiting"; read-only staff (reception) start on "All".
 * The first list comes from the server; this keeps it fresh every few seconds (a setting) and on
 * demand. A failed refresh keeps the list on screen and says so: the screen never goes blank.
 */
export function OpdQueue({
  initial,
  refreshSeconds,
  canOpenConsultation,
  canViewNotes,
  canRecordVitals,
  canRequestCancel = false,
  allBranches = false,
}: {
  initial: QueueResponse;
  refreshSeconds: number;
  canOpenConsultation: boolean;
  canViewNotes: boolean;
  canRecordVitals: boolean;
  /** Reception may ask to cancel a waiting visit (opd.refunds.request). */
  canRequestCancel?: boolean;
  /** The combined view of every branch the person may read (Phase 2.2). */
  allBranches?: boolean;
}) {
  const [data, setData] = useState<QueueResponse>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>(
    canOpenConsultation || canRecordVitals ? 'WAITING' : 'ALL',
  );
  const [doctorId, setDoctorId] = useState('');
  const inFlight = useRef(false);
  const doctorRef = useRef('');

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    const result = await loadQueue(undefined, doctorRef.current || undefined, allBranches);
    inFlight.current = false;
    setRefreshing(false);
    if (result.ok) {
      setData(result.data);
      setUpdatedAt(new Date());
      setRefreshFailed(false);
    } else if (result.code !== ABORTED_CODE) {
      setRefreshFailed(true);
    }
  }, []);

  useEffect(() => {
    if (refreshSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [refreshSeconds, refresh]);

  function chooseDoctor(id: string) {
    doctorRef.current = id;
    setDoctorId(id);
    void refresh();
  }

  const waiting = data.items.filter((i) => i.status === 'WAITING').length;
  const inConsultation = data.items.filter((i) => i.status === 'IN_CONSULTATION').length;
  const completed = data.items.filter((i) => i.status === 'COMPLETED').length;
  const shown = data.items.filter((i) => matches(i, filter));
  const showDoctor = data.scope === 'BRANCH';

  const columns: DataTableColumn<QueueItem>[] = [
    {
      id: 'token',
      header: copy.colToken,
      cell: (v) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{v.token?.label ?? EMPTY_VALUE}</span>
          {v.visitDate !== data.date && v.status !== 'COMPLETED' ? (
            <span className="type-small text-destructive">
              {fill(copy.fromEarlier, { date: formatDateOnly(v.visitDate) })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'patient',
      header: copy.colPatient,
      cell: (v) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{v.patient.name}</span>
          <span className="type-small text-muted-foreground">
            {v.patient.uhid} · {genderLabel(v.patient.gender)} · {ageText(v.patient.ageYears)}
            {v.branchName ? ` · ${v.branchName}` : ''}
          </span>
        </div>
      ),
    },
    ...(showDoctor
      ? [{ id: 'doctor', header: copy.colDoctor, cell: (v: QueueItem) => v.doctor.name }]
      : []),
    {
      id: 'status',
      header: copy.colStatus,
      cell: (v) => (
        <div className="flex flex-col items-start gap-[var(--space-1)]">
          <Badge variant={CLINICAL_STATUS_VARIANT[v.status]}>
            {STATUS_LABEL[v.status as keyof typeof STATUS_LABEL] ?? v.status}
          </Badge>
          {v.status === 'COMPLETED' && v.completedAt ? (
            <span className="type-small text-muted-foreground">
              {fill(copy.completedAt, { time: formatClock(new Date(v.completedAt)) })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'vitals',
      header: copy.colVitals,
      cell: (v) => {
        // A finished visit without vitals is not "pending" any more: nobody recorded them.
        const missed = v.status === 'COMPLETED' && !v.vitalsRecorded;
        return (
          <Badge variant={v.vitalsRecorded ? 'success' : missed ? 'warning' : 'neutral'}>
            {v.vitalsRecorded
              ? copy.vitalsDone
              : missed
                ? copy.vitalsNotRecorded
                : copy.vitalsPending}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: (v) => {
        const done = v.status === 'COMPLETED';
        return (
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {canOpenConsultation && !done ? (
              <Link
                href={consultPath(v.id)}
                className={cn(buttonVariants({ variant: 'default' }), 'touch-target')}
              >
                {copy.open}
              </Link>
            ) : null}
            {done && canViewNotes ? (
              <Link
                href={consultPath(v.id)}
                className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
              >
                {copy.view}
              </Link>
            ) : null}
            {canRecordVitals ? (
              <Link
                href={vitalsPath(v.id)}
                className={cn(
                  buttonVariants({
                    variant: canOpenConsultation || done ? 'outline' : 'default',
                  }),
                  'touch-target',
                )}
              >
                {copy.vitals}
              </Link>
            ) : null}
            {canRequestCancel && v.status === 'WAITING' ? (
              <RefundRequestAction kind="CANCEL" visitId={v.id} onSent={() => void refresh()} />
            ) : null}
          </div>
        );
      },
    },
  ];

  const tabs: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'WAITING', label: copy.tabWaiting, count: waiting + inConsultation },
    { id: 'COMPLETED', label: copy.tabCompleted, count: completed },
    { id: 'ALL', label: copy.tabAll, count: data.items.length },
  ];

  return (
    <div className="section-stack content-container-inner">
      <PageHeader
        title={copy.title}
        description={data.scope === 'OWN' ? copy.descriptionOwn : copy.descriptionBranch}
        actions={
          <Button
            type="button"
            variant="outline"
            className="touch-target"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" className="size-[var(--size-icon-menu)]" />
            {refreshing ? copy.refreshing : copy.refresh}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
        <div
          role="group"
          aria-label={copy.filterLabel}
          className="flex flex-wrap gap-[var(--space-2)]"
        >
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={filter === tab.id ? 'default' : 'outline'}
              aria-pressed={filter === tab.id}
              className="touch-target"
              onClick={() => setFilter(tab.id)}
            >
              {tab.label} ({tab.count})
            </Button>
          ))}
        </div>
        <p className="type-small text-muted-foreground" role="status">
          {fill(copy.summary, { waiting, inConsultation, completed })} ·{' '}
          {fill(copy.updatedAt, { time: formatClock(updatedAt) })}
        </p>
      </div>
      {data.scope === 'BRANCH' && (data.doctors.length > 0 || doctorId) ? (
        <div className="cluster">
          <SelectField
            label={copy.doctorFilter}
            value={doctorId}
            narrow
            onChange={(event) => chooseDoctor(event.target.value)}
          >
            <option value="">{copy.allDoctors}</option>
            {data.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      {refreshFailed ? (
        <p role="alert" className="type-label text-destructive">
          {copy.refreshFailed}
        </p>
      ) : null}
      {shown.length === 0 ? (
        filter === 'COMPLETED' ? (
          <EmptyState
            title={copy.emptyCompletedTitle}
            description={copy.emptyCompletedDescription}
          />
        ) : (
          <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
        )
      ) : (
        <DataTable columns={columns} rows={shown} ariaLabel={copy.title} stackOnPhone />
      )}
    </div>
  );
}
