import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PricesScreen } from '@/components/settings/prices-screen';
import { staffCopy } from '@/config/staff-copy';
import { staffScreenConfig } from '@/config/settings';
import type { PriceRow, PricesResponse } from '@/lib/prices/types';

const listMock = jest.fn();
const historyMock = jest.fn();
const changeMock = jest.fn();
jest.mock('@/lib/prices/client', () => ({
  listPrices: (...args: unknown[]) => listMock(...args),
  priceHistory: (...args: unknown[]) => historyMock(...args),
  changePrice: (...args: unknown[]) => changeMock(...args),
}));

const copy = staffCopy.prices;

const row = (over: Partial<PriceRow> = {}): PriceRow => ({
  key: 'item:t1',
  kind: 'INVESTIGATION',
  itemId: 't1',
  doctorProfileId: null,
  visitType: null,
  code: 'TA',
  name: 'Blood sugar',
  currentAmountPaise: 30_000,
  currentFrom: '2026-01-01T00:00:00.000Z',
  nextAmountPaise: null,
  nextFrom: null,
  ...over,
});

const data = (items: PriceRow[], over: Partial<PricesResponse> = {}): PricesResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  today: '2026-11-23',
  ...over,
});

const reg = row({
  key: 'item:r1',
  kind: 'REGISTRATION',
  itemId: 'r1',
  code: 'REG',
  name: 'Registration',
  currentAmountPaise: null,
  currentFrom: null,
});
const fee = row({
  key: 'fee:d1:NEW',
  kind: 'DOCTOR_FEE',
  itemId: null,
  doctorProfileId: 'd1',
  visitType: 'NEW',
  code: 'DR1',
  name: 'Dr Rao',
  currentAmountPaise: 50_000,
  nextAmountPaise: 60_000,
  nextFrom: '2026-12-01T00:00:00.000Z',
});

beforeEach(() => {
  listMock.mockReset();
  historyMock.mockReset();
  changeMock.mockReset();
  jest.useRealTimers();
});

