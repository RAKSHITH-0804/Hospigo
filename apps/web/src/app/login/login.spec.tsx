import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from './page';
import { sessionConfig } from '@/config/session';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('login form', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders brand copy and empty hospital staff fields without sample badge or step note', () => {
    render(<LoginPage />);
    expect(screen.queryByText('Sample data')).toBeNull();
    expect(screen.getByText('One platform. Every hospital.')).toBeTruthy();
    expect(screen.getByText('A product by Indigo')).toBeTruthy();
    expect(screen.getByLabelText('Access code')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Email')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '');
    expect(screen.queryByText(/login arrives in Step 6/i)).toBeNull();
    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('switches to Indigo HQ and hides the access code field', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Indigo HQ' }));
    expect(screen.queryByLabelText('Access code')).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('shows loading then generic error for INVALID_CREDENTIALS without secrets in the DOM', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'INVALID_CREDENTIALS' }),
    }) as unknown as typeof fetch;

    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Access code'), {
      target: { value: 'demo-north-main' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'staff@demo-north.example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      (screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorInvalidCredentials);
    });
    expect(document.body.textContent).not.toContain('secret-value');
    expect(document.body.textContent).not.toMatch(/accessToken|refreshToken/i);
  });

  it('shows rate-limited and unavailable messages', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 'RATE_LIMITED' }),
    }) as unknown as typeof fetch;
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: 'code' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorRateLimited);
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: 'UNAVAILABLE' }),
    }) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.errorUnavailable);
    });
  });
});
