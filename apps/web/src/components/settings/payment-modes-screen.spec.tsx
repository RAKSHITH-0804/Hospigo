import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PaymentModesScreen } from '@/components/settings/payment-modes-screen';
import { staffCopy } from '@/config/staff-copy';
import type { PaymentModeRow } from '@/lib/masters/types';

const listMock = jest.fn();
const addMock = jest.fn();
const changeMock = jest.fn();
jest.mock('@/lib/masters/client', () => ({
  listPaymentModes: (...a: unknown[]) => listMock(...a),
  addPaymentMode: (...a: unknown[]) => addMock(...a),
  changePaymentMode: (...a: unknown[]) => changeMock(...a),
}));

const copy = staffCopy.masters.paymentModes;
const errors = staffCopy.masters.errors;

const mode = (over: Partial<PaymentModeRow> = {}): PaymentModeRow => ({
  id: 'm-cash',
  code: 'CASH',
  name: 'Cash',
  requiresReference: false,
  active: true,
  isDefault: true,
  paymentsCount: 12,
  ...over,
});
const upi = mode({
  id: 'm-upi',
  code: 'UPI',
  name: 'UPI',
  requiresReference: true,
  isDefault: false,
  paymentsCount: 3,
});

const renderScreen = (items = [mode(), upi]) =>
  render(<PaymentModesScreen initial={{ items }} initialErrorCode={null} />);

beforeEach(() => {
  listMock.mockReset();
  addMock.mockReset();
  changeMock.mockReset();
});

describe('PaymentModesScreen', () => {
  it('lists the modes with the reference rule, status and how often each was used; cash has no Deactivate', () => {
    renderScreen();
    const table = screen.getByRole('table', { name: copy.title });
    expect(within(table).getByText('Cash')).toBeTruthy();
    expect(within(table).getByText(copy.referenceYes)).toBeTruthy();
    expect(within(table).getByText(copy.referenceNo)).toBeTruthy();
    expect(within(table).getByText(copy.usedCount.replace('{n}', '3'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Cash: ${copy.deactivate}` })).toBeNull();
    expect(screen.getByRole('button', { name: `UPI: ${copy.deactivate}` })).toBeTruthy();
  });

  it('says so when it could not load and offers to try again', async () => {
    render(<PaymentModesScreen initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    listMock.mockResolvedValue({ ok: true, data: { items: [mode()] } });
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('Cash')).toBeTruthy();
  });

  it('shows an empty state with the Add button when there is no mode', () => {
    renderScreen([]);
    expect(screen.getByText(copy.empty)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.add })).toBeTruthy();
  });

  it('Add opens a pop-up; the new mode is sent and listed', async () => {
    addMock.mockResolvedValue({
      ok: true,
      data: mode({
        id: 'm-neft',
        code: 'NEFT',
        name: 'Bank transfer',
        isDefault: false,
        paymentsCount: 0,
      }),
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog', { name: copy.addTitle });
    fireEvent.change(within(dialog).getByLabelText(copy.codeLabel), { target: { value: 'neft' } });
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'Bank transfer' },
    });
    fireEvent.click(within(dialog).getByLabelText(copy.referenceLabel));
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock).toHaveBeenCalledWith({
      code: 'neft',
      name: 'Bank transfer',
      requiresReference: true,
    });
    expect(await screen.findByText(copy.added)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
  });

  it('Edit shows the code as fixed and sends only the name and the reference flag', async () => {
    changeMock.mockResolvedValue({ ok: true, data: { ...upi, name: 'UPI payment' } });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `UPI: ${copy.edit}` }));
    const dialog = screen.getByRole('dialog', { name: copy.editTitle.replace('{name}', 'UPI') });
    expect(within(dialog).queryByLabelText(copy.codeLabel)).toBeNull();
    expect(within(dialog).getByText(copy.codeFixed.replace('{code}', 'UPI'))).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'UPI payment' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith('m-upi', {
        name: 'UPI payment',
        requiresReference: true,
      }),
    );
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    expect(screen.getByText('UPI payment')).toBeTruthy();
  });

  it('a refusal is shown inside the pop-up and what was typed stays', async () => {
    addMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'MASTER_CONFLICT',
      reason: 'CODE_USED',
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.codeLabel), { target: { value: 'CASH' } });
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), { target: { value: 'Again' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(errors.conflicts.CODE_USED);
    expect((within(dialog).getByLabelText(copy.nameLabel) as HTMLInputElement).value).toBe('Again');
  });

  it('Deactivate and Activate call the API and show the new state; a refusal is shown calmly', async () => {
    changeMock.mockResolvedValueOnce({ ok: true, data: { ...upi, active: false } });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `UPI: ${copy.deactivate}` }));
    await waitFor(() => expect(changeMock).toHaveBeenCalledWith('m-upi', { active: false }));
    expect(await screen.findByText(copy.deactivated.replace('{name}', 'UPI'))).toBeTruthy();
    expect(screen.getByText(copy.statusInactive)).toBeTruthy();
    changeMock.mockResolvedValueOnce({ ok: true, data: { ...upi, active: true } });
    fireEvent.click(screen.getByRole('button', { name: `UPI: ${copy.activate}` }));
    expect(await screen.findByText(copy.activated.replace('{name}', 'UPI'))).toBeTruthy();
    changeMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: 'MASTER_CONFLICT',
      reason: 'LAST_ACTIVE',
    });
    fireEvent.click(screen.getByRole('button', { name: `UPI: ${copy.deactivate}` }));
    expect((await screen.findByRole('alert')).textContent).toBe(errors.conflicts.LAST_ACTIVE);
  });

  it('sends one request for a double click on Save', async () => {
    let finish: (v: unknown) => void = () => {};
    addMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.codeLabel), {
      target: { value: 'WALLET' },
    });
    fireEvent.change(within(dialog).getByLabelText(copy.nameLabel), {
      target: { value: 'Wallet' },
    });
    const save = within(dialog).getByRole('button', { name: copy.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(addMock).toHaveBeenCalledTimes(1);
    finish({ ok: false, status: 400, code: 'MASTER_INVALID', reason: 'REQUIRED' });
    await within(dialog).findByRole('alert');
  });
});
