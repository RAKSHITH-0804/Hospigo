import { PrintButton } from '@/components/patients/print-button';
import { EmptyState } from '@/components/states/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { formatDateOnly } from '@/lib/patients/format';
import { REPEAT_VISIT_NOTE, type BillView, type VisitView } from '@/lib/opd/types';

const copy = staffCopy.opd.receipt;

function statusLabel(status: BillView['paymentStatus']): string {
  switch (status) {
    case 'PAID':
      return copy.statusPaid;
    case 'PART_PAID':
      return copy.statusPartPaid;
    default:
      return copy.statusUnpaid;
  }
}

function lineLabel(kind: string, description: string): string {
  switch (kind) {
    case 'REGISTRATION':
      return staffCopy.opd.newVisit.lineRegistration;
    case 'INVESTIGATION':
      return `${staffCopy.opd.newVisit.lineInvestigation} · ${description}`;
    default:
      return `${staffCopy.opd.newVisit.lineConsultation} · ${description}`;
  }
}

/**
 * Receipt for one visit (server component; the page fetches the visit). The browser print view
 * shows only `.visit-receipt` (print CSS hides the shell). Money is shown from whole paise.
 */
export function VisitReceipt({ visit, hospitalName }: { visit: VisitView; hospitalName: string }) {
  const bill = visit.bill ?? null;
  const patientPath = `/app/patients/${encodeURIComponent(visit.patient.id)}`;

  if (!bill) {
    return <EmptyState title={copy.noBillTitle} description={copy.noBillDescription} />;
  }

  const payments = bill.payments ?? [];
  const lines = bill.lines ?? [];
  // A split payment is ONE receipt: all its payments carry the same number, shown once.
  const receiptNumbers = [...new Set(payments.map((p) => p.receiptNumber))];

  const rows: Array<[string, string]> = [
    [copy.billNumber, bill.billNumber],
    ...(receiptNumbers.length
      ? ([[copy.receiptNumber, receiptNumbers.join(', ')]] as Array<[string, string]>)
      : []),
    [copy.patient, visit.patient.name],
    [copy.uhid, visit.patient.uhid],
    [copy.doctor, visit.doctor.name],
    [copy.visitDate, formatDateOnly(visit.visitDate)],
    [copy.branch, visit.branch.name],
  ];

  return (
    <div className="visit-receipt-print-root flex flex-col gap-[var(--space-4)]">
      <div className="no-print">
        <PageHeader
          title={copy.title}
          description={`${visit.patient.name} · ${visit.patient.uhid}`}
          backHref={patientPath}
          actions={<PrintButton label={copy.print} />}
        />
      </div>
      <section className="visit-receipt" aria-label={copy.title}>
        <p className="visit-receipt-hospital type-heading font-semibold">{hospitalName}</p>
        <p className="type-label text-muted-foreground">{copy.title}</p>

        {visit.token ? (
          <div className="visit-receipt-token-box">
            <span className="type-label text-muted-foreground">{copy.token}</span>
            <span className="visit-receipt-token" data-testid="receipt-token">
              {visit.token.label}
            </span>
          </div>
        ) : null}

        <dl className="patient-slip-details">
          {rows.map(([label, value]) => (
            <div key={label} className="patient-slip-row">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="visit-receipt-lines">
          <thead>
            <tr>
              <th scope="col">{copy.itemCaption}</th>
              <th scope="col" className="visit-receipt-amount">
                {copy.amountCaption}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNo}>
                <td>
                  {lineLabel(line.kind, line.description)}
                  {line.pricingNote ? (
                    <span className="type-small block text-muted-foreground">
                      {line.pricingNote === REPEAT_VISIT_NOTE
                        ? copy.freeRepeatVisit
                        : copy.freeFollowUp}
                    </span>
                  ) : null}
                </td>
                <td className="visit-receipt-amount">{formatPaise(line.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{copy.total}</th>
              <td className="visit-receipt-amount font-semibold">{formatPaise(bill.totalPaise)}</td>
            </tr>
            <tr>
              <th scope="row">{copy.paid}</th>
              <td className="visit-receipt-amount">
                {formatPaise(bill.paidPaise)} · {statusLabel(bill.paymentStatus)}
              </td>
            </tr>
            {bill.refundedPaise > 0 ? (
              <tr>
                <th scope="row">{copy.refunded}</th>
                <td className="visit-receipt-amount">{formatPaise(bill.refundedPaise)}</td>
              </tr>
            ) : null}
          </tfoot>
        </table>

        {payments.length ? (
          <dl className="patient-slip-details">
            {payments.map((p) => (
              <div key={p.id} className="patient-slip-row">
                <dt className="text-muted-foreground">
                  {copy.mode}: {p.paymentMode.name}
                  {p.referenceNo ? ` · ${copy.reference}: ${p.referenceNo}` : ''}
                </dt>
                <dd className="font-medium">{formatPaise(p.amountPaise)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    </div>
  );
}
