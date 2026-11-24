import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PrintValuesScreen } from '@/components/settings/print-values-screen';
import { staffCopy } from '@/config/staff-copy';
import type { PrintValueRow, PrintValuesManageResponse } from '@/lib/print-values/types';

const listMock = jest.fn();
const addMock = jest.fn();
const changeMock = jest.fn();
jest.mock('@/lib/print-values/client', () => ({
  listPrintValues: (...a: unknown[]) => listMock(...a),
  addPrintValue: (...a: unknown[]) => addMock(...a),
  changePrintValue: (...a: unknown[]) => changeMock(...a),
}));

const copy = staffCopy.printValues;
const limits = { keyMax: 30, labelMax: 60, valueMax: 200, perScopeMax: 30 };

const row = (over: Partial<PrintValueRow> = {}): PrintValueRow => ({
  id: 'v1',
  key: 'helpline',
  field: 'value.helpline',
  label: 'Helpline',
  value: '1800 000 000',
  active: true,
  scope: 'HOSPITAL',
  ...over,
});
const data = (
  items: PrintValueRow[] = [row()],
  canChange = { branch: true, hospital: true },
): PrintValuesManageResponse => ({ items, canChange, limits });

const renderScreen = (
  initial: PrintValuesManageResponse | null = data(),
  code: string | null = null,
) => render(<PrintValuesScreen initial={initial} initialErrorCode={code} />);

beforeEach(() => {
  listMock.mockReset();
  addMock.mockReset();
  changeMock.mockReset();
});

describe('PrintValuesScreen', () => {
  it('lists the values with their template name, text, place and state', () => {
    renderScreen(
      data([
        row(),
        row({
          id: 'v2',
          key: 'ward',
          field: 'value.ward',
          label: 'Ward',
          value: 'East wing',
          scope: 'BRANCH',
          active: false,
        }),
      ]),
    );
    expect(screen.getByText('value.helpline')).toBeTruthy();
    expect(screen.getByText('1800 000 000')).toBeTruthy();
    expect(screen.getByText(copy.statusActive)).toBeTruthy();
    expect(screen.getByText(copy.statusInactive)).toBeTruthy();
    expect(screen.getByText('East wing')).toBeTruthy();
  });

  it('says so when there are no values yet', () => {
    renderScreen(data([]));
    expect(screen.getByText(copy.empty)).toBeTruthy();
  });

  it('a hospital-wide Admin adds a value in a pop-up and chooses where it applies', async () => {
    addMock.mockResolvedValue({
      ok: true,
      data: row({
        id: 'v9',
        key: 'nabh',
        field: 'value.nabh',
        label: 'NABH',
        value: 'N-1',
        scope: 'BRANCH',
      }),
    });
    renderScreen(data([]));
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.keyLabel), { target: { value: 'nabh' } });
    fireEvent.change(within(dialog).getByLabelText(copy.labelLabel), { target: { value: 'NABH' } });
    fireEvent.change(within(dialog).getByLabelText(copy.valueLabel), { target: { value: 'N-1' } });
    fireEvent.change(within(dialog).getByLabelText(copy.scopeLabel), {
      target: { value: 'branch' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith({ key: 'nabh', label: 'NABH', value: 'N-1' }, 'branch'),
    );
    expect(await screen.findByText(copy.added)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('value.nabh')).toBeTruthy();
  });

  it('a Branch Admin has no choice of place: this branch only, with a note, and cannot touch hospital values', async () => {
    addMock.mockResolvedValue({
      ok: true,
      data: row({ id: 'v3', key: 'ward', field: 'value.ward', label: 'Ward', scope: 'BRANCH' }),
    });
    renderScreen(data([row()], { branch: true, hospital: false }));
    // the hospital value shows, but has no Edit / Deactivate for this person
    expect(screen.queryByRole('button', { name: `Helpline: ${copy.edit}` })).toBeNull();
    expect(screen.getByText(copy.hospitalOnly)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(copy.scopeLabel)).toBeNull();
    expect(within(dialog).getByText(copy.onlyBranch)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(copy.keyLabel), { target: { value: 'ward' } });
    fireEvent.change(within(dialog).getByLabelText(copy.labelLabel), { target: { value: 'Ward' } });
    fireEvent.change(within(dialog).getByLabelText(copy.valueLabel), { target: { value: 'East' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() => expect(addMock.mock.calls[0]![1]).toBe('branch'));
  });

  it('a reader sees the list and no Add button', () => {
    renderScreen(data([row()], { branch: false, hospital: false }));
    expect(screen.queryByRole('button', { name: copy.add })).toBeNull();
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
  });

  it('editing changes the name and text only; the code is shown as fixed', async () => {
    changeMock.mockResolvedValue({
      ok: true,
      data: row({ label: 'Help line', value: '1800 111 111' }),
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Helpline: ${copy.edit}` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(copy.keyLabel)).toBeNull();
    expect(
      within(dialog).getByText(copy.keyFixed.replace('{field}', 'value.helpline')),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(copy.labelLabel), {
      target: { value: 'Help line' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.valueLabel), {
      target: { value: '1800 111 111' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith('v1', { label: 'Help line', value: '1800 111 111' }),
    );
    expect(await screen.findByText('1800 111 111')).toBeTruthy();
  });

  it('shows a calm sentence inside the pop-up when the API refuses, and keeps what was typed', async () => {
    addMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'PRINT_VALUE_INVALID',
      reason: 'NOT_PLAIN_TEXT',
    });
    renderScreen(data([]));
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.keyLabel), { target: { value: 'x1' } });
    fireEvent.change(within(dialog).getByLabelText(copy.labelLabel), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText(copy.valueLabel), {
      target: { value: '<b>x</b>' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      copy.errors.reasons.NOT_PLAIN_TEXT,
    );
    expect((within(dialog).getByLabelText(copy.valueLabel) as HTMLInputElement).value).toBe(
      '<b>x</b>',
    );
  });

  it('a duplicate code shows the conflict sentence', async () => {
    addMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'PRINT_VALUE_CONFLICT',
      reason: 'KEY_EXISTS',
    });
    renderScreen(data([]));
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      copy.errors.conflicts.KEY_EXISTS,
    );
  });

  it('Deactivate and Activate switch the value and confirm in words', async () => {
    changeMock.mockResolvedValueOnce({ ok: true, data: row({ active: false }) });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Helpline: ${copy.deactivate}` }));
    expect(await screen.findByText(copy.deactivated.replace('{name}', 'Helpline'))).toBeTruthy();
    expect(changeMock).toHaveBeenCalledWith('v1', { active: false });
    changeMock.mockResolvedValueOnce({ ok: true, data: row({ active: true }) });
    fireEvent.click(screen.getByRole('button', { name: `Helpline: ${copy.activate}` }));
    expect(await screen.findByText(copy.activated.replace('{name}', 'Helpline'))).toBeTruthy();
  });

  it('a refused switch (another Admin or no right) shows the sentence', async () => {
    changeMock.mockResolvedValue({ ok: false, status: 403, code: 'PRINT_SCOPE_FORBIDDEN' });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `Helpline: ${copy.deactivate}` }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.scopeForbidden);
  });

  it('a load failure shows a calm message and Try again reloads the list', async () => {
    renderScreen(null, 'UNAVAILABLE');
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    listMock.mockResolvedValue({ ok: true, data: data() });
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('value.helpline')).toBeTruthy();
  });
});
