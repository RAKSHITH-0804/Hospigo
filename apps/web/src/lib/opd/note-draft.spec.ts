import { canCompleteNote, EMPTY_NOTE, noteFromView, noteToBody } from './note-draft';
import { makeNote } from './clinical-test-fixtures';

describe('note draft', () => {
  it('turns a saved note into text boxes and back (empty boxes are left out)', () => {
    expect(noteFromView(null)).toEqual(EMPTY_NOTE);
    const draft = noteFromView(
      makeNote({
        complaints: 'fever',
        diagnosis: null,
        advice: 'rest',
        followUpDate: '2026-11-25',
      }),
    );
    expect(draft).toEqual({
      complaints: 'fever',
      diagnosis: '',
      advice: 'rest',
      followUpDate: '2026-11-25',
    });
    expect(noteToBody(draft)).toEqual({
      complaints: 'fever',
      advice: 'rest',
      followUpDate: '2026-11-25',
    });
    expect(noteToBody({ ...EMPTY_NOTE, diagnosis: '   ' })).toEqual({});
  });

  it('can be completed only with complaints or diagnosis text', () => {
    expect(canCompleteNote(EMPTY_NOTE)).toBe(false);
    expect(canCompleteNote({ ...EMPTY_NOTE, advice: 'rest' })).toBe(false);
    expect(canCompleteNote({ ...EMPTY_NOTE, complaints: ' ' })).toBe(false);
    expect(canCompleteNote({ ...EMPTY_NOTE, complaints: 'cough' })).toBe(true);
    expect(canCompleteNote({ ...EMPTY_NOTE, diagnosis: 'cold' })).toBe(true);
  });
});
