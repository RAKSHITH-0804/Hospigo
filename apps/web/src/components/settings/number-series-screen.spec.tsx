import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NumberSeriesScreen } from '@/components/settings/number-series-screen';
import { staffCopy } from '@/config/staff-copy';
import type { SeriesResponse, SeriesRow } from '@/lib/masters/types';

const listMock = jest.fn();
const changeMock = jest.fn();
const startMock = jest.fn();
jest.mock('@/lib/masters/client', () => ({
  listNumberSeries: (...a: unknown[]) => listMock(...a),
  changeNumberSeries: (...a: unknown[]) => changeMock(...a),
  raiseStartNumber: (...a: unknown[]) => startMock(...a),
}));

const copy = staffCopy.masters.numberSeries;
const errors = staffCopy.masters.errors;

const bill = (over: Partial<SeriesRow> = {}): SeriesRow => ({
  series: 'BILL',
  configured: true,
  editable: true,
  prefix: 'B',
  separator: '/',
  fyStyle: 'SHORT',
  width: 5,
  resetRule: 'FINANCIAL_YEAR',
  fyStartMonth: 4,
  locked: false,
  lastNumber: '0',
  next: 'B2627/00001',
  ...over,
});
const receipt = bill({ series: 'RECEIPT', prefix: 'R', next: 'R2627/00001' });
const refund: SeriesRow = {
  ...bill({ series: 'REFUND' }),
  configured: false,
  editable: false,
  next: '',
};

const data = (items: SeriesRow[] = [bill(), receipt, refund]): SeriesResponse => ({
  items,
  today: '2026-11-24',
});
const renderScreen = (items?: SeriesRow[]) =>
  render(<NumberSeriesScreen initial={data(items)} initialErrorCode={null} />);

beforeEach(() => {
  for (const m of [listMock, changeMock, startMock]) m.mockReset();
});

describe('NumberSeriesScreen', () => {
  it('shows each series with its next number, the count rule and what is not set up', () => {
    renderScreen();
    const billCard = screen.getByRole('listitem', { name: copy.names.BILL });
    expect(within(billCard).getByText('B2627/00001')).toBeTruthy();
    expect(within(billCard).getByText(copy.resetYear.replace('{month}', 'April'))).toBeTruthy();
    expect(
      within(screen.getByRole('listitem', { name: copy.names.REFUND })).getByText(
        copy.notConfigured,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: `${copy.names.REFUND}: ${copy.changeFormat}` }),
    ).toBeNull();
  });

  it('says so when it could not load and offers to try again', async () => {
    render(<NumberSeriesScreen initial={null} initialErrorCode="FORBIDDEN" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    listMock.mockResolvedValue({ ok: true, data: data() });
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText('B2627/00001')).toBeTruthy();
  });

  it('a locked series says so, and a series of another shape has no Change format button', () => {
    renderScreen([
      bill({ locked: true, lastNumber: '41', next: 'B2627/00042' }),
      bill({ series: 'RECEIPT', editable: false, prefix: '' }),
      refund,
    ]);
    expect(screen.getByText(copy.lockedNote)).toBeTruthy();
    expect(screen.getByText(copy.customNote)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: `${copy.names.RECEIPT}: ${copy.changeFormat}` }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: `${copy.names.RECEIPT}: ${copy.setStart}` }),
    ).toBeTruthy();
  });

  it('Change format shows a live preview while typing and sends only what changed', async () => {
    changeMock.mockResolvedValue({
      ok: true,
      data: bill({ prefix: 'INV', width: 6, next: 'INV2627/000001' }),
    });
    renderScreen();
    fireEvent.click(
      screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.changeFormat}` }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('status').textContent).toContain('B2627/00001');
    fireEvent.change(within(dialog).getByLabelText(copy.prefixLabel), { target: { value: 'INV' } });
    fireEvent.change(within(dialog).getByLabelText(copy.widthLabel), { target: { value: '6' } });
    expect(within(dialog).getByRole('status').textContent).toContain('INV2627/000001');
    fireEvent.change(within(dialog).getByLabelText(copy.fyStyleLabel), {
      target: { value: 'LONG' },
    });
    expect(within(dialog).getByRole('status').textContent).toContain('INV2026-27/000001');
    fireEvent.change(within(dialog).getByLabelText(copy.fyStyleLabel), {
      target: { value: 'SHORT' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    await waitFor(() => expect(changeMock).toHaveBeenCalledTimes(1));
    expect(changeMock).toHaveBeenCalledWith('BILL', { prefix: 'INV', width: 6 });
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    expect(screen.getByText('INV2627/000001')).toBeTruthy();
  });

  it('the preview follows the financial year start when the series is not locked', () => {
    renderScreen();
    fireEvent.click(
      screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.changeFormat}` }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.monthLabel), { target: { value: '12' } });
    expect(within(dialog).getByRole('status').textContent).toContain('B2526/00001');
  });

  it('once numbers exist the count rule and the year start cannot be changed, and the preview continues the count', () => {
    renderScreen([bill({ locked: true, lastNumber: '41', next: 'B2627/00042' }), receipt, refund]);
    fireEvent.click(
      screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.changeFormat}` }),
    );
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(copy.resetLabel) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((within(dialog).getByLabelText(copy.monthLabel) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(within(dialog).getByText(copy.lockedHint)).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toContain('B2627/00042');
  });

  it('closing without a change sends nothing; a refusal is shown inside the pop-up', async () => {
    renderScreen();
    fireEvent.click(
      screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.changeFormat}` }),
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.save }));
    expect(changeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    changeMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'MASTER_CONFLICT',
      reason: 'NUMBER_EXISTS',
    });
    fireEvent.click(
      screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.changeFormat}` }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.prefixLabel), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.save }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      errors.conflicts.NUMBER_EXISTS,
    );
  });

  it('Set start number previews the number it will give, needs a whole number and sends it with the reason', async () => {
    startMock.mockResolvedValue({
      ok: true,
      data: bill({ locked: true, lastNumber: '999', next: 'B2627/01000' }),
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.setStart}` }));
    const dialog = screen.getByRole('dialog', {
      name: copy.startTitle.replace('{name}', copy.names.BILL ?? ''),
    });
    fireEvent.change(within(dialog).getByLabelText(copy.startLabel), { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.saveStart }));
    expect(within(dialog).getByRole('alert').textContent).toBe(copy.startInvalid);
    expect(startMock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(copy.startLabel), { target: { value: '1000' } });
    expect(within(dialog).getByRole('status').textContent).toContain('B2627/01000');
    fireEvent.change(within(dialog).getByLabelText(copy.reasonLabel), {
      target: { value: 'Paper book' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.saveStart }));
    await waitFor(() =>
      expect(startMock).toHaveBeenCalledWith('BILL', { startNumber: 1000, reason: 'Paper book' }),
    );
    expect(await screen.findByText(copy.startSaved)).toBeTruthy();
    expect(screen.getByText('B2627/01000')).toBeTruthy();
  });

  it('a start number that lowers the count is refused in plain words', async () => {
    startMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'MASTER_CONFLICT',
      reason: 'NOT_RAISING',
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: `${copy.names.BILL}: ${copy.setStart}` }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(copy.startLabel), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText(copy.reasonLabel), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.saveStart }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      errors.conflicts.NOT_RAISING,
    );
  });
});
