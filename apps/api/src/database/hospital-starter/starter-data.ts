/**
 * The standard rows the starter script creates for a new hospital (Step 8b, part A).
 * The same values the dev seed uses; an Admin can change them later and the script never
 * overwrites a changed value.
 */

export const STARTER_PAYMENT_MODES: ReadonlyArray<{
  code: string;
  name: string;
  requiresReference: boolean;
}> = [
  { code: 'CASH', name: 'Cash', requiresReference: false },
  { code: 'UPI', name: 'UPI', requiresReference: true },
  { code: 'CARD', name: 'Card', requiresReference: true },
];

/** Warning ranges only warn on the vitals screen; they never block a value. */
export const STARTER_VITALS: ReadonlyArray<{
  code: string;
  name: string;
  unit: string;
  warnMin: number;
  warnMax: number;
  order: number;
}> = [
  { code: 'pulse', name: 'Pulse', unit: 'bpm', warnMin: 50, warnMax: 120, order: 1 },
  { code: 'spo2', name: 'SpO2', unit: '%', warnMin: 90, warnMax: 100, order: 2 },
  { code: 'bp_systolic', name: 'BP Systolic', unit: 'mmHg', warnMin: 90, warnMax: 160, order: 3 },
  { code: 'bp_diastolic', name: 'BP Diastolic', unit: 'mmHg', warnMin: 60, warnMax: 100, order: 4 },
  { code: 'resp_rate', name: 'Respiratory rate', unit: '/min', warnMin: 10, warnMax: 30, order: 5 },
  { code: 'temperature', name: 'Temperature', unit: 'degF', warnMin: 95, warnMax: 104, order: 6 },
  { code: 'weight', name: 'Weight', unit: 'kg', warnMin: 2, warnMax: 200, order: 7 },
];

export const STARTER_REGISTRATION_ITEM = { code: 'REG', name: 'Registration' } as const;
