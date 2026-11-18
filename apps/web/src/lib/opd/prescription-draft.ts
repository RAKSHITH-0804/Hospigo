import type { PrescriptionItemPayload, PrescriptionRowView } from './clinical-types';

/** One row of the prescription box as the doctor is typing it. */
export type RxDraft = {
  id: number;
  /** LISTED: a medicine picked from the hospital list. FREE: typed text, flagged "unlisted". */
  mode: 'LISTED' | 'FREE';
  medicineId: string | null;
  medicineName: string;
  /** What was typed in the search box (the line is not finished until a medicine is picked). */
  search: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
};

export type RxRowState = 'blank' | 'incomplete' | 'complete';

export function emptyRxRow(id: number): RxDraft {
  return {
    id,
    mode: 'LISTED',
    medicineId: null,
    medicineName: '',
    search: '',
    dose: '',
    frequency: '',
    duration: '',
    instructions: '',
  };
}

/**
 * blank: nothing typed (ignored). complete: a medicine plus dose, frequency and duration.
 * incomplete: something typed but not enough to send (it stays on screen, it is not saved).
 */
export function rxRowState(row: RxDraft): RxRowState {
  const hasMedicine =
    row.mode === 'LISTED' ? row.medicineId !== null : row.medicineName.trim() !== '';
  const hasDetails =
    row.dose.trim() !== '' && row.frequency.trim() !== '' && row.duration.trim() !== '';
  if (hasMedicine && hasDetails) {
    return 'complete';
  }
  const typedSomething =
    row.medicineId !== null ||
    row.medicineName.trim() !== '' ||
    row.search.trim() !== '' ||
    row.dose.trim() !== '' ||
    row.frequency.trim() !== '' ||
    row.duration.trim() !== '' ||
    row.instructions.trim() !== '';
  return typedSomething ? 'incomplete' : 'blank';
}

export type RxMissing = 'medicineListed' | 'medicineFree' | 'dose' | 'frequency' | 'duration';

/** What a typed line still lacks to be saved (in the order the doctor fills it). */
export function rxMissing(row: RxDraft): RxMissing[] {
  const out: RxMissing[] = [];
  if (row.mode === 'LISTED' ? row.medicineId === null : row.medicineName.trim() === '') {
    out.push(row.mode === 'LISTED' ? 'medicineListed' : 'medicineFree');
  }
  if (row.dose.trim() === '') {
    out.push('dose');
  }
  if (row.frequency.trim() === '') {
    out.push('frequency');
  }
  if (row.duration.trim() === '') {
    out.push('duration');
  }
  return out;
}

/** The rows that can be saved, and how many typed rows are still unfinished. */
export function toRxPayload(rows: RxDraft[]): {
  items: PrescriptionItemPayload[];
  incomplete: number;
} {
  const items: PrescriptionItemPayload[] = [];
  let incomplete = 0;
  for (const row of rows) {
    const state = rxRowState(row);
    if (state === 'incomplete') {
      incomplete += 1;
    }
    if (state !== 'complete') {
      continue;
    }
    const instructions = row.instructions.trim();
    items.push({
      ...(row.mode === 'LISTED'
        ? { medicineId: row.medicineId as string }
        : { medicineName: row.medicineName.trim() }),
      dose: row.dose.trim(),
      frequency: row.frequency.trim(),
      duration: row.duration.trim(),
      ...(instructions ? { instructions } : {}),
    });
  }
  return { items, incomplete };
}

/** Saved rows from the server become editable rows (ids start after `firstId`). */
export function rxFromView(rows: PrescriptionRowView[], firstId = 1): RxDraft[] {
  return rows.map((r, index) => ({
    id: firstId + index,
    mode: r.isUnlisted ? 'FREE' : 'LISTED',
    medicineId: r.medicineId,
    medicineName: r.medicineName,
    search: '',
    dose: r.dose,
    frequency: r.frequency,
    duration: r.duration,
    instructions: r.instructions ?? '',
  }));
}
