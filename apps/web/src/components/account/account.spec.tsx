import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountPage } from '@/components/account/account-page';
import { staffScreenConfig } from '@/config/settings';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import type { AccountView } from '@/lib/staff/types';

const replaceMock = jest.fn();
const refreshMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: jest.fn() }),
}));

const saveMock = jest.fn();
const emailRequestMock = jest.fn();
const emailConfirmMock = jest.fn();
const passwordRequestMock = jest.fn();
const passwordConfirmMock = jest.fn();
jest.mock('@/lib/staff/client', () => ({
  saveAccount: (...args: unknown[]) => saveMock(...args),
  requestEmailChange: (...args: unknown[]) => emailRequestMock(...args),
  confirmEmailChange: (...args: unknown[]) => emailConfirmMock(...args),
  requestPasswordChange: (...args: unknown[]) => passwordRequestMock(...args),
  confirmPasswordChange: (...args: unknown[]) => passwordConfirmMock(...args),
}));

const copy = staffCopy.account;
const me = (over: Partial<AccountView> = {}): AccountView => ({
  id: 'u1',
  code: 'STF001',
  name: 'Anita Rao',
  email: 'anita@example.test',
  phone: '98765',
  branches: ['Main Branch'],
  roles: ['Nurse'],
  isDoctor: false,
  limits: { nameMax: 100, phoneMax: 20 },
  ...over,
});
const renderPage = (account: AccountView | null = me(), extra?: React.ReactNode) =>
  render(
    <AccountPage initial={account} initialErrorCode={null}>
      {extra}
    </AccountPage>,
  );
const block = (title: string) => within(screen.getByRole('region', { name: title }));
const refused = (over: Record<string, unknown>) => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  ...over,
});
const otp = (reason: string) => ({ ok: false, status: 400, code: 'OTP_INVALID', reason });

beforeEach(() => {
  [
    saveMock,
    emailRequestMock,
    emailConfirmMock,
    passwordRequestMock,
    passwordConfirmMock,
    replaceMock,
    refreshMock,
  ].forEach((m) => m.mockReset());
});

describe('My profile page', () => {
  it('shows who the person is for ANY role: code, branches and roles, and the extra part below', () => {
    renderPage(me({ roles: ['Pharmacist'] }), <p>Doctor part here</p>);
    expect(screen.getByText('STF001')).toBeTruthy();
    expect(screen.getByText('Main Branch')).toBeTruthy();
    expect(screen.getByText('Pharmacist')).toBeTruthy();
    expect(screen.getByText('Doctor part here')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: new RegExp(staffCopy.settings.help.show) }),
    ).toBeTruthy(); // help, closed
  });

  it('says None for a person without roles, and shows an error if the profile could not be read', () => {
    renderPage(me({ roles: [], branches: [] }));
    expect(screen.getAllByText(copy.details.none)).toHaveLength(2);
    render(<AccountPage initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });
});

describe('name and phone', () => {
  it('saves the typed values and shows what the API kept', async () => {
    saveMock.mockResolvedValue({ ok: true, data: me({ name: 'Anita R', phone: null }) });
    renderPage();
    fireEvent.change(screen.getByLabelText(copy.details.name), { target: { value: ' Anita R ' } });
    fireEvent.change(screen.getByLabelText(copy.details.phone), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy.details.save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ name: ' Anita R ', phone: '' }));
    await waitFor(() =>
      expect(block(copy.details.title).getByRole('status').textContent).toBe(copy.details.saved),
    );
    expect((screen.getByLabelText(copy.details.name) as HTMLInputElement).value).toBe('Anita R');
    expect((screen.getByLabelText(copy.details.phone) as HTMLInputElement).value).toBe('');
  });

  it('names the problem when the API refuses', async () => {
    saveMock.mockResolvedValue(refused({ field: 'name', reason: 'REQUIRED' }));
    renderPage();
    fireEvent.change(screen.getByLabelText(copy.details.name), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy.details.save }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain(
      staffCopy.settings.settingsErrors.fields.name,
    );
  });
});

