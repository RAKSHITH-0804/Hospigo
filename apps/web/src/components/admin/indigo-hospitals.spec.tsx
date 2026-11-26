import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndigoHospitals } from '@/components/admin/indigo-hospitals';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoOverview } from '@/lib/indigo/types';

const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: jest.fn() }),
}));
const saveModulesMock = jest.fn();
jest.mock('@/lib/indigo/client', () => ({
  saveHospitalModules: (...args: unknown[]) => saveModulesMock(...args),
}));

const copy = staffCopy.admin.indigo;
const consoleCopy = staffCopy.admin.console;

const overview = (canManage: boolean, count = 2): IndigoOverview => ({
  canManage,
  moduleCatalog: [
    { code: 'OPD', name: 'Outpatient' },
    { code: 'IPD', name: 'Inpatient' },
  ],
  items: [
    {
      id: 'h1',
      code: 'NORTH',
      name: 'North Hospital',
      status: 'ACTIVE',
      isActive: true,
      isTest: false,
      modules: ['OPD'],
      branches: [
        {
          id: 'b1',
          code: 'MAIN',
          name: 'Main',
          isMain: true,
          isActive: true,
          modules: ['OPD'],
          ...(canManage ? { accessCode: 'north-main' } : {}),
        },
      ],
    },
    {
      id: 'h2',
      code: 'SOUTH',
      name: 'South Hospital',
      status: 'ACTIVE',
      isActive: true,
      isTest: false,
      modules: ['OPD', 'IPD'],
      branches: [],
    },
  ].slice(0, count),
});

describe('IndigoHospitals', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    replaceMock.mockReset();
    saveModulesMock.mockReset();
  });

  it('lists the real hospitals with status and branches, and says so when there are none', () => {
    const { unmount } = render(<IndigoHospitals overview={overview(false)} />);
    expect(screen.getByText('North Hospital')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: copy.enter })).toHaveLength(2);
    expect(screen.getAllByText(/Status: ACTIVE/).length).toBe(2);
    unmount();
    render(<IndigoHospitals overview={overview(false, 0)} />);
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
  });

  it('an Employee sees no access codes, no module switches and no onboard link; the Owner sees all three', () => {
    const { unmount } = render(<IndigoHospitals overview={overview(false)} />);
    expect(document.body.textContent).not.toContain('north-main');
    expect(screen.queryByRole('button', { name: consoleCopy.modulesSave })).toBeNull();
    expect(screen.queryByRole('link', { name: consoleCopy.navOnboard })).toBeNull();
    unmount();
    render(<IndigoHospitals overview={overview(true)} />);
    expect(screen.getByText(/access code north-main/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: consoleCopy.modulesSave })).toHaveLength(2);
    expect(screen.getByRole('link', { name: consoleCopy.navOnboard })).toBeTruthy();
  });

  it('the Owner switches a module and saves; OPD cannot be switched off', async () => {
    saveModulesMock.mockResolvedValue({ ok: true, data: { moduleCodes: ['OPD', 'IPD'] } });
    render(<IndigoHospitals overview={overview(true, 1)} />);
    const opd = screen.getByLabelText('Outpatient') as HTMLInputElement;
    expect(opd.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Inpatient'));
    fireEvent.click(screen.getByRole('button', { name: consoleCopy.modulesSave }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(consoleCopy.modulesSaved),
    );
    expect(saveModulesMock).toHaveBeenCalledWith('h1', ['OPD', 'IPD']);
  });

  it('Enter sends only the hospital id to the same-origin route and opens the hospital', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<IndigoHospitals overview={overview(false)} />);
    fireEvent.click(screen.getAllByRole('button', { name: copy.enter })[1]!);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/auth/indigo-enter');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
      hospitalId: 'h2',
    });
  });

  it('one plain message for a refusal', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    render(<IndigoHospitals overview={overview(false)} />);
    fireEvent.click(screen.getAllByRole('button', { name: copy.enter })[0]!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.notAvailable));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
