import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sessionConfig } from '@/config/session';
import { PatientLoginForm } from './patient-login-form';

const replaceMock = jest.fn();
const refreshMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

describe('patient login form', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('steps phone → code, focuses code field, one masked notice, no secrets in URL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resendAfterSec: 5 }),
    }) as unknown as typeof fetch;

    render(<PatientLoginForm />);
    fireEvent.change(screen.getByLabelText(sessionConfig.patientPhoneLabel), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));

    await waitFor(() => {
      expect(screen.getByLabelText(sessionConfig.patientCodeLabel)).toBeTruthy();
    });
    expect(document.activeElement).toBe(screen.getByLabelText(sessionConfig.patientCodeLabel));
    const expected = sessionConfig.patientCodeSentNotice.replace('{phone}', '+91XXXXXX3210');
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(/^Code sent to /)).toBeNull();
    expect(window.location.href).not.toMatch(/9876543210|phone=/);
    expect(window.location.href).not.toMatch(/code=/);
  });

  it('hides signed-out notice as soon as the phone form is submitted', async () => {
    window.history.replaceState(null, '', '/patient/login?notice=signed-out');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resendAfterSec: 5 }),
    }) as unknown as typeof fetch;

    render(<PatientLoginForm />);
    await waitFor(() => {
      expect(screen.getByText(sessionConfig.patientSignedOutNotice)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(sessionConfig.patientPhoneLabel), {
      target: { value: '9000000020' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));
    expect(screen.queryByText(sessionConfig.patientSignedOutNotice)).toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText(sessionConfig.patientCodeLabel)).toBeTruthy();
    });
    expect(screen.queryByText(sessionConfig.patientSignedOutNotice)).toBeNull();
  });

  it('disables submit while pending and shows status-specific errors', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    render(<PatientLoginForm />);
    fireEvent.change(screen.getByLabelText(sessionConfig.patientPhoneLabel), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));
    expect(
      (screen.getByRole('button', { name: sessionConfig.patientSendingLabel }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolveFetch({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION' }),
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.patientErrorInvalidPhone);
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resendAfterSec: 2 }),
    }) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));
    await waitFor(() => screen.getByLabelText(sessionConfig.patientCodeLabel));

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'INVALID_CREDENTIALS' }),
    }) as unknown as typeof fetch;
    fireEvent.change(screen.getByLabelText(sessionConfig.patientCodeLabel), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientVerifyLabel }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(sessionConfig.patientErrorInvalidCode);
    });
  });

  it('resend countdown disables the button until zero', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resendAfterSec: 1 }),
    }) as unknown as typeof fetch;

    render(<PatientLoginForm />);
    fireEvent.change(screen.getByLabelText(sessionConfig.patientPhoneLabel), {
      target: { value: '9123456780' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));
    await waitFor(() => screen.getByRole('button', { name: sessionConfig.patientResendLabel }));
    expect(
      (
        screen.getByRole('button', {
          name: sessionConfig.patientResendLabel,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(
      () => {
        expect(
          (
            screen.getByRole('button', {
              name: sessionConfig.patientResendLabel,
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false);
      },
      { timeout: 2500 },
    );
  });

  it('verify success navigates to patient home', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, resendAfterSec: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }) as unknown as typeof fetch;

    render(<PatientLoginForm />);
    fireEvent.change(screen.getByLabelText(sessionConfig.patientPhoneLabel), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSendCodeLabel }));
    await waitFor(() => screen.getByLabelText(sessionConfig.patientCodeLabel));
    fireEvent.change(screen.getByLabelText(sessionConfig.patientCodeLabel), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientVerifyLabel }));
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(sessionConfig.patientHomePath);
    });
  });
});
