import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { ConsultationResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import { fill } from '@/lib/opd/clinical-format';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import { REPEAT_VISIT_NOTE, type BillView, type VisitView } from '@/lib/opd/types';
import { ageLabel, formatDateOnly, genderLabel } from '@/lib/patients/format';
import type { PatientDetail } from '@/lib/patients/types';
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
  ];
}

export function slipItems(
  patient: PatientDetail,
  branchName: string | null,
  hospitalName: string,
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
    text('age', patient.ageYears === null ? '' : ageLabel(patient.ageYears)),
    text('gender', patient.gender ? genderLabel(patient.gender) : ''),
    text('phone', patient.phone),
    text('address', address),
    // The registration date is not part of the patient answer, so it is not printed (yet).
    text('registeredOn', ''),
    text('branchName', branchName),
  ];
}

export function prescriptionItems(input: {
  consultation: ConsultationResponse;
  vitals?: VitalsResponse | null;
  tests?: VisitTestsResponse | null;
  hospitalName: string;
}): PrintItem[] {
  const { visit, consultation, prescription, doctorDetails: doctor } = input.consultation;
  const note = consultation;
  const medicineCopy = staffCopy.print.prescription;
  return [
    text('hospitalName', input.hospitalName),
    text('patientName', visit.patient.name),
    text('uhid', visit.patient.uhid),
    text('age', visit.patient.ageYears === null ? '' : ageLabel(visit.patient.ageYears)),
    text('gender', visit.patient.gender ? genderLabel(visit.patient.gender) : ''),
    text('visitDate', formatDateOnly(visit.visitDate)),
    text('token', visit.token?.label),
    text('doctorName', doctor.printName || visit.doctor.name),
    text('doctorDepartment', doctor.department ?? ''),
    text('doctorQualifications', doctor.qualifications ?? ''),
    text('doctorSpeciality', doctor.speciality ?? ''),
    text('doctorRegistrationNo', doctor.registrationNo ?? ''),
    // The signature or stamp picture waits for the image upload step.
    text('doctorSignature', ''),
    lines(
      'vitals',
      (input.vitals?.fields ?? []).map((f) =>
        fill(medicineCopy.vitalLine, { name: f.name, value: String(f.value), unit: f.unit }).trim(),
      ),
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
  ];
}
