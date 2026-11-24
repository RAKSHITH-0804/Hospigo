import Link from 'next/link';
import { RefundDecision } from '@/components/opd/refund-decision';
import { EmptyState } from '@/components/states/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import type {
  RefundListResponse,
  RefundRequestStatus,
  RefundRequestView,
} from '@/lib/opd/tests-types';
import { formatDateOnly } from '@/lib/patients/format';
import { cn } from '@/lib/utils';
import { tokenText } from '@/lib/opd/token-label';

const copy = staffCopy.opd.tests.refunds;
const tabsCopy = staffCopy.opd.tabs;

export type RefundFilter = RefundRequestStatus | 'ALL';

const STATUS_LABEL: Record<RefundRequestStatus, string> = {
  REQUESTED: copy.statusRequested,
  APPROVED: copy.statusApproved,
  REJECTED: copy.statusRejected,
};
const STATUS_VARIANT: Record<RefundRequestStatus, BadgeVariant> = {
  REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'neutral',
};

const FILTERS: Array<{ id: RefundFilter; label: string }> = [
  { id: 'REQUESTED', label: copy.tabOpen },
  { id: 'APPROVED', label: copy.tabApproved },
  { id: 'REJECTED', label: copy.tabRejected },
  { id: 'ALL', label: copy.tabAll },
];

function Decision({ request }: { request: RefundRequestView }) {
  if (request.status === 'REQUESTED') {
    return request.visit.consultationStarted && request.bill.billType === 'CONSULTATION' ? (
      <span className="type-small text-destructive">{copy.consultationStarted}</span>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span className="type-small text-muted-foreground">
        {request.decidedBy?.name ?? ''}
        {request.decidedAt ? ` · ${formatDateOnly(request.decidedAt)}` : ''}
      </span>
      {request.refundNumber ? (
        <span className="type-small">{fill(copy.voucher, { number: request.refundNumber })}</span>
      ) : null}
      {request.refunds.map((r) => (
        <span key={`${r.paymentMode.code}-${r.refundedAt}`} className="type-small">
          {fill(copy.returnedLine, {
            mode: r.paymentMode.name,
            amount: formatPaise(r.amountPaise),
          })}
        </span>
      ))}
      {request.decisionNote ? (
        <span className="type-small text-muted-foreground">
          {fill(copy.noteLine, { note: request.decisionNote })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The branch's refund and cancellation requests (server rendered; filters and pages are plain
 * links). Reception sees them read-only; only staff with the approve permission get the buttons,
 * and not on a request they asked for themselves.
 */
export function RefundRequestsList({
  data,
  filter,
  hrefFor,
  canDecide,
  currentUserId,
}: {
  data: RefundListResponse;
  filter: RefundFilter;
  hrefFor: (filter: RefundFilter, page: number) => string;
  canDecide: boolean;
  currentUserId: string | null;
}) {
  const columns: DataTableColumn<RefundRequestView>[] = [
    { id: 'when', header: copy.colRequested, cell: (r) => formatDateOnly(r.requestedAt) },
    {
      id: 'patient',
      header: copy.colPatient,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{r.visit.patient.name}</span>
          <span className="type-small text-muted-foreground">
            {r.visit.patient.uhid}
            {r.visit.token ? ` · ${tokenText(r.visit.token, r.visit.status)}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'bill',
      header: copy.colBill,
      cell: (r) => (
        <div className="flex flex-col">
          <span>{r.bill.billNumber}</span>
          <span className="type-small text-muted-foreground">
            {r.type === 'CANCEL_VISIT' ? copy.typeCancel : copy.typeRefund}
          </span>
        </div>
      ),
    },
    {
      id: 'amount',
      header: copy.colAmount,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{formatPaise(r.amountPaise)}</span>
          <span className="type-small text-muted-foreground">
            {fill(copy.refundableLine, { amount: formatPaise(r.bill.refundablePaise) })}
          </span>
        </div>
      ),
    },
    { id: 'reason', header: copy.colReason, cell: (r) => r.reason },
    { id: 'by', header: copy.colAskedBy, cell: (r) => r.requestedBy.name },
    {
      id: 'status',
      header: copy.colStatus,
      cell: (r) => <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      id: 'decision',
      header: copy.colDecision,
      cell: (r) => (
        <div className="flex flex-col gap-[var(--space-2)]">
          <Decision request={r} />
          <RefundDecision
            request={r}
            canDecide={canDecide}
            isOwn={currentUserId !== null && r.requestedBy.id === currentUserId}
          />
        </div>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const linkClass = cn(buttonVariants({ variant: 'outline' }), 'touch-target');

  return (
    <div className="section-stack content-container-inner">
      <PageHeader
        title={copy.title}
        description={canDecide ? copy.descriptionDecide : copy.descriptionRead}
      />
      <nav aria-label={copy.filterLabel} className="flex flex-wrap gap-[var(--space-2)]">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={hrefFor(f.id, 1)}
            aria-current={filter === f.id ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: filter === f.id ? 'default' : 'outline' }),
              'touch-target',
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : (
        <>
          <DataTable columns={columns} rows={data.items} ariaLabel={copy.title} />
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <p className="type-small text-muted-foreground">
              {fill(tabsCopy.pageOf, { page: data.page, totalPages })}
              <span className="mx-[var(--space-2)]">·</span>
              {fill(tabsCopy.totalLabel, { total: data.total })}
            </p>
            <div className="flex gap-[var(--space-2)]">
              {data.page > 1 ? (
                <Link href={hrefFor(filter, data.page - 1)} className={linkClass} rel="prev">
                  {tabsCopy.previous}
                </Link>
              ) : null}
              {data.page < totalPages ? (
                <Link href={hrefFor(filter, data.page + 1)} className={linkClass} rel="next">
                  {tabsCopy.next}
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
