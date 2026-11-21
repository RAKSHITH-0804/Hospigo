import type {
  ClinicalVisit,
  ConsultationResponse,
  QueueItem,
  VitalsField,
  VitalsReadingView,
} from './clinical-types';

/** Test-only builders for the clinical screens (no real data). */
export function makeVisit(over: Partial<ClinicalVisit> = {}): ClinicalVisit {
  return {
    id: 'visit-1',
    status: 'WAITING',
    visitDate: '2026-11-19',
    token: { date: '2026-11-19', no: 7, label: 'T7' },
    queuedAt: '2026-11-19T04:00:00.000Z',
    consultationStartedAt: null,
    completedAt: null,
    patient: { id: 'p1', uhid: 'NHEL0001', name: 'Ravi Kumar', gender: 'M', ageYears: 41 },
    doctor: { id: 'd1', code: 'DR001', name: 'Dr Meena' },
    ...over,
  };
}

export function makeQueueItem(over: Partial<QueueItem> = {}): QueueItem {
  return { ...makeVisit(), vitalsRecorded: false, ...over };
}

export function makeConsult(over: Partial<ConsultationResponse> = {}): ConsultationResponse {
  return {
    visit: makeVisit(),
    doctorDetails: {
      name: 'Dr Meena',
      printedName: null,
      printName: 'Dr Meena',
      department: null,
      qualifications: null,
      speciality: null,
      registrationNo: null,
      signatureImageId: null,
      fromCompletedCopy: false,
    },
    consultation: null,
    prescription: [],
    addenda: [],
    ...over,
  };
}

export function makeNote(over: Partial<NonNullable<ConsultationResponse['consultation']>> = {}) {
  return {
    id: 'note-1',
    status: 'DRAFT' as const,
    complaints: null,
    diagnosis: null,
    advice: null,
    followUpDate: null,
    completedAt: null,
    createdAt: '2026-11-19T04:10:00.000Z',
    updatedAt: '2026-11-19T04:10:00.000Z',
    ...over,
  };
}

export const PULSE: VitalsField = {
  code: 'pulse',
  name: 'Pulse',
  unit: 'bpm',
  valueKind: 'NUMBER',
  displayOrder: 1,
  warnMin: 50,
  warnMax: 120,
};

export const POSTURE: VitalsField = {
  code: 'posture',
  name: 'Posture',
  unit: '-',
  valueKind: 'TEXT',
  displayOrder: 2,
  warnMin: null,
  warnMax: null,
};

export function makeReading(over: Partial<VitalsReadingView> = {}): VitalsReadingView {
  const who = { id: 'u1', name: 'Nurse One' };
  return {
    code: 'pulse',
    name: 'Pulse',
    unit: 'bpm',
    valueKind: 'NUMBER',
    value: 72,
    version: 1,
    outOfRange: false,
    recordedAt: '2026-11-19T04:05:00.000Z',
    recordedBy: who,
    history: [
      {
        version: 1,
        value: 72,
        correctionReason: null,
        recordedAt: '2026-11-19T04:05:00.000Z',
        recordedBy: who,
      },
    ],
    ...over,
  };
}
