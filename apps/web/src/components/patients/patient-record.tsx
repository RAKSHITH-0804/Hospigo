import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import {
  EMPTY_VALUE,
  ageLabel,
  formatPhoneDisplay,
  formatDateOnly,
  genderLabel,
  textOrEmpty,
} from '@/lib/patients/format';
import type { CustomFieldValue, PatientDetail } from '@/lib/patients/types';
import { cn } from '@/lib/utils';
import { RecordTabs } from './record-tabs';

const copy = staffCopy.patients;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="type-small text-muted-foreground">{label}</dt>
      <dd className="type-body text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="section-heading">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="record-cols">{children}</dl>
      </CardContent>
    </Card>
  );
}

function customDisplay(value: CustomFieldValue): string {
  if (value.optionLabel) {
    return value.optionLabel;
  }
  if (value.valueText) {
    return value.valueText;
  }
  if (value.valueNumber !== null && value.valueNumber !== undefined) {
    return String(value.valueNumber);
  }
  if (value.valueDate) {
    return formatDateOnly(value.valueDate, patientsWebConfig.dateLocale);
  }
  return EMPTY_VALUE;
}

/**
 * Age and date of birth cells. An estimated date of birth is never shown as a date:
 * only "Age N years (approx.)". A real date is shown like the table dates, plus the age.
 */
function ageRows(patient: PatientDetail): ReactNode {
  const hasAge = patient.ageYears !== null && patient.ageYears !== undefined;
  const plainAge = hasAge
    ? `${ageLabel(patient.ageYears)} ${copy.record.ageYearsSuffix}`
    : EMPTY_VALUE;
  if (patient.dobIsEstimated || !patient.dateOfBirth) {
    return (
      <Row label={copy.form.ageYears}>
        {hasAge && patient.dobIsEstimated
          ? copy.record.ageApproximate.replace('{age}', ageLabel(patient.ageYears))
          : plainAge}
      </Row>
    );
  }
  return (
    <>
      <Row label={copy.form.dateOfBirth}>{formatDateOnly(patient.dateOfBirth)}</Row>
      <Row label={copy.form.ageYears}>{plainAge}</Row>
    </>
  );
}

/**
 * Patient record (server component). The page fetches the data on the server;
 * only the tab switch (RecordTabs) is a client component.
 */
export function PatientRecord({
  patient,
  labels,
  canWrite,
}: {
  patient: PatientDetail;
  /** Custom field code → label, from form-config. */
  labels: Record<string, string>;
  canWrite: boolean;
}) {
  const base = `/app/patients/${encodeURIComponent(patient.id)}`;
  const addressRows: Array<[string, string | null]> = [
    [copy.form.addressStreet, patient.addressStreet],
    [copy.form.addressCross, patient.addressCross],
    [copy.form.addressArea, patient.addressArea],
    [copy.form.addressCity, patient.addressCity],
    [copy.form.addressState, patient.addressState],
    [copy.form.addressPincode, patient.addressPincode],
  ];
  const customValues = patient.customFieldValues ?? [];

  const overview = (
    <div className="flex flex-col gap-[var(--space-3)]">
      <Section title={copy.record.sectionDemographics}>
        <Row label={copy.form.uhidReadOnly}>
          <Badge variant="info">{patient.uhid}</Badge>
        </Row>
        <Row label={copy.form.name}>{patient.name}</Row>
        <Row label={copy.form.gender}>{genderLabel(patient.gender)}</Row>
        {ageRows(patient)}
      </Section>
      <Section title={copy.record.sectionContact}>
        <Row label={copy.form.phone}>{formatPhoneDisplay(patient.phone)}</Row>
        <Row label={copy.form.email}>{textOrEmpty(patient.email)}</Row>
      </Section>
      <Section title={copy.record.sectionAddress}>
        {addressRows.map(([label, value]) => (
          <Row key={label} label={label}>
            {textOrEmpty(value)}
          </Row>
        ))}
      </Section>
      {customValues.length ? (
        <Section title={copy.record.sectionCustom}>
          {customValues.map((item) => (
            <Row key={item.code} label={labels[item.code] ?? item.code}>
              {customDisplay(item)}
            </Row>
          ))}
        </Section>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <PageHeader
        title={patient.name}
        description={patient.uhid}
        backHref="/app/patients"
        actions={
          <>
            <Link
              href={`${base}/slip`}
              className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
            >
              {copy.record.printSlipAction}
            </Link>
            {canWrite ? (
              <Link href={`${base}/edit`} className={cn(buttonVariants(), 'touch-target')}>
                {copy.record.editAction}
              </Link>
            ) : null}
          </>
        }
      />
      <RecordTabs overview={overview} />
    </div>
  );
}
