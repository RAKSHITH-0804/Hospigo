'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodText } from '@/components/doctors/my-leave';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { SelectField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { decideLeaveRequest, listLeaveRequests } from '@/lib/leave/client';
import { leaveErrorMessage } from '@/lib/leave/errors';
import type { AdminLeaveRequest, LeaveRequestStatus } from '@/lib/leave/types';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.leave;
const paging = staffCopy.pagination;
type Flash = { kind: 'ok' | 'error'; text: string } | null;

const TONE: Record<LeaveRequestStatus, BadgeVariant> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};
const FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] as const;

/**
 * The Admin pop-up on Settings, Doctors: the leave requests of the doctors this Admin may manage,
 * waiting ones first. Approve adds the leave (same rules as Availability); Reject changes nothing
 * else. The API checks permission, branch scope, state and "not your own request".
 */
export function LeaveRequestsDialog({
  onClose,
  onPendingChange,
}: {
  onClose: () => void;
  /** Tells the page the new number of waiting requests (for the button label). */
  onPendingChange: (count: number) => void;
}) {
  const [status, setStatus] = useState<string>('PENDING');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminLeaveRequest[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState<number>(settingsScreenConfig.leaveRequestsPageSize);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (nextStatus: string, nextPage: number) => {
      setLoadError(null);
      const result = await listLeaveRequests({
        status: nextStatus,
        page: nextPage,
        pageSize: settingsScreenConfig.leaveRequestsPageSize,
      });
      if (!result.ok) {
        setLoadError(errorMessageFor(result.code) || copy.loadError);
        return;
      }
      setRows(result.data.items);
      setTotal(result.data.total);
      setPageSize(result.data.pageSize);
      onPendingChange(result.data.pendingCount);
    },
    [onPendingChange],
  );

  useEffect(() => {
    void load(status, page);
  }, [load, status, page]);

  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  async function decide(row: AdminLeaveRequest, decision: 'approve' | 'reject') {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(row.id);
    setFlash(null);
    const result = await decideLeaveRequest(row.id, decision);
    busy.current = false;
    setSaving(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: leaveErrorMessage(result) });
      // another Admin may have decided it a moment ago: show the real list
      void load(status, page);
      return;
    }
    setFlash({ kind: 'ok', text: decision === 'approve' ? copy.approved : copy.rejected });
    void load(status, page);
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const columns: DataTableColumn<AdminLeaveRequest>[] = [
    {
      id: 'doctor',
      header: copy.columns.doctor,
      cell: (r) => (
        <div className="settings-cell-name">
          <span className="type-label-strong">{r.doctor.name}</span>
          <span className="type-small text-muted-foreground">{r.doctor.code}</span>
        </div>
      ),
    },
    { id: 'days', header: copy.columns.days, cell: (r) => periodText(r.fromDate, r.toDate) },
    {
      id: 'state',
      header: copy.columns.state,
      cell: (r) => (
        <span className="cluster">
          <Badge variant={TONE[r.status]}>{copy.status[r.status] ?? r.status}</Badge>
          {r.decidedByName && r.status !== 'CANCELLED' ? (
            <span className="type-small text-muted-foreground">
              {copy.decidedBy.replace('{name}', r.decidedByName)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'actions',
      header: copy.columns.actions,
      cell: (r) =>
        r.status === 'PENDING' ? (
          <div className="cluster">
            <Button
              type="button"
              size="sm"
              disabled={saving !== null}
              aria-label={`${copy.approve}: ${r.doctor.name} ${periodText(r.fromDate, r.toDate)}`}
              onClick={() => void decide(r, 'approve')}
            >
              {copy.approve}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving !== null}
              aria-label={`${copy.reject}: ${r.doctor.name} ${periodText(r.fromDate, r.toDate)}`}
              onClick={() => void decide(r, 'reject')}
            >
              {copy.reject}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Modal title={copy.dialogTitle} onClose={onClose}>
      <div className="section-stack">
        <div className="settings-field-narrow">
          <SelectField
            label={copy.filterLabel}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
              setRows(null);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {copy.filters[f]}
              </option>
            ))}
          </SelectField>
        </div>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(status, page)}
            >
              {copy.retry}
            </Button>
          </div>
        ) : rows === null ? (
          <p className="type-label text-muted-foreground">{copy.loading}</p>
        ) : rows.length === 0 ? (
          <p className="type-label text-muted-foreground">
            {status === 'PENDING' ? copy.emptyPending : copy.empty}
          </p>
        ) : (
          <DataTable<AdminLeaveRequest>
            ariaLabel={copy.dialogTitle}
            columns={columns}
            rows={rows}
            stackOnPhone
          />
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          previousLabel={paging.previous}
          nextLabel={paging.next}
          pageOfLabel={paging.pageOf}
          totalLabel={paging.total}
          onPrevious={() => setPage((p) => Math.max(p - 1, 1))}
          onNext={() => setPage((p) => Math.min(p + 1, totalPages))}
        />
        <p className="type-small text-muted-foreground">{copy.approveNote}</p>
      </div>
    </Modal>
  );
}
