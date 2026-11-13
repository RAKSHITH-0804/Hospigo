import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sessionConfig } from '@/config/session';
import { PatientSignOutButton } from './patient-sign-out-button';
import { EmptyState } from '@/components/states/empty-state';

const replaceMock = jest.fn();
const refreshMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

describe('patient home pieces', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    replaceMock.mockClear();
    refreshMock.mockClear();
  });

  it('renders masked phone and empty profiles copy from config', () => {
    render(
      <div>
        <p>{'+91XXXXXX3210'}</p>
        <EmptyState
          title={sessionConfig.patientEmptyProfilesTitle}
          description={sessionConfig.patientEmptyProfilesDescription}
        />
      </div>,
    );
    expect(screen.getByText('+91XXXXXX3210')).toBeTruthy();
    expect(screen.getByText(sessionConfig.patientEmptyProfilesTitle)).toBeTruthy();
    expect(screen.getByText(sessionConfig.patientEmptyProfilesDescription)).toBeTruthy();
  });

  it('sign-out posts to patient logout then goes to patient login', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;

    render(<PatientSignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: sessionConfig.patientSignOutLabel }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/patient-auth/logout',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(replaceMock).toHaveBeenCalledWith(
        `${sessionConfig.patientLoginPath}?notice=signed-out`,
      );
    });
  });
});
