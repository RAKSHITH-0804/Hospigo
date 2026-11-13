import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ActivatePage from './page';
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

describe('activate page', () => {
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

  it('under StrictMode keeps the form when hash has a valid token', async () => {
    window.location.hash = VALID_HASH;
    render(
      <StrictMode>
        <ActivatePage />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toBeTruthy();
    });
    expect(screen.queryByText(sessionConfig.errorInvalidLink)).toBeNull();
  });

  it('shows invalid-link state when there is no fragment', async () => {
    window.location.hash = '';
    render(<ActivatePage />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorInvalidLink);
    });
  });

  it('shows invalid-link state for a malformed fragment', async () => {
    window.location.hash = '#t=ab';
    render(<ActivatePage />);
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

    render(<ActivatePage />);
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'StrongEnough9!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { token: string; newPassword: string };
    expect(body.token).toBe(token);
  });
});
