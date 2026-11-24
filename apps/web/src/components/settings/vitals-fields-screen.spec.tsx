import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VitalsFieldsScreen } from '@/components/settings/vitals-fields-screen';
import { staffCopy } from '@/config/staff-copy';
import type { VitalsFieldRow } from '@/lib/masters/types';

const listMock = jest.fn();
const addMock = jest.fn();
const changeMock = jest.fn();
const reorderMock = jest.fn();
jest.mock('@/lib/masters/client', () => ({
  listVitalsFields: (...a: unknown[]) => listMock(...a),
  addVitalsField: (...a: unknown[]) => addMock(...a),
  changeVitalsField: (...a: unknown[]) => changeMock(...a),
  reorderVitalsFields: (...a: unknown[]) => reorderMock(...a),
}));

const copy = staffCopy.masters.vitals;
const errors = staffCopy.masters.errors;

const field = (over: Partial<VitalsFieldRow> = {}): VitalsFieldRow => ({
  id: 'f-pulse',
  code: 'pulse',
  name: 'Pulse',
  unit: 'bpm',
  valueKind: 'NUMBER',
  displayOrder: 1,
  warnMin: 50,
  warnMax: 120,
  active: true,
  readingsCount: 4,
  ...over,
});
const spo2 = field({
  id: 'f-spo2',
  code: 'spo2',
  name: 'SpO2',
  unit: '%',
  displayOrder: 2,
  warnMin: 90,
  warnMax: 100,
});
const notes = field({
  id: 'f-notes',
  code: 'notes',
  name: 'Remarks',
  unit: '-',
  valueKind: 'TEXT',
  displayOrder: 3,
  warnMin: null,
  warnMax: null,
});

const renderScreen = (items = [field(), spo2, notes]) =>
  render(<VitalsFieldsScreen initial={{ items }} initialErrorCode={null} />);

beforeEach(() => {
  for (const m of [listMock, addMock, changeMock, reorderMock]) m.mockReset();
});

describe('VitalsFieldsScreen', () => {
  it('lists the fields with unit, type and the usual range; the first cannot move up, the last cannot move down', () => {
    renderScreen();
    const table = screen.getByRole('table', { name: copy.title });
    expect(within(table).getByText('50 to 120')).toBeTruthy();
    expect(within(table).getByText(copy.noRange)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: `Pulse: ${copy.moveUp}` }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: `Remarks: ${copy.moveDown}` }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('says so when it could not load and offers to try again; an empty list shows the Add button', async () => {
    const failed = render(<VitalsFieldsScreen initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    listMock.mockResolvedValue({ ok: true, data: { items: [field()] } });
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Pulse')).toBeTruthy();
    failed.unmount();
    renderScreen([]);
    expect(screen.getByText(copy.empty)).toBeTruthy();
  });

  it('Add opens a pop-up; a number field is sent with its range and listed', async () => {
    addMock.mockResolvedValue({
      ok: true,
      data: field({
        id: 'f-glu',
        code: 'glucose',
        name: 'Blood sugar',
        unit: 'mg/dL',
        displayOrder: 4,
        warnMin: 70,
        warnMax: 180,
        readingsCount: 0,
      }),
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog', { name: copy.addTitle });
    fireEvent.change(within(dialog).getByLabelText(copy.codeLabel), {
      target: { value: 'glucose' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'Blood sugar' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.unitLabel), { target: { value: 'mg/dL' } });
    fireEvent.change(within(dialog).getByLabelText(copy.warnMinLabel), { target: { value: '70' } });
    fireEvent.change(within(dialog).getByLabelText(copy.warnMaxLabel), {
      target: { value: '180' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock).toHaveBeenCalledWith({
      code: 'glucose',
      name: 'Blood sugar',
      unit: 'mg/dL',
      valueKind: 'NUMBER',
      warnMin: 70,
      warnMax: 180,
    });
    expect(await screen.findByText(copy.added)).toBeTruthy();
    expect(screen.getByText('Blood sugar')).toBeTruthy();
  });

  it('a text field takes no range: the range boxes disappear and nothing is sent for them', async () => {
    addMock.mockResolvedValue({ ok: true, data: notes });
    renderScreen([field()]);
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.kindLabel), { target: { value: 'TEXT' } });
    expect(within(dialog).queryByLabelText(copy.warnMinLabel)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(copy.codeLabel), { target: { value: 'notes' } });
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'Remarks' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.unitLabel), { target: { value: '-' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() => expect(addMock).toHaveBeenCalled());
    expect(addMock.mock.calls[0]![0]).toMatchObject({
      valueKind: 'TEXT',
      warnMin: null,
      warnMax: null,
    });
  });

  it('a limit that is not a number is refused before anything is sent', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Pulse: ${copy.edit}` }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.warnMinLabel), {
      target: { value: 'abc' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect(within(dialog).getByRole('alert').textContent).toBe(copy.errorNotANumber);
    expect(changeMock).not.toHaveBeenCalled();
  });

  it('Edit keeps the code and type fixed, sends name, unit and range, and clears a limit when it is emptied', async () => {
    changeMock.mockResolvedValue({ ok: true, data: field({ name: 'Heart rate', warnMin: null }) });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Pulse: ${copy.edit}` }));
    const dialog = screen.getByRole('dialog', { name: copy.editTitle.replace('{name}', 'Pulse') });
    expect(within(dialog).queryByLabelText(copy.codeLabel)).toBeNull();
    expect(
      within(dialog).getByText(
        copy.codeFixed.replace('{code}', 'pulse').replace('{kind}', copy.kindNumber),
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'Heart rate' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.warnMinLabel), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith('f-pulse', {
        name: 'Heart rate',
        unit: 'bpm',
        warnMin: null,
        warnMax: 120,
      }),
    );
    expect(await screen.findByText(copy.saved)).toBeTruthy();
  });

  it('a refusal of the API is shown inside the pop-up', async () => {
    changeMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'MASTER_INVALID',
      reason: 'MAX_NOT_ABOVE_MIN',
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Pulse: ${copy.edit}` }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      errors.reasons.MAX_NOT_ABOVE_MIN,
    );
  });

  it('the arrows put the fields in a new order using the complete list of ids', async () => {
    reorderMock.mockResolvedValue({
      ok: true,
      data: { items: [spo2, field(), notes] },
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `SpO2: ${copy.moveUp}` }));
    await waitFor(() => expect(reorderMock).toHaveBeenCalledWith(['f-spo2', 'f-pulse', 'f-notes']));
    await waitFor(() =>
      expect(screen.getAllByText(/^(Pulse|SpO2|Remarks)$/).map((e) => e.textContent)).toEqual([
        'SpO2',
        'Pulse',
        'Remarks',
      ]),
    );
  });

  it('Deactivate and Activate call the API; the page tells what happened', async () => {
    changeMock.mockResolvedValueOnce({ ok: true, data: { ...spo2, active: false } });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `SpO2: ${copy.deactivate}` }));
    await waitFor(() => expect(changeMock).toHaveBeenCalledWith('f-spo2', { active: false }));
    expect(await screen.findByText(copy.deactivated.replace('{name}', 'SpO2'))).toBeTruthy();
    changeMock.mockResolvedValueOnce({ ok: true, data: { ...spo2, active: true } });
    fireEvent.click(screen.getByRole('button', { name: `SpO2: ${copy.activate}` }));
    expect(await screen.findByText(copy.activated.replace('{name}', 'SpO2'))).toBeTruthy();
  });
});
