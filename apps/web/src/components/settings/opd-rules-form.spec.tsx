import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpdRulesForm } from '@/components/settings/opd-rules-form';
import { staffCopy } from '@/config/staff-copy';
import type { OpdRules } from '@/lib/settings/types';

const saveMock = jest.fn();
jest.mock('@/lib/settings/client', () => ({
  saveOpdRules: (...args: unknown[]) => saveMock(...args),
}));

const copy = staffCopy.settings.opdRules;
const rules = (over: Partial<OpdRules> = {}): OpdRules => ({
  followUpFreeDays: 7,
  repeatVisitFreeHours: 0,
  persisted: true,
  limits: {
    followUpFreeDays: { min: 0, max: 365 },
    repeatVisitFreeHours: { min: 0, max: 8760 },
  },
  ...over,
});

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: copy.save }));

beforeEach(() => saveMock.mockReset());

describe('OpdRulesForm', () => {
  it('shows the saved values, and says so when they are only the standard ones', () => {
    const { unmount } = render(<OpdRulesForm initial={rules()} canWrite />);
    expect(input(copy.followUpLabel).value).toBe('7');
    expect(input(copy.repeatLabel).value).toBe('0');
    expect(screen.queryByText(copy.notSavedYet)).toBeNull();
    unmount();
    render(<OpdRulesForm initial={rules({ persisted: false })} canWrite />);
    expect(screen.getByText(copy.notSavedYet)).toBeTruthy();
  });

  it('saves both numbers as whole numbers and confirms', async () => {
    saveMock.mockResolvedValue({
      ok: true,
      data: rules({ followUpFreeDays: 10, repeatVisitFreeHours: 24 }),
    });
    render(<OpdRulesForm initial={rules({ persisted: false })} canWrite />);
    type(copy.followUpLabel, '10');
    type(copy.repeatLabel, '24');
    save();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(saveMock).toHaveBeenCalledWith({ followUpFreeDays: 10, repeatVisitFreeHours: 24 });
    expect(screen.queryByText(copy.notSavedYet)).toBeNull();
    // typing again takes the confirmation away
    type(copy.followUpLabel, '11');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sends the default paper and the patient card setting only when they changed', async () => {
    saveMock.mockResolvedValue({
      ok: true,
      data: rules({ defaultPrintPaper: 'A4', patientCardAutoPrint: true }),
    });
    render(
      <OpdRulesForm
        initial={rules({ defaultPrintPaper: 'A5', patientCardAutoPrint: false })}
        canWrite
      />,
    );
    fireEvent.change(screen.getByLabelText(copy.paperLabel), { target: { value: 'A4' } });
    fireEvent.click(screen.getByLabelText(copy.cardLabel));
    save();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith({
      followUpFreeDays: 7,
      repeatVisitFreeHours: 0,
      defaultPrintPaper: 'A4',
      patientCardAutoPrint: true,
    });
  });

  it('accepts the smallest and the largest allowed numbers', async () => {
    saveMock.mockResolvedValue({ ok: true, data: rules() });
    render(<OpdRulesForm initial={rules()} canWrite />);
    type(copy.followUpLabel, '365');
    type(copy.repeatLabel, '8760');
    save();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith({ followUpFreeDays: 365, repeatVisitFreeHours: 8760 });
    type(copy.followUpLabel, '0');
    type(copy.repeatLabel, '0');
    save();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(saveMock).toHaveBeenLastCalledWith({ followUpFreeDays: 0, repeatVisitFreeHours: 0 });
  });

  it('refuses blanks, fractions, negatives, text and numbers out of range, with a message and no call', () => {
    render(<OpdRulesForm initial={rules()} canWrite />);
    const range = (min: number, max: number) =>
      copy.rangeError.replace('{min}', String(min)).replace('{max}', String(max));
    for (const bad of ['', ' ', '1.5', '-1', 'abc', '366', '1e2']) {
      type(copy.followUpLabel, bad);
      save();
      expect({ bad, shown: !!screen.queryByText(range(0, 365)) }).toEqual({ bad, shown: true });
    }
    type(copy.followUpLabel, '7');
    type(copy.repeatLabel, '8761');
    save();
    expect(screen.getByText(range(0, 8760))).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('explains a refusal from the API in plain words and keeps what was typed', async () => {
    saveMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'followUpFreeDays',
      reason: 'OUT_OF_RANGE',
    });
    render(<OpdRulesForm initial={rules()} canWrite />);
    type(copy.followUpLabel, '30');
    save();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${staffCopy.settings.settingsErrors.prefix} ${staffCopy.settings.settingsErrors.fields.followUpFreeDays} ${staffCopy.settings.settingsErrors.reasons.OUT_OF_RANGE}`,
    );
    expect(input(copy.followUpLabel).value).toBe('30');
  });

  it('shows the usual message when permission is refused', async () => {
    saveMock.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
    render(<OpdRulesForm initial={rules()} canWrite />);
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden),
    );
  });

  it('sends one request for a double click', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<OpdRulesForm initial={rules()} canWrite />);
    const button = screen.getByRole('button', { name: copy.save });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: rules() });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('without the write permission it is for looking only', () => {
    render(<OpdRulesForm initial={rules()} canWrite={false} />);
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(input(copy.followUpLabel).matches(':disabled')).toBe(true);
    expect(input(copy.repeatLabel).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
  });
});
