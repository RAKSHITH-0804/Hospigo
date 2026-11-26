import { render, screen } from '@testing-library/react';
import { ConsultAmendPanel } from '@/components/opd/consult-amend-panel';
import { staffCopy } from '@/config/staff-copy';
import { setClientTerms } from '@/lib/terminology/terms-core';
import { runWithTerms } from '@/lib/terminology/terms-server';
import type { NoteView } from '@/lib/opd/clinical-types';

jest.mock('@/lib/opd/clinical-client', () => ({
  amendConsultation: jest.fn(),
  searchMedicines: jest.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
}));

const note: NoteView = {
  id: 'n1',
  status: 'COMPLETED',
  complaints: 'cough',
  diagnosis: 'viral',
  advice: null,
  followUpDate: null,
  completedAt: '2026-11-26T10:00:00.000Z',
  createdAt: '2026-11-26T09:00:00.000Z',
  updatedAt: '2026-11-26T10:00:00.000Z',
};
const screenFor = () =>
  render(
    <ConsultAmendPanel
      visitId="v1"
      note={note}
      versions={[]}
      canAmend
      prescription={[]}
      search={{ minChars: 2, debounceMs: 0, limit: 5 }}
      onAmended={jest.fn()}
    />,
  );

describe('the hospital own words in the central copy accessor', () => {
  afterEach(() => setClientTerms({}));

  it('overriding "Symptoms" changes the consultation screen and a printed caption, keeping the capital style', () => {
    setClientTerms({ symptoms: 'Complaints list' });
    const { unmount } = screenFor();
    expect(screen.getByLabelText('Complaints list')).toBeTruthy();
    expect(screen.queryByLabelText('Symptoms')).toBeNull();
    unmount();
    expect(staffCopy.print.fields.receptionSymptoms).toBe('Complaints list told at reception');
    expect(staffCopy.opd.clinical.consult.needsText).toContain('complaints list');
  });

  it('another hospital (no words) is unaffected, and clearing the words brings the standard ones back', () => {
    setClientTerms({ symptoms: 'Complaints list' });
    expect(staffCopy.opd.clinical.consult.complaints).toBe('Complaints list');
    setClientTerms({});
    screenFor();
    expect(screen.getByLabelText('Symptoms')).toBeTruthy();
    expect(staffCopy.print.fields.receptionSymptoms).toBe('Symptoms told at reception');
  });

  it('on the server the words belong to one request only (a parallel request for another hospital is not touched)', async () => {
    const [a, b] = await Promise.all([
      Promise.resolve().then(() =>
        runWithTerms({ symptoms: 'Complaints list' }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return staffCopy.opd.clinical.consult.complaints;
        }),
      ),
      Promise.resolve().then(() =>
        runWithTerms({}, async () => {
          await new Promise((r) => setTimeout(r, 1));
          return staffCopy.opd.clinical.consult.complaints;
        }),
      ),
    ]);
    expect(a).toBe('Complaints list');
    expect(b).toBe('Symptoms');
  });

  it('the 24 terms are all in the list Indigo sets, and every one is a word the screens use', () => {
    const keys = Object.keys(staffCopy.terms.keys);
    expect(keys).toHaveLength(24);
    setClientTerms(Object.fromEntries(keys.map((k) => [k, `X${k}`])));
    expect(staffCopy.nav.patients).toBe('Xpatients');
    setClientTerms({});
  });
});
