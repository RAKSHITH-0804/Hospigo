import type { DoctorDetails } from '@/lib/doctors/types';

/** Shapes aligned with docs/reference/api-opd.md (Steps 5a-2 and 5a-3). No money anywhere in here. */

export type ClinicalVisitStatus =
  'AWAITING_PAYMENT' | 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED';

export type ClinicalPatient = {
  id: string;
  uhid: string;
  name: string;
  gender: string | null;
  ageYears: number | null;
};

export type ClinicalVisit = {
  id: string;
  status: ClinicalVisitStatus;
  visitDate: string;
  token: { date: string; no: number; label: string } | null;
  queuedAt: string | null;
  consultationStartedAt: string | null;
  completedAt: string | null;
  patient: ClinicalPatient;
  doctor: { id: string; code: string; name: string };
};

export type QueueItem = ClinicalVisit & { vitalsRecorded: boolean };

export type QueueResponse = {
  date: string;
  /** OWN: a doctor's own queue. BRANCH: the whole branch (a nurse). */
  scope: 'OWN' | 'BRANCH';
  total: number;
  /** The doctors that have visits in the branch queue (empty for a doctor's own queue): the filter choices. */
  doctors: Array<{ id: string; name: string }>;
  items: QueueItem[];
};

export type NoteStatus = 'DRAFT' | 'COMPLETED';

export type NoteView = {
  id: string;
  status: NoteStatus;
  complaints: string | null;
  diagnosis: string | null;
  advice: string | null;
  followUpDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrescriptionRowView = {
  lineNo: number;
  medicineId: string | null;
  medicineName: string;
  isUnlisted: boolean;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string | null;
};

export type AddendumView = {
  id: string;
  text: string;
  reason: string;
  addedBy: { id: string; name: string };
  createdAt: string;
};

export type ConsultationResponse = {
  visit: ClinicalVisit;
  /** The doctor details for the prescription (a completed note: the copy taken at completion). */
  doctorDetails: DoctorDetails;
  consultation: NoteView | null;
  prescription: PrescriptionRowView[];
  addenda: AddendumView[];
};

export type StartResponse = { replayed: boolean; visit: ClinicalVisit };
export type CompleteResponse = ConsultationResponse & { replayed: boolean };

/** The four note fields as the API takes them (PUT replaces all four). */
export type NoteBody = {
  complaints?: string;
  diagnosis?: string;
  advice?: string;
  followUpDate?: string;
};

export type PrescriptionItemPayload = {
  medicineId?: string;
  medicineName?: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions?: string;
};

export type MedicineHit = {
  id: string;
  code: string;
  name: string;
  composition: string | null;
  form: string | null;
};

export type MedicineSearchResponse = { items: MedicineHit[] };

export type VitalsValueKind = 'NUMBER' | 'TEXT';

export type VitalsField = {
  code: string;
  name: string;
  unit: string;
  valueKind: VitalsValueKind;
  displayOrder: number;
  warnMin: number | null;
  warnMax: number | null;
};

export type VitalsFieldsResponse = { items: VitalsField[] };

export type VitalsHistoryEntry = {
  version: number;
  value: number | string;
  correctionReason: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string };
};

export type VitalsReadingView = {
  code: string;
  name: string;
  unit: string;
  valueKind: VitalsValueKind;
  value: number | string;
  version: number;
  outOfRange: boolean;
  recordedAt: string;
  recordedBy: { id: string; name: string };
  history: VitalsHistoryEntry[];
};

export type VitalsResponse = {
  visit: ClinicalVisit;
  fields: VitalsReadingView[];
  recorded?: string[];
  corrected?: string[];
  unchanged?: string[];
};

export type VitalsReadingPayload = {
  fieldCode: string;
  value: number | string;
  correctionReason?: string;
};
