import Link from 'next/link';
import { RefundRequestAction } from '@/components/opd/refund-request-action';
import { EmptyState } from '@/components/states/empty-state';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { statusKind } from '@/lib/opd/tests-draft';
import { orderStatusText } from '@/lib/opd/tests-labels';
import { testsReceiptPath } from '@/lib/opd/tests-client';
import type { OrderView, VisitTestsResponse } from '@/lib/opd/tests-types';
import type { BillView, VisitView } from '@/lib/opd/types';
import { formatDateOnly } from '@/lib/patients/format';

const copy = staffCopy.opd.tests.visit;

/** The tests of one visit and their bills (with the receipt and, for reception, a refund request). */
export function VisitTestsPanel({
  visit,
  tests,
  canRequestRefund,
}: {
  visit: Pick<VisitView, 'id' | 'patient'>;
  tests: VisitTestsResponse;
  canRequestRefund: boolean;
}) {
  const patientPath = `/app/patients/${encodeURIComponent(visit.patient.id)}`;
  const orderColumns: DataTableColumn<OrderView>[] = [
    { id: 'test', header: copy.colTest, cell: (o) => o.name },
    {
      id: 'status',
      header: copy.colStatus,
      cell: (o) => (
        <Badge variant={statusKind(o.status) === 'ordered' ? 'info' : 'neutral'}>
          {orderStatusText(o.status, o.notTakenReason)}
        </Badge>
      ),
    },
    { id: 'bill', header: copy.colBill, cell: (o) => o.billNumber ?? '—' },
  ];
  const bills = tests.bills ?? [];
  const billColumns: DataTableColumn<BillView>[] = [
    { id: 'bill', header: copy.colBill, cell: (b) => b.billNumber },
    { id: 'date', header: copy.colDate, cell: (b) => formatDateOnly(b.billDate) },
    { id: 'total', header: copy.colTotal, cell: (b) => formatPaise(b.totalPaise) },
    { id: 'refunded', header: copy.colRefunded, cell: (b) => formatPaise(b.refundedPaise) },
    {
      id: 'receipt',
      header: copy.print,
      cell: (b) => (
        <Link
          href={testsReceiptPath(visit.id, b.id)}
          className="text-primary underline-offset-4 hover:underline"
        >
          {copy.print}
        </Link>
      ),
    },
    ...(canRequestRefund
      ? [
          {
            id: 'refund',
            header: '',
            cell: (b: BillView) =>
              b.paidPaise - b.refundedPaise > 0 ? (
                <RefundRequestAction
                  kind="REFUND"
                  billId={b.id}
                  visitId={visit.id}
                  billNumber={b.billNumber}
                  refundablePaise={b.paidPaise - b.refundedPaise}
                />
              ) : null,
          } satisfies DataTableColumn<BillView>,
        ]
      : []),
  ];

  return (
    <div className="section-stack content-container-inner">
      <PageHeader
        title={copy.title}
        description={`${visit.patient.name} · ${visit.patient.uhid}`}
        backHref={patientPath}
      />
      <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.ordersHeading}>
        <h2 className="section-heading">{copy.ordersHeading}</h2>
        {tests.orders.length === 0 ? (
          <EmptyState title={copy.noOrders} />
        ) : (
          <DataTable columns={orderColumns} rows={tests.orders} ariaLabel={copy.ordersHeading} />
        )}
      </section>
      {tests.bills !== undefined ? (
        <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.billsHeading}>
          <h2 className="section-heading">{copy.billsHeading}</h2>
          {bills.length === 0 ? (
            <EmptyState title={copy.noBills} />
          ) : (
            <DataTable columns={billColumns} rows={bills} ariaLabel={copy.billsHeading} />
          )}
        </section>
      ) : null}
    </div>
  );
}