describe('changing the email address', () => {
  const start = () => fireEvent.click(screen.getByRole('button', { name: copy.email.change }));

  it('shows the current address and only asks for the new one when Change email is pressed', () => {
    renderPage();
    expect(screen.getByText('anita@example.test')).toBeTruthy();
    expect(screen.queryByLabelText(copy.email.newEmail)).toBeNull();
    start();
    expect(screen.getByLabelText(copy.email.newEmail)).toBeTruthy();
  });

  it('sends a code to the NEW address, then confirms with the typed code and shows the new address', async () => {
    emailRequestMock.mockResolvedValue({ ok: true, data: { sent: true } });
    emailConfirmMock.mockResolvedValue({ ok: true, data: me({ email: 'new@example.test' }) });
    renderPage();
    start();
    fireEvent.change(screen.getByLabelText(copy.email.newEmail), {
      target: { value: ' new@example.test ' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.email.sendCode }));
    await waitFor(() => expect(emailRequestMock).toHaveBeenCalledWith('new@example.test'));
    await waitFor(() =>
      expect(block(copy.email.title).getByRole('status').textContent).toBe(
        copy.email.sent.replace('{email}', 'new@example.test'),
      ),
    );
    fireEvent.change(screen.getByLabelText(copy.email.code), { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: copy.email.confirm }));
    await waitFor(() => expect(emailConfirmMock).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(screen.getByText('new@example.test')).toBeTruthy());
    expect(block(copy.email.title).getByRole('status').textContent).toBe(copy.email.changed);
    expect(screen.queryByLabelText(copy.email.code)).toBeNull();
  });

  it('a wrong code keeps the code box and says what is wrong', async () => {
    emailRequestMock.mockResolvedValue({ ok: true, data: { sent: true } });
    emailConfirmMock.mockResolvedValue(otp('WRONG_CODE'));
    renderPage();
    start();
    fireEvent.change(screen.getByLabelText(copy.email.newEmail), {
      target: { value: 'new@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.email.sendCode }));
    await waitFor(() => screen.getByLabelText(copy.email.code));
    fireEvent.change(screen.getByLabelText(copy.email.code), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: copy.email.confirm }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        staffCopy.staffAdmin.errors.codes.WRONG_CODE,
      ),
    );
    expect(screen.getByLabelText(copy.email.code)).toBeTruthy();
    expect(screen.getByText('anita@example.test')).toBeTruthy(); // not changed
  });

  it('a refused address (already used) stays on the first step', async () => {
    emailRequestMock.mockResolvedValue(refused({ field: 'email', reason: 'DUPLICATE' }));
    renderPage();
    start();
    fireEvent.change(screen.getByLabelText(copy.email.newEmail), {
      target: { value: 'ravi@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.email.sendCode }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByLabelText(copy.email.code)).toBeNull();
  });

  it('tells how long to wait when codes are asked for too often', async () => {
    emailRequestMock.mockResolvedValue({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSec: 30,
    });
    renderPage();
    start();
    fireEvent.change(screen.getByLabelText(copy.email.newEmail), {
      target: { value: 'new@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.email.sendCode }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        staffCopy.staffAdmin.errors.rateLimited.replace('{seconds}', '30'),
      ),
    );
  });

  it('Cancel goes back without sending anything', () => {
    renderPage();
    start();
    fireEvent.click(screen.getByRole('button', { name: copy.email.cancel }));
    expect(screen.queryByLabelText(copy.email.newEmail)).toBeNull();
    expect(emailRequestMock).not.toHaveBeenCalled();
  });
});

describe('changing the password', () => {
  const start = () => fireEvent.click(screen.getByRole('button', { name: copy.password.start }));
  const askForCode = async () => {
    passwordRequestMock.mockResolvedValue({ ok: true, data: { sent: true } });
    start();
    fireEvent.change(screen.getByLabelText(copy.password.email), {
      target: { value: ' anita@example.test ' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.password.sendCode }));
    await waitFor(() => screen.getByLabelText(copy.password.code));
  };
  const fillNew = (code: string, one: string, two: string) => {
    fireEvent.change(screen.getByLabelText(copy.password.code), { target: { value: code } });
    fireEvent.change(screen.getByLabelText(copy.password.newPassword), { target: { value: one } });
    fireEvent.change(screen.getByLabelText(copy.password.repeat), { target: { value: two } });
  };

  it('asks for the typed email address first; nothing else is shown until the code was sent', async () => {
    renderPage();
    expect(screen.queryByLabelText(copy.password.code)).toBeNull();
    await askForCode();
    expect(passwordRequestMock).toHaveBeenCalledWith('anita@example.test');
    expect(block(copy.password.title).getByRole('status').textContent).toBe(copy.password.sent);
  });

  it('a different address is refused by the API and no code box appears', async () => {
    passwordRequestMock.mockResolvedValue(refused({ field: 'email', reason: 'MISMATCH' }));
    renderPage();
    start();
    fireEvent.change(screen.getByLabelText(copy.password.email), {
      target: { value: 'other@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.password.sendCode }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        staffCopy.settings.settingsErrors.reasons.MISMATCH,
      ),
    );
    expect(screen.queryByLabelText(copy.password.code)).toBeNull();
  });

  it('two different new passwords are not sent', async () => {
    renderPage();
    await askForCode();
    fillNew('123456', 'Strong-Password-1', 'Strong-Password-2');
    fireEvent.click(screen.getByRole('button', { name: copy.password.change }));
    expect(screen.getByRole('alert').textContent).toBe(copy.password.mismatch);
    expect(passwordConfirmMock).not.toHaveBeenCalled();
  });

  it('sends code and password; then signs this browser out and goes to sign-in with the notice', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    passwordConfirmMock.mockResolvedValue({
      ok: true,
      data: { changed: true, signedOutEverywhere: true },
    });
    try {
      renderPage();
      passwordRequestMock.mockResolvedValue({ ok: true, data: { sent: true } });
      start();
      fireEvent.change(screen.getByLabelText(copy.password.email), {
        target: { value: 'anita@example.test' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: copy.password.sendCode }));
      });
      fillNew(' 123456 ', 'Strong-Password-1', 'Strong-Password-1');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: copy.password.change }));
      });
      expect(passwordConfirmMock).toHaveBeenCalledWith('123456', 'Strong-Password-1');
      expect(block(copy.password.title).getByRole('status').textContent).toBe(
        copy.password.changed,
      );
      expect(screen.queryByLabelText(copy.password.newPassword)).toBeNull(); // the password is cleared
      expect(replaceMock).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(staffScreenConfig.signOutDelayMs);
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(replaceMock).toHaveBeenCalledWith(
        `${sessionConfig.loginPath}?notice=${sessionConfig.passwordUpdatedNotice}`,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('a weak password or a wrong code is explained and nothing is signed out', async () => {
    renderPage();
    await askForCode();
    passwordConfirmMock.mockResolvedValueOnce(
      refused({ field: 'newPassword', reason: 'COMMON_PASSWORD' }),
    );
    fillNew('123456', 'password1234', 'password1234');
    fireEvent.click(screen.getByRole('button', { name: copy.password.change }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        staffCopy.settings.settingsErrors.reasons.COMMON_PASSWORD,
      ),
    );
    passwordConfirmMock.mockResolvedValueOnce(otp('EXPIRED'));
    fireEvent.click(screen.getByRole('button', { name: copy.password.change }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.staffAdmin.errors.codes.EXPIRED),
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('the password fields are real password inputs that the browser may offer to save', async () => {
    renderPage();
    await askForCode();
    const one = screen.getByLabelText(copy.password.newPassword) as HTMLInputElement;
    expect(one.type).toBe('password');
    expect(one.autocomplete).toBe('new-password');
    expect((screen.getByLabelText(copy.password.repeat) as HTMLInputElement).type).toBe('password');
  });
});
