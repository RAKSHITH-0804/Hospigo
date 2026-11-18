/**
 * OPD clinical part (queue, consultation note, prescription, vitals): limits and names in one
 * place, so the service and the DTOs have no magic numbers.
 */
export const OPD_CLINICAL_CONFIG = {
  idMaxLength: 64,
  /** Free-text note fields (same cap as the database check). */
  noteTextMaxLength: 4000,
  addendumTextMaxLength: 4000,
  addendumReasonMaxLength: 500,
  /** Prescription. */
  maxPrescriptionItems: 30,
  medicineNameMaxLength: 200,
  doseMaxLength: 100,
  frequencyMaxLength: 100,
  durationMaxLength: 100,
  instructionsMaxLength: 500,
  /** Medicine search (the prescription picker). */
  medicineSearchDefaultLimit: 20,
  medicineSearchMaxLimit: 50,
  medicineSearchMaxLength: 100,
  /** Vitals. */
  maxVitalsReadings: 20,
  vitalsCodeMaxLength: 32,
  vitalsTextMaxLength: 200,
  vitalsReasonMaxLength: 500,
  /** Largest absolute number the database stores in DECIMAL(10,2). */
  vitalsMaxAbsValue: 99_999_999.99,
  vitalsDecimals: 2,
  /** A follow-up date may be at most this many days after the visit day. */
  followUpMaxDays: 366,
  msPerDay: 24 * 60 * 60 * 1000,
} as const;

/** Audit action names (field names and ids only, never personal values). */
export const OPD_CLINICAL_AUDIT = {
  visitStarted: 'OPD_VISIT_START',
  noteSaved: 'OPD_NOTE_SAVE',
  prescriptionSaved: 'OPD_PRESCRIPTION_SAVE',
  visitCompleted: 'OPD_VISIT_COMPLETE',
  noteRead: 'OPD_NOTE_READ',
  addendumAdded: 'OPD_NOTE_ADDENDUM',
  vitalsRecorded: 'OPD_VITALS_RECORD',
} as const;
