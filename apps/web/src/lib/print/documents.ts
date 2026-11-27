import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { ConsultationResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import { fill } from '@/lib/opd/clinical-format';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import { REPEAT_VISIT_NOTE, type BillView, type VisitView } from '@/lib/opd/types';
import { ageDisplay, formatDateOnly, genderLabel } from '@/lib/patients/format';
import type { FormConfigField, PatientDetail } from '@/lib/patients/types';
import { relativeLine } from '@/lib/patients/relative';
import type { PrintItem } from './types';

/**
 * What each document has to say, in the order of the document's field list (the API's
 * PRINT_FIELDS). A document only says what it knows: a missing value gives an empty item and the
 * sheet leaves it out. Captions come from the typed copy file; money comes from whole paise.
 */
const L = staffCopy.print.fields;
const receiptCopy = staffCopy.opd.receipt;
const newVisitCopy = staffCopy.opd.newVisit;

function text(key: string, value: string | null | undefined): PrintItem {
  return { key, label: L[key] ?? key, text: value?.trim() ?? '' };
}

function lines(key: string, values: string[]): PrintItem {
  return { key, label: L[key] ?? key, lines: values };
}

function pairs(key: string, values: Array<[string, string]>): PrintItem {
  return { key, label: L[key] ?? key, pairs: values };
}

function paymentStatusLabel(status: BillView['paymentStatus']): string {
  switch (status) {
    case 'PAID':
      return receiptCopy.statusPaid;
    case 'PART_PAID':
      return receiptCopy.statusPartPaid;
    default:
      return receiptCopy.statusUnpaid;
  }
}

function billLineName(kind: string, description: string, note: string | null): string {
  const base =
    kind === 'REGISTRATION'
      ? newVisitCopy.lineRegistration
      : kind === 'INVESTIGATION'
        ? `${newVisitCopy.lineInvestigation} · ${description}`
        : `${newVisitCopy.lineConsultation} · ${description}`;
  if (!note) {
    return base;
  }
  return `${base} (${note === REPEAT_VISIT_NOTE ? receiptCopy.freeRepeatVisit : receiptCopy.freeFollowUp})`;
}

/**
 * Adds the extra print values (Step 8c) to the values of a document, under their template name
 * (value.<code>). A built-in value is never replaced, and a value without text is left out.
 */
export function withExtraValues(
  items: PrintItem[],
  extra: ReadonlyArray<{ field: string; label: string; text: string }>,
): PrintItem[] {
  const taken = new Set(items.map((i) => i.key));
  const added = extra
    .filter((e) => e.text.trim() !== '' && !taken.has(e.field))
    .map((e): PrintItem => ({ key: e.field, label: e.label, text: e.text }));
  return [...items, ...added];
}

export function receiptItems(visit: VisitView, hospitalName: string): PrintItem[] {
  const bill = visit.bill ?? null;
  const payments = bill?.payments ?? [];
  // A split payment is ONE receipt: all its payments carry the same number, shown once.
  const receiptNumbers = [...new Set(payments.map((p) => p.receiptNumber))];
  return [
    text('hospitalName', hospitalName),
    text('billNumber', bill?.billNumber),
    text('receiptNumber', receiptNumbers.join(', ')),
    text('token', visit.token?.label),
    text('patientName', visit.patient.name),
    text('uhid', visit.patient.uhid),
    text('age', visit.patient.ageYears === null ? '' : ageDisplay(visit.patient)),
    text('gender', visit.patient.gender ? genderLabel(visit.patient.gender) : ''),
    text('doctorName', visit.doctor.name),
    text('visitDate', formatDateOnly(visit.visitDate)),
    text('branchName', visit.branch.name),
    pairs(
      'lines',
      (bill?.lines ?? []).map((line) => [
        billLineName(line.kind, line.description, line.pricingNote),
        formatPaise(line.lineTotalPaise),
      ]),
    ),
    // the same items with a serial number (Sl No), for the designed bills
    pairs(
      'linesNumbered',
      (bill?.lines ?? []).map((line, index) => [
        `${index + 1}. ${billLineName(line.kind, line.description, line.pricingNote)}`,
        formatPaise(line.lineTotalPaise),
      ]),
    ),
    text('total', bill ? formatPaise(bill.totalPaise) : ''),
    text(
      'paid',
      bill ? `${formatPaise(bill.paidPaise)} · ${paymentStatusLabel(bill.paymentStatus)}` : '',
    ),
    text('refunded', bill && bill.refundedPaise > 0 ? formatPaise(bill.refundedPaise) : ''),
    pairs(
      'paymentModes',
      payments.map((p) => [p.paymentMode.name, formatPaise(p.amountPaise)]),
    ),
    lines(
      'referenceNo',
      payments.filter((p) => p.referenceNo).map((p) => `${p.paymentMode.name}: ${p.referenceNo}`),
    ),
    text('receptionistName', visit.createdByName),
    text('billedBy', bill?.billedBy),
  ];
}

export function slipItems(
  patient: PatientDetail,
  branchName: string | null,
  hospitalName: string,
  formFields: readonly FormConfigField[] = [],
): PrintItem[] {
  const address = [
    patient.addressStreet,
    patient.addressCross,
    patient.addressArea,
    patient.addressCity,
    patient.addressState,
    patient.addressPincode,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return [
    text('hospitalName', hospitalName),
    text('uhid', patient.uhid),
    text('patientName', patient.name),
    // The relation (S/O, W/O ...) and the relative's name are stored apart and print together.
    text('relative', relativeLine(patient.customFieldValues, formFields)),
    text('age', patient.ageYears === null ? '' : ageDisplay(patient)),
    text('gender', patient.gender ? genderLabel(patient.gender) : ''),
    text('phone', patient.phone),
    text('address', address),
    // The registration date is not part of the patient answer, so it is not printed (yet).
    text('registeredOn', ''),
    text('branchName', branchName),
    text('receptionistName', patient.createdByName),
  ];
}

/** The patient card: a small label for the patient file. */
export function patientCardItems(
  patient: PatientDetail,
  hospitalName: string,
  formFields: readonly FormConfigField[] = [],
): PrintItem[] {
  const address = [
    patient.addressStreet,
    patient.addressCross,
    patient.addressArea,
    patient.addressCity,
    patient.addressState,
    patient.addressPincode,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return [
    text('hospitalName', hospitalName),
    text('uhid', patient.uhid),
    text('patientName', patient.name),
    text('relative', relativeLine(patient.customFieldValues, formFields)),
    text('age', patient.ageYears === null ? '' : ageDisplay(patient)),
    text('gender', patient.gender ? genderLabel(patient.gender) : ''),
    text('address', address),
    text('phone', patient.phone),
    text('receptionistName', patient.createdByName),
  ];
}

export function patientReportItems(input: {
  consultation: ConsultationResponse;
  vitals?: VitalsResponse | null;
  tests?: VisitTestsResponse | null;
  hospitalName: string;
  /** true once an Admin has changed the completed note (Step 2.1b): the print says so. */
  amended?: boolean;
}): PrintItem[] {
  const { visit, consultation, prescription, doctorDetails: doctor } = input.consultation;
  const note = consultation;
  const medicineCopy = staffCopy.print.patientReport;
  return [
    text('hospitalName', input.hospitalName),
    text('patientName', visit.patient.name),
    text('uhid', visit.patient.uhid),
    text('age', visit.patient.ageYears === null ? '' : ageDisplay(visit.patient)),
    text('gender', visit.patient.gender ? genderLabel(visit.patient.gender) : ''),
    text('visitDate', formatDateOnly(visit.visitDate)),
    text('token', visit.token?.label),
    text('doctorName', doctor.printName || visit.doctor.name),
    text('doctorDepartment', doctor.department ?? ''),
    text('doctorQualifications', doctor.qualifications ?? ''),
    text('doctorSpeciality', doctor.speciality ?? ''),
    text('doctorRegistrationNo', doctor.registrationNo ?? ''),
    // The signature or stamp is a picture box (slot SIGNATURE); this text value stays empty.
    text('doctorSignature', ''),
    lines(
      'vitals',
      (input.vitals?.fields ?? []).map((f) =>
        fill(medicineCopy.vitalLine, { name: f.name, value: String(f.value), unit: f.unit }).trim(),
      ),
    ),
    // all the vitals on one line (for the designed templates; 'vitals' stays the list)
    text(
      'vitalsLine',
      (input.vitals?.fields ?? [])
        .map((f) =>
          fill(medicineCopy.vitalLine, {
            name: f.name,
            value: String(f.value),
            unit: f.unit,
          }).trim(),
        )
        .join(' · '),
    ),
    text(
      'receptionSymptoms',
      visit.receptionSymptoms
        ? `${visit.receptionistName ?? ''}: ${visit.receptionSymptoms}`.replace(/^: /, '')
        : '',
    ),
    text('complaints', note?.complaints),
    text('diagnosis', note?.diagnosis),
    lines(
      'medicines',
      [...prescription]
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((row, index) => {
          const base = fill(medicineCopy.medicineLine, {
            name: row.medicineName,
            dose: row.dose,
            frequency: row.frequency,
            duration: row.duration,
          });
          return `${index + 1}. ${row.instructions ? `${base} (${row.instructions})` : base}`;
        }),
    ),
    lines(
      'tests',
      (input.tests?.orders ?? []).filter((o) => o.status !== 'NOT_TAKEN').map((o) => o.name),
    ),
    text('advice', note?.advice),
    text('followUpDate', note?.followUpDate ? formatDateOnly(note.followUpDate) : ''),
    text('amendedMark', input.amended ? medicineCopy.amended : ''),
  ];
}

/**
 * The prescription that goes to the pharmacy (Step 2.1a): header, who the patient is, the medicines
 * the doctor entered and the doctor's signature. No vitals, no diagnosis, no billing. The patient's own
 * copy with everything is the patient report.
 */
export function prescriptionItems(input: {
  consultation: ConsultationResponse;
  hospitalName: string;
  amended?: boolean;
}): PrintItem[] {
  const { visit, prescription, doctorDetails: doctor } = input.consultation;
  const medicineCopy = staffCopy.print.prescription;
  return [
    text('hospitalName', input.hospitalName),
    text('patientName', visit.patient.name),
    text('uhid', visit.patient.uhid),
    text('age', visit.patient.ageYears === null ? '' : ageDisplay(visit.patient)),
    text('gender', visit.patient.gender ? genderLabel(visit.patient.gender) : ''),
    text('visitDate', formatDateOnly(visit.visitDate)),
    text('token', visit.token?.label),
    text('doctorName', doctor.printName || visit.doctor.name),
    text('doctorDepartment', doctor.department ?? ''),
    text('doctorQualifications', doctor.qualifications ?? ''),
    text('doctorSpeciality', doctor.speciality ?? ''),
    text('doctorRegistrationNo', doctor.registrationNo ?? ''),
    // The signature or stamp is a picture box (slot SIGNATURE); this text value stays empty.
    text('doctorSignature', ''),
    lines(
      'medicines',
      [...prescription]
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((row, index) => {
          const base = fill(medicineCopy.medicineLine, {
            name: row.medicineName,
            dose: row.dose,
            frequency: row.frequency,
            duration: row.duration,
          });
          return `${index + 1}. ${row.instructions ? `${base} (${row.instructions})` : base}`;
        }),
    ),
    text('amendedMark', input.amended ? medicineCopy.amended : ''),
  ];
}