describe('PricesScreen', () => {
  it('shows the rows: price now in rupees, the next scheduled price, and "No price yet" as a warning', () => {
    render(<PricesScreen initial={data([reg, row(), fee])} initialErrorCode={null} />);
    expect(screen.getByText('Blood sugar')).toBeTruthy();
    expect(screen.getByText('₹300.00')).toBeTruthy();
    expect(screen.getByText(copy.noPrice)).toBeTruthy();
    expect(screen.getByText('₹500.00')).toBeTruthy();
    expect(screen.getByText(/₹600\.00 from /)).toBeTruthy();
    expect(screen.getByRole('button', { name: `Registration: ${copy.setFirst}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Dr Rao: ${copy.change}` })).toBeTruthy();
  });

  it('shows a calm error when the first load failed, and the empty state', () => {
    const { unmount } = render(<PricesScreen initial={null} initialErrorCode="FORBIDDEN" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    unmount();
    render(<PricesScreen initial={null} initialErrorCode={null} />);
    expect(screen.getByRole('alert').textContent).toBe(copy.loadError);
  });

  it('shows the empty message when no price matches', () => {
    render(<PricesScreen initial={data([])} initialErrorCode={null} />);
    expect(screen.getByText(copy.empty)).toBeTruthy();
  });

  it('saves a new price in whole paise with the chosen date, closes the form and reloads the list', async () => {
    changeMock.mockResolvedValue({
      ok: true,
      data: {
        changed: true,
        previousAmountPaise: 30_000,
        price: { id: 'p', amountPaise: 35_050, effectiveFrom: 'x' },
      },
    });
    listMock.mockResolvedValue({ ok: true, data: data([row({ currentAmountPaise: 35_050 })]) });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.change}` }));
    const amount = screen.getByLabelText(copy.amountLabel) as HTMLInputElement;
    expect(amount.value).toBe('300.00');
    fireEvent.change(amount, { target: { value: '350.50' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(changeMock).toHaveBeenCalledTimes(1));
    expect(changeMock.mock.calls[0]![1]).toEqual({
      amountPaise: 35_050,
      effectiveFrom: '2026-11-23',
    });
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText(copy.amountLabel)).toBeNull());
  });

  it('refuses a price that is not rupees and paise before asking the server', () => {
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.change}` }));
    for (const bad of ['', 'abc', '10.555', '-5', '1e3']) {
      fireEvent.change(screen.getByLabelText(copy.amountLabel), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: copy.save }));
      expect(screen.getByText(copy.errors.invalidAmount)).toBeTruthy();
    }
    expect(changeMock).not.toHaveBeenCalled();
  });

  it('tells in plain words why the server refused (date rules) and keeps the form open', async () => {
    changeMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'PRICE_INVALID',
      field: 'effectiveFrom',
      reason: 'DATE_BEFORE_LATEST',
    });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.change}` }));
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      copy.errors.reasons.DATE_BEFORE_LATEST,
    );
    expect(screen.getByLabelText(copy.amountLabel)).toBeTruthy();
  });

  it('says so when the amount was already the latest price (nothing changed)', async () => {
    changeMock.mockResolvedValue({
      ok: true,
      data: {
        changed: false,
        previousAmountPaise: 30_000,
        price: { id: 'p', amountPaise: 30_000, effectiveFrom: 'x' },
      },
    });
    listMock.mockResolvedValue({ ok: true, data: data([row()]) });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.change}` }));
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    expect(await screen.findByText(copy.unchanged)).toBeTruthy();
  });

  it('does not send a double click twice', async () => {
    let finish: (v: unknown) => void = () => {};
    changeMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    listMock.mockResolvedValue({ ok: true, data: data([row()]) });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.change}` }));
    const form = screen.getByRole('button', { name: copy.save }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(changeMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({
        ok: true,
        data: {
          changed: true,
          previousAmountPaise: 1,
          price: { id: 'p', amountPaise: 1, effectiveFrom: 'x' },
        },
      });
    });
  });

  it('the first price of an item may start earlier; any later change may not start before today', () => {
    render(<PricesScreen initial={data([reg, row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Registration: ${copy.setFirst}` }));
    expect(screen.getByText(copy.setTitle.replace('{name}', 'Registration'))).toBeTruthy();
    expect((screen.getByLabelText(copy.amountLabel) as HTMLInputElement).value).toBe('');
  });

  it('shows the history of a row with the state of each version, and a calm error when it cannot load', async () => {
    historyMock.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            id: 'v2',
            amountPaise: 35_000,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            createdAt: 'x',
            createdByName: 'Asha',
            inEffect: true,
          },
          {
            id: 'v1',
            amountPaise: 30_000,
            effectiveFrom: '2025-01-01T00:00:00.000Z',
            createdAt: 'x',
            createdByName: null,
            inEffect: false,
          },
        ],
      },
    });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.history}` }));
    const panel = await screen.findByRole('region', { name: copy.history });
    expect(within(panel).getByText('₹350.00')).toBeTruthy();
    expect(within(panel).getByText(copy.stateInEffect)).toBeTruthy();
    expect(within(panel).getByText(copy.stateOld)).toBeTruthy();
    expect(within(panel).getByText('Asha')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: copy.close }));
    expect(screen.queryByRole('region', { name: copy.history })).toBeNull();

    historyMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'UNKNOWN' });
    fireEvent.click(screen.getByRole('button', { name: `Blood sugar: ${copy.history}` }));
    expect(await screen.findByText(copy.historyLoadError)).toBeTruthy();
  });

  it('search asks the API again after a short pause, from page 1', async () => {
    jest.useFakeTimers();
    listMock.mockResolvedValue({ ok: true, data: data([row()]) });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.change(screen.getByLabelText(copy.searchLabel), { target: { value: 'sug' } });
    expect(listMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(staffScreenConfig.searchDebounceMs + 10);
    });
    expect(listMock).toHaveBeenCalledWith({ q: 'sug', kind: '', page: 1 });
    fireEvent.change(screen.getByLabelText(copy.kindLabel), { target: { value: 'DOCTOR_FEE' } });
    await act(async () => {
      jest.advanceTimersByTime(staffScreenConfig.searchDebounceMs + 10);
    });
    expect(listMock).toHaveBeenLastCalledWith({ q: 'sug', kind: 'DOCTOR_FEE', page: 1 });
  });

  it('shows an error with a retry when the list cannot be reloaded', async () => {
    jest.useFakeTimers();
    listMock.mockResolvedValueOnce({ ok: false, status: 503, code: 'UNAVAILABLE' });
    render(<PricesScreen initial={data([row()])} initialErrorCode={null} />);
    fireEvent.change(screen.getByLabelText(copy.searchLabel), { target: { value: 'x' } });
    await act(async () => {
      jest.advanceTimersByTime(staffScreenConfig.searchDebounceMs + 10);
    });
    expect(screen.getByText(staffCopy.errors.unreachable)).toBeTruthy();
    listMock.mockResolvedValueOnce({ ok: true, data: data([row()]) });
    fireEvent.click(screen.getByRole('button', { name: staffCopy.states.retry }));
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
