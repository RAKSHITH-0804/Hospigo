import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { ageLabel, genderLabel, textOrEmpty } from '@/lib/patients/format';
import type { PatientDetail } from '@/lib/patients/types';
import { PrintButton } from './print-button';

const copy = staffCopy.patients;

/**
 * Registration slip (server component; the page fetches the patient).
 * Print CSS (globals.css) hides the shell and shows only .patient-slip.
 * The slip keeps the phone as stored.
 */
export function PatientSlip({
  patient,
  hospitalName,
}: {
  patient: PatientDetail;
  hospitalName: string;
}) {
  const rows: Array<[string, string]> = [
    [copy.slip.name, patient.name],
    [copy.slip.uhid, patient.uhid],
    [copy.slip.gender, genderLabel(patient.gender)],
    [copy.slip.age, ageLabel(patient.ageYears)],
    [copy.slip.phone, textOrEmpty(patient.phone)],
  ];

  return (
    <div className="patient-slip-print-root flex flex-col gap-[var(--space-4)]">
      <div className="no-print">
        <PageHeader
          title={copy.slip.title}
          backHref={`/app/patients/${encodeURIComponent(patient.id)}`}
          actions={<PrintButton label={copy.slip.print} />}
        />
      </div>
      <section className="patient-slip" aria-label={copy.slip.title}>
        <p className="patient-slip-hospital type-heading font-semibold">{hospitalName}</p>
        <p className="type-label text-muted-foreground">{copy.slip.title}</p>
        <dl className="patient-slip-details">
          {rows.map(([label, value]) => (
            <div key={label} className="patient-slip-row">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
