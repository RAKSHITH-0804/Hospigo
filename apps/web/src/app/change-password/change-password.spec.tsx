import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChangePasswordPage from './page';
import { sessionConfig } from '@/config/session';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

function fillForm(values: { current: string; next: string; confirm: string }) {
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: values.current },
  });
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: values.next },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: values.confirm },
  });
}

describe('change-password form', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps fields visible and shows VALIDATION message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION', message: 'Password rejected: TOO_SHORT' }),
    }) as unknown as typeof fetch;

    render(<ChangePasswordPage />);
    fillForm({ current: 'old-pass', next: 'short', confirm: 'short' });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        sessionConfig.errorChangePasswordValidation,
      );
    });
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeTruthy();
  });

  it('shows INVALID_CREDENTIALS message and keeps the form', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'INVALID_CREDENTIALS' }),
    }) as unknown as typeof fetch;

    render(<ChangePasswordPage />);
    fillForm({ current: 'wrong', next: 'GoodPass99!', confirm: 'GoodPass99!' });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorChangePasswordInvalid);
    });
    expect(screen.getByLabelText('Current password')).toBeTruthy();
  });

  it('shows RATE_LIMITED message and keeps the form', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 'RATE_LIMITED' }),
    }) as unknown as typeof fetch;

    render(<ChangePasswordPage />);
    fillForm({ current: 'old-pass', next: 'GoodPass99!', confirm: 'GoodPass99!' });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        sessionConfig.errorChangePasswordRateLimited,
      );
    });
    expect(screen.getByLabelText('Current password')).toBeTruthy();
  });
});
