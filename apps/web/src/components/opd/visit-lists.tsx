import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { RefundRequestAction } from '@/components/opd/refund-request-action';
import { visitReceiptPath } from '@/lib/opd/client';
import { visitTestsPath } from '@/lib/opd/tests-client';
import type { BillView, VisitListResponse, VisitsTabData, VisitView } from '@/lib/opd/types';
import { formatDateOnly } from '@/lib/patients/format';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.tabs;

const STATUS_LABEL: Record<VisitView['status'], string> = {
  AWAITING_PAYMENT: copy.statusAwaitingPayment,
  WAITING: copy.statusWaiting,
  IN_CONSULTATION: copy.statusInConsultation,
  COMPLETED: copy.statusCompleted,
  CANCELLED: copy.statusCancelled,
};

const STATUS_VARIANT: Record<VisitView['status'], BadgeVariant> = {
  AWAITING_PAYMENT: 'warning',
  WAITING: 'info',
  IN_CONSULTATION: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const PAYMENT_LABEL: Record<BillView['paymentStatus'], string> = {
  PAID: staffCopy.opd.receipt.statusPaid,
  PART_PAID: staffCopy.opd.receipt.statusPartPaid,
  UNPAID: staffCopy.opd.receipt.statusUnpaid,
};

const PAYMENT_VARIANT: Record<BillView['paymentStatus'], BadgeVariant> = {
  PAID: 'success',
  PART_PAID: 'warning',
  UNPAID: 'danger',
};

function typeLabel(type: VisitView['visitType']): string {
  return type === 'NEW' ? copy.typeNew : copy.typeFollowUp;
}

/** Previous / next as plain links, so the lists stay server-rendered. */
function Pager({ hrefFor, data }: { hrefFor: (page: number) => string; data: VisitListResponse }) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageText = copy.pageOf
    .replace('{page}', String(data.page))
    .replace('{totalPages}', String(totalPages));
  const totalText = copy.totalLabel.replace('{total}', String(data.total));
  const linkClass = cn(buttonVariants({ variant: 'outline' }), 'touch-target');
  return (
    <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
      <p className="type-small text-muted-foreground">
        {pageText}
        <span className="mx-[var(--space-2)]">·</span>
        {totalText}
      </p>
      <div className="flex gap-[var(--space-2)]">
        {data.page > 1 ? (
          <Link href={hrefFor(data.page - 1)} className={linkClass} rel="prev">
            {copy.previous}
          </Link>
        ) : null}
        {data.page < totalPages ? (
          <Link href={hrefFor(data.page + 1)} className={linkClass} rel="next">
            {copy.next}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Unavailable({ tab }: { tab: VisitsTabData }) {
  if (tab.status === 'error') {
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="type-label-strong">{copy.loadErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {tab.message}
        </p>
      </div>
    );
  }
  return <EmptyState title={copy.noAccessTitle} description={copy.noAccessDescription} />;
}

/** The patient's visits in this branch (newest first). */
export function VisitsPanel({
  tab,
  hrefFor,
  canSeeReceipt,
  canRequestRefund = false,
  canSeeTests = false,
}: {
  tab: VisitsTabData;
  hrefFor: (page: number) => string;
  /** The receipt page needs the visit and its bill (billing.read). */
  canSeeReceipt: boolean;
  /** Reception may ask an Admin to cancel a waiting visit (opd.refunds.request). */
  canRequestRefund?: boolean;
  /** Reception may open the tests of a visit (opd.investigations.bill). */
  canSeeTests?: boolean;
}) {
  if (tab.status !== 'ok') {
    return <Unavailable tab={tab} />;
  }
  if (tab.data.items.length === 0) {
    return <EmptyState title={copy.visitsEmptyTitle} description={copy.visitsEmptyDescription} />;
  }
  const columns: DataTableColumn<VisitView>[] = [
    { id: 'date', header: copy.dateCaption, cell: (v) => formatDateOnly(v.visitDate) },
    { id: 'doctor', header: copy.doctorCaption, cell: (v) => v.doctor.name },
    { id: 'type', header: copy.typeCaption, cell: (v) => typeLabel(v.visitType) },
    { id: 'token', header: copy.tokenCaption, cell: (v) => v.token?.label ?? '—' },
    {
      id: 'status',
      header: copy.statusCaption,
      cell: (v) => <Badge variant={STATUS_VARIANT[v.status]}>{STATUS_LABEL[v.status]}</Badge>,
    },
    ...(canSeeReceipt
      ? [
          {
            id: 'receipt',
            header: copy.receiptLink,
            cell: (v: VisitView) => (
              <Link
                href={visitReceiptPath(v.id)}
                className="text-primary underline-offset-4 hover:underline"
              >
                {copy.receiptLink}
              </Link>
            ),
          } satisfies DataTableColumn<VisitView>,
        ]
      : []),
    ...(canRequestRefund || canSeeTests
      ? [
          {
            id: 'actions',
            header: '',
            cell: (v: VisitView) => (
              <div className="flex flex-col items-start gap-[var(--space-2)]">
                {canSeeTests && (v.status === 'IN_CONSULTATION' || v.status === 'COMPLETED') ? (
                  <Link
                    href={visitTestsPath(v.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {staffCopy.opd.tests.refund.testsLink}
                  </Link>
                ) : null}
                {canRequestRefund && v.status === 'WAITING' && v.bill ? (
                  <RefundRequestAction
                    kind="CANCEL"
                    billId={v.bill.id}
                    visitId={v.id}
                    billNumber={v.bill.billNumber}
                    refundablePaise={Math.max(v.bill.paidPaise - v.bill.refundedPaise, 0)}
                  />
                ) : null}
              </div>
            ),
          } satisfies DataTableColumn<VisitView>,
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <DataTable columns={columns} rows={tab.data.items} ariaLabel={copy.listAria} />
      <Pager hrefFor={hrefFor} data={tab.data} />
    </div>
  );
}

/** The bills of those visits. Needs opd.billing.read (the API leaves money out otherwise). */
export function BillsPanel({
  tab,
  hrefFor,
  canReadBills,
  canRequestRefund = false,
}: {
  tab: VisitsTabData;
  hrefFor: (page: number) => string;
  canReadBills: boolean;
  /** Reception may ask an Admin for a refund of the consultation fee (opd.refunds.request). */
  canRequestRefund?: boolean;
}) {
  if (!canReadBills) {
    return <EmptyState title={copy.noAccessTitle} description={copy.noAccessDescription} />;
  }
  if (tab.status !== 'ok') {
    return <Unavailable tab={tab} />;
  }
  const rows = tab.data.items.filter((v): v is VisitView & { bill: BillView } => Boolean(v.bill));
  if (rows.length === 0) {
    return <EmptyState title={copy.billsEmptyTitle} description={copy.billsEmptyDescription} />;
  }
  const columns: DataTableColumn<VisitView & { bill: BillView }>[] = [
    { id: 'bill', header: copy.billCaption, cell: (v) => v.bill.billNumber },
    { id: 'date', header: copy.dateCaption, cell: (v) => formatDateOnly(v.visitDate) },
    { id: 'doctor', header: copy.doctorCaption, cell: (v) => v.doctor.name },
    { id: 'total', header: copy.totalCaption, cell: (v) => formatPaise(v.bill.totalPaise) },
    {
      id: 'payment',
      header: copy.paymentCaption,
      cell: (v) => (
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          <Badge variant={PAYMENT_VARIANT[v.bill.paymentStatus]}>
            {PAYMENT_LABEL[v.bill.paymentStatus]}
          </Badge>
          {v.bill.refundedPaise > 0 ? (
            <Badge variant="info">
              {v.bill.refundedPaise >= v.bill.paidPaise
                ? copy.refundedFull
                : copy.refundedPart.replace('{amount}', formatPaise(v.bill.refundedPaise))}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'receipt',
      header: copy.receiptLink,
      cell: (v) => (
        <Link
          href={visitReceiptPath(v.id)}
          className="text-primary underline-offset-4 hover:underline"
        >
          {copy.receiptLink}
        </Link>
      ),
    },
    ...(canRequestRefund
      ? [
          {
            id: 'refund',
            header: '',
            // Only before the consultation starts: after that the fee can no longer be refunded.
            cell: (v: VisitView & { bill: BillView }) =>
              v.status === 'WAITING' && v.bill.paidPaise - v.bill.refundedPaise > 0 ? (
                <RefundRequestAction
                  kind="REFUND"
                  billId={v.bill.id}
                  visitId={v.id}
                  billNumber={v.bill.billNumber}
                  refundablePaise={v.bill.paidPaise - v.bill.refundedPaise}
                />
              ) : null,
          } satisfies DataTableColumn<VisitView & { bill: BillView }>,
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <DataTable columns={columns} rows={rows} ariaLabel={copy.billsHeading} />
      <Pager hrefFor={hrefFor} data={tab.data} />
    </div>
  );
}
