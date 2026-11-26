import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConsultAmendPanel } from '@/components/opd/consult-amend-panel';
import { staffCopy } from '@/config/staff-copy';
import type { NoteView } from '@/lib/opd/clinical-types';

const amendMock = jest.fn();
jest.mock('@/lib/opd/clinical-client', () => ({
  amendConsultation: (...args: unknown[]) => amendMock(...args),
  searchMedicines: jest.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
}));

const SEARCH = { minChars: 2, debounceMs: 0, limit: 5 };
const RX_ROW = {
  lineNo: 1,
  medicineId: 'm1',
  medicineName: 'Paracetamol 500',
  isUnlisted: false,
  dose: '1 tablet',
  frequency: 'Twice a day',
  duration: '3 days',
  instructions: null,
};

const copy = staffCopy.opd.clinical.amend;
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

beforeEach(() => amendMock.mockReset());

describe('ConsultAmendPanel', () => {
  it('lists who changed the note and why, and says so when nothing changed', () => {
    const { unmount } = render(
      <ConsultAmendPanel
        visitId="v1"
        note={note}
        versions={[]}
        canAmend={false}
        prescription={[]}
        search={SEARCH}
        onAmended={jest.fn()}
      />,
    );
    expect(screen.getByText(copy.none)).toBeTruthy();
    expect(screen.queryByText(copy.formTitle)).toBeNull();
    unmount();
    render(
      <ConsultAmendPanel
        visitId="v1"
        note={note}
        versions={[
          {
            versionNo: 1,
            reason: 'typing mistake',
            editedBy: { id: 'u1', name: 'Asha Admin' },
            at: '2026-11-26T11:00:00.000Z',
          },
        ]}
        canAmend={false}
        prescription={[]}
        search={SEARCH}
        onAmended={jest.fn()}
      />,
    );
    expect(screen.getByText(/Asha Admin/)).toBeTruthy();
    expect(screen.getByText('Reason: typing mistake')).toBeTruthy();
  });

  it('an Admin needs a reason; the change is sent with the reason and the screen gets the new note', async () => {
    const onAmended = jest.fn();
    amendMock.mockResolvedValue({
      ok: true,
      data: {
        consultation: { ...note, diagnosis: 'bacterial', amended: true, currentVersion: 1 },
        versions: [],
        prescription: [],
      },
    });
    render(
      <ConsultAmendPanel
        visitId="v1"
        note={note}
        versions={[]}
        canAmend
        prescription={[]}
        search={SEARCH}
        onAmended={onAmended}
      />,
    );
    fireEvent.change(screen.getByLabelText(staffCopy.opd.clinical.consult.diagnosis), {
      target: { value: 'bacterial' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.reasonRequired));
    expect(amendMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(new RegExp(copy.reason)), {
      target: { value: 'culture result came back' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(onAmended).toHaveBeenCalledTimes(1));
    expect(amendMock).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ reason: 'culture result came back', diagnosis: 'bacterial' }),
    );
  });

  it('says plainly when nothing was changed', async () => {
    amendMock.mockResolvedValue({ ok: false, code: 'AMEND_NOTHING_CHANGED', status: 409 });
    render(
      <ConsultAmendPanel
        visitId="v1"
        note={note}
        versions={[]}
        canAmend
        prescription={[]}
        search={SEARCH}
        onAmended={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(new RegExp(copy.reason)), {
      target: { value: 'no change at all' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.nothingChanged));
  });

  it('sends the prescription only when it was changed, and not while a medicine line is unfinished', async () => {
    amendMock.mockResolvedValue({
      ok: true,
      data: {
        visit: {},
        doctorDetails: {},
        consultation: { ...note, currentVersion: 1 },
        versions: [],
        prescription: [RX_ROW],
        addenda: [],
      },
    });
    const { container } = render(
      <ConsultAmendPanel
        visitId="v1"
        note={note}
        versions={[]}
        canAmend
        prescription={[RX_ROW]}
        search={SEARCH}
        onAmended={jest.fn()}
      />,
    );
    const reason = screen.getByLabelText(new RegExp(copy.reason));
    fireEvent.change(reason, { target: { value: 'wrong diagnosis' } });
    fireEvent.change(screen.getByLabelText(staffCopy.opd.clinical.consult.diagnosis), {
      target: { value: 'bacterial' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(amendMock).toHaveBeenCalledTimes(1));
    expect(amendMock.mock.calls[0]![1]).not.toHaveProperty('prescription');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    // change the dose: the whole list goes with the change
    const dose = container.querySelector('input[id$="-dose"]') as HTMLInputElement;
    fireEvent.change(screen.getByLabelText(new RegExp(copy.reason)), {
      target: { value: 'dose was wrong' },
    });
    fireEvent.change(dose, { target: { value: '2 tablets' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(amendMock).toHaveBeenCalledTimes(2));
    const sent = amendMock.mock.calls[1]![1] as {
      prescription: Array<{ dose: string; medicineId: string }>;
    };
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(sent.prescription).toEqual([
      expect.objectContaining({ medicineId: 'm1', dose: '2 tablets' }),
    ]);
    // a half-filled line stops the save
    fireEvent.change(screen.getByLabelText(new RegExp(copy.reason)), {
      target: { value: 'dose was wrong again' },
    });
    const doseNow = container.querySelector('input[id$="-dose"]') as HTMLInputElement;
    fireEvent.change(doseNow, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.prescriptionIncomplete),
    );
    expect(amendMock).toHaveBeenCalledTimes(2);
  });
});
