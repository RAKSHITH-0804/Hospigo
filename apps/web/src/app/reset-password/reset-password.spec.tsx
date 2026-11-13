import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetPasswordPage from './page';
import { sessionConfig } from '@/config/session';
import { resetActionTokenHashCaptureForTests } from '@/lib/auth/action-token-hash';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: jest.fn(),
  }),
}));

const VALID_HASH = '#t=h.demo-tenant_1.token-id_2.secret_value-00000000';

describe('reset-password page', () => {
  const originalFetch = global.fetch;
  const originalReplaceState = window.history.replaceState;

  beforeEach(() => {
    replaceMock.mockClear();
    resetActionTokenHashCaptureForTests();
    window.history.replaceState = jest.fn();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = '';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.history.replaceState = originalReplaceState;
    window.location.hash = '';
    resetActionTokenHashCaptureForTests();
  });

  it('under StrictMode keeps the form when hash has a valid token (dots/dashes/underscores)', async () => {
    window.location.hash = VALID_HASH;
    render(
      <StrictMode>
        <ResetPasswordPage />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toBeTruthy();
    });
    expect(screen.queryByText(sessionConfig.errorInvalidLink)).toBeNull();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeTruthy();
  });

  it('reads token from hash, removes hash, and keeps nothing in storage', async () => {
    window.location.hash = VALID_HASH;
    render(<ResetPasswordPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toBeTruthy();
    });
    expect(window.history.replaceState).toHaveBeenCalled();
    const call = (window.history.replaceState as jest.Mock).mock.calls[0] as unknown[];
    const url = String(call[2] ?? '');
    expect(url).not.toContain('#');
    expect(url).not.toContain('secret_value');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows invalid-link state when there is no fragment', async () => {
    window.location.hash = '';
    render(<ResetPasswordPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorInvalidLink);
    });
    expect(screen.getByRole('link', { name: /Request a new link/i })).toHaveProperty(
      'href',
      expect.stringContaining(sessionConfig.forgotPasswordPath),
    );
  });

  it('shows invalid-link state for a malformed fragment', async () => {
    window.location.hash = '#t=short';
    render(<ResetPasswordPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorInvalidLink);
    });
  });

  it('POSTs the hash token in the body on submit', async () => {
    const token = 'h.demo-tenant_1.token-id_2.secret_value-00000000';
    window.location.hash = `#t=${token}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as unknown as typeof fetch;

    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { token: string; newPassword: string };
    expect(body.token).toBe(token);
    expect(body.newPassword).toBe('StrongEnough9!');
  });

  it('keeps form visible for VALIDATION and shows config message', async () => {
    window.location.hash = VALID_HASH;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION', message: 'Password rejected: TOO_SHORT' }),
    }) as unknown as typeof fetch;

    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorPasswordValidation);
    });
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeTruthy();
  });

  it('redirects to login with notice on success', async () => {
    window.location.hash = VALID_HASH;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as unknown as typeof fetch;

    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        `${sessionConfig.loginPath}?notice=${sessionConfig.passwordUpdatedNotice}`,
      );
    });
  });
});
