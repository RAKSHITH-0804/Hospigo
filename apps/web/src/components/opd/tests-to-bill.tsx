'use client';

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TestsBillPanel } from '@/components/opd/tests-bill-panel';
import { EmptyState } from '@/components/states/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { fill, formatClock } from '@/lib/opd/clinical-format';
import { loadPendingTests, testsReceiptPath } from '@/lib/opd/tests-client';
import type { BillTestsResponse, PendingTestsResponse, PendingVisit } from '@/lib/opd/tests-types';
import type { PaymentModesResponse } from '@/lib/opd/types';
import { ABORTED_CODE } from '@/lib/patients/client';
import { EMPTY_VALUE } from '@/lib/patients/format';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.tests.reception;

type Row = PendingVisit & { id: string };
const asRows = (items: PendingVisit[]): Row[] => items.map((i) => ({ ...i, id: i.visitId }));

type Done = { visitId: string; patientName: string; result: BillTestsResponse };

/**
 * Reception "Tests to bill": the tests doctors have ordered and nobody has billed yet. Pick a
 * patient, tick the tests they will take, take payment. The first list comes from the server and is
 * refreshed every few seconds (a setting) and on demand; a failed refresh keeps the list on screen.
 */
export function TestsToBill({
  initial,
  paymentModes,
  refreshSeconds,
}: {
  initial: PendingTestsResponse;
  paymentModes: Omit<PaymentModesResponse, 'defaultCode'> & { defaultCode: string };
  refreshSeconds: number;
}) {
  const [items, setItems] = useState<PendingVisit[]>(initial.items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    const result = await loadPendingTests();
    inFlight.current = false;
    setRefreshing(false);
    if (result.ok) {
      setItems(result.data.items);
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

  const selected = items.find((i) => i.visitId === selectedId) ?? null;

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'token',
      header: copy.colToken,
      cell: (v) => <span className="type-label-strong">{v.token ?? EMPTY_VALUE}</span>,
    },
    {
      id: 'patient',
      header: copy.colPatient,
      cell: (v) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{v.patient.name}</span>
          <span className="type-small text-muted-foreground">{v.patient.uhid}</span>
        </div>
      ),
    },
    { id: 'doctor', header: copy.colDoctor, cell: (v) => v.doctor.name },
    {
      id: 'tests',
      header: copy.colTests,
      cell: (v) => <span className="type-label">{v.orders.map((o) => o.name).join(', ')}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: (v) => (
        <Button
          type="button"
          className="touch-target"
          variant={selectedId === v.visitId ? 'outline' : 'default'}
          aria-label={fill(copy.openLabel, { name: v.patient.name })}
          onClick={() => {
            setDone(null);
            setSelectedId(v.visitId);
          }}
        >
          {copy.open}
        </Button>
      ),
    },
  ];

  return (
    <div className="section-stack content-container-inner">
      <PageHeader
        title={copy.title}
        description={copy.description}
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
      <p className="type-small text-muted-foreground" role="status">
        {fill(copy.summary, { count: items.length })} ·{' '}
        {fill(copy.updatedAt, { time: formatClock(updatedAt) })}
      </p>
      {refreshFailed ? (
        <p role="alert" className="type-label text-destructive">
          {copy.refreshFailed}
        </p>
      ) : null}

      {done ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.doneTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            <p role="status" className="type-label">
              {fill(copy.doneLine, {
                name: done.patientName,
                bill: done.result.bill.billNumber,
              })}
              {done.result.bill.receipts?.[0]
                ? ` · ${fill(copy.doneReceipt, { number: done.result.bill.receipts[0].receiptNumber })}`
                : ''}
            </p>
            <div className="flex flex-wrap gap-[var(--space-2)]">
              <Link
                href={testsReceiptPath(done.visitId, done.result.bill.id)}
                className={cn(buttonVariants({ variant: 'default' }), 'touch-target')}
              >
                {copy.printReceipt}
              </Link>
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                onClick={() => setDone(null)}
              >
                {copy.backToList}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 && !done ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : null}

      {items.length > 0 ? (
        <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
          <DataTable
            columns={columns}
            rows={asRows(items)}
            ariaLabel={copy.title}
            selectedId={selectedId ?? undefined}
          />
          {selected ? (
            <TestsBillPanel
              key={selected.visitId}
              visit={selected}
              paymentModes={paymentModes}
              onClose={() => setSelectedId(null)}
              onReload={() => void refresh()}
              onBilled={(result) => {
                setDone({
                  visitId: selected.visitId,
                  patientName: selected.patient.name,
                  result,
                });
                setSelectedId(null);
                void refresh();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
