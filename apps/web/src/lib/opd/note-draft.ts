import type { NoteBody, NoteView } from './clinical-types';

/** The four note fields as text boxes (an empty box is an empty string). */
export type NoteDraft = {
  complaints: string;
  diagnosis: string;
  advice: string;
  followUpDate: string;
};

export const EMPTY_NOTE: NoteDraft = {
  complaints: '',
  diagnosis: '',
  advice: '',
  followUpDate: '',
};

export function noteFromView(note: NoteView | null): NoteDraft {
  return {
    complaints: note?.complaints ?? '',
    diagnosis: note?.diagnosis ?? '',
    advice: note?.advice ?? '',
    followUpDate: note?.followUpDate ?? '',
  };
}

/** The API replaces all four fields, so empty boxes are left out (they become empty). */
export function noteToBody(draft: NoteDraft): NoteBody {
  const body: NoteBody = {};
  if (draft.complaints.trim() !== '') {
    body.complaints = draft.complaints;
  }
  if (draft.diagnosis.trim() !== '') {
    body.diagnosis = draft.diagnosis;
  }
  if (draft.advice.trim() !== '') {
    body.advice = draft.advice;
  }
  if (draft.followUpDate !== '') {
    body.followUpDate = draft.followUpDate;
  }
  return body;
}

/** A note can be completed only when complaints or diagnosis hold text (the API checks too). */
export function canCompleteNote(draft: NoteDraft): boolean {
  return draft.complaints.trim() !== '' || draft.diagnosis.trim() !== '';
}
