import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HqHome } from '@/components/admin/hq-home';
import { HqHospital } from '@/components/admin/hq-hospital';
import { IndigoEmployees } from '@/components/admin/indigo-employees';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoHospitalRow, IndigoOverview } from '@/lib/indigo/types';

const activateMock = jest.fn();
const resetMock = jest.fn();
const permsMock = jest.fn();
jest.mock('@/lib/indigo/client', () => ({
  activateDesign: (...a: unknown[]) => activateMock(...a),
  createSuperAdmin: jest.fn(),
  resetSuperAdmin: (...a: unknown[]) => resetMock(...a),
  setHospitalLogo: jest.fn(),
  saveEmployeePermissions: (...a: unknown[]) => permsMock(...a),
  saveEmployeeHospitals: jest.fn(),
  setEmployeeActive: jest.fn(),
  createEmployee: jest.fn(),
  saveHospitalModules: jest.fn(),
}));
jest.mock('@/lib/indigo/library', () => ({
  runStarter: jest.fn(),
  saveBranchModules: jest.fn(),
}));

const copy = staffCopy.admin.hq;
const hospital: IndigoHospitalRow = {
  id: 'h1',
  code: 'NANDAVANA',
  name: 'Nandavana Multispeciality Hospital',
  status: 'ACTIVE',
  isActive: true,
  isTest: false,
  modules: ['OPD'],
  branches: [
    { id: 'b1', code: 'HUB', name: 'Hubballi', isMain: true, isActive: true, modules: ['OPD'] },
  ],
};
const overview = (permissions: string[]): IndigoOverview => ({
  canManage: permissions.includes('hq.onboard'),
  permissions,
  moduleCatalog: [{ code: 'OPD', name: 'Outpatient' }],
  items: [hospital],
});

beforeEach(() => {
  activateMock.mockReset();
  resetMock.mockReset();
  permsMock.mockReset();
});

describe('HqHome', () => {
  it('shows real counts, health and a link to the HQ page, and no way into a hospital', () => {
    render(
      <HqHome
        overview={overview(['hq.hospitals.view', 'hq.monitor'])}
        counts={[
          {
            hospitalId: 'h1',
            visitsToday: 7,
            visits7d: 30,
            visits30d: 100,
            activeUsers30d: 5,
            lastActivity: null,
          },
        ]}
        health={{
          status: 'ok',
          checkedAt: '',
          api: 'up',
          database: 'up',
          storage: 'up',
          migrations: 'ok',
        }}
        staffCount={2}
      />,
    );
    expect(screen.getByText(hospital.name)).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText(copy.healthOk)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.open }).getAttribute('href')).toBe(
      '/admin/hospitals/h1',
    );
    expect(screen.queryByRole('button', { name: /enter/i })).toBeNull();
    expect(screen.queryByRole('link', { name: staffCopy.admin.console.navOnboard })).toBeNull();
  });

  it('leaves out the numbers the person may not see', () => {
    render(<HqHome overview={overview([])} counts={null} health={null} staffCount={null} />);
    expect(screen.queryByText(copy.kpiStaff)).toBeNull();
    expect(screen.queryByText(copy.kpiHealth)).toBeNull();
    expect(screen.queryByText(copy.colVisitsToday)).toBeNull();
  });
});

describe('HqHospital', () => {
  const library = {
    templates: [
      {
        id: 't1',
        docType: 'RECEIPT',
        key: 'k',
        name: 'Clean receipt',
        description: '',
        paper: 'A5',
        retired: false,
        hospitalIds: [],
      },
    ],
    logos: [],
    samplesMissing: 0,
  };

  it('sets the active design of the hospital through the HQ route', async () => {
    activateMock.mockResolvedValue({ ok: true, data: { docType: 'RECEIPT', scope: 'hospital' } });
    render(
      <HqHospital
        hospital={hospital}
        overview={overview(['hq.hospitals.view', 'hq.print'])}
        counts={null}
        library={library}
        active={{ designs: [], hasLogo: false }}
        superAdmins={[]}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: copy.tabPrint }));
    const select = screen.getByLabelText(
      `${staffCopy.library.docTypes.RECEIPT} · ${copy.printWhole}`,
    );
    fireEvent.change(select, { target: { value: 't1' } });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: copy.printApply })
        .find((b) => !(b as HTMLButtonElement).disabled)!,
    );
    await waitFor(() => expect(activateMock).toHaveBeenCalledWith('h1', { templateId: 't1' }));
    expect(screen.getAllByRole('link', { name: copy.designerLink }).length).toBeGreaterThan(0);
  });

  it('resets a Super Admin and shows the one-time password once; no reset without the tick', async () => {
    resetMock.mockResolvedValue({ ok: true, data: { temporaryPassword: 'Temp-Pass-9' } });
    const admins = [
      {
        id: 'u1',
        email: 'sa@example.test',
        displayName: 'Ramesh',
        isActive: true,
        lastLoginAt: null,
      },
    ];
    const { unmount } = render(
      <HqHospital
        hospital={hospital}
        overview={overview(['hq.hospitals.view', 'hq.superadmin.reset'])}
        counts={null}
        library={null}
        active={null}
        superAdmins={admins}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSuperAdmin }));
    fireEvent.click(screen.getByRole('button', { name: copy.superAdminReset }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Temp-Pass-9'));
    expect(resetMock).toHaveBeenCalledWith('h1', 'u1');
    unmount();
    render(
      <HqHospital
        hospital={hospital}
        overview={overview(['hq.hospitals.view'])}
        counts={null}
        library={null}
        active={null}
        superAdmins={admins}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: copy.tabSuperAdmin }));
    expect(screen.queryByRole('button', { name: copy.superAdminReset })).toBeNull();
  });

  it('shows counts only on the overview', () => {
    render(
      <HqHospital
        hospital={hospital}
        overview={overview(['hq.hospitals.view', 'hq.monitor'])}
        counts={{
          hospitalId: 'h1',
          visitsToday: 3,
          visits7d: 20,
          visits30d: 90,
          activeUsers30d: 4,
          lastActivity: null,
        }}
        library={null}
        active={null}
        superAdmins={null}
      />,
    );
    expect(screen.getByText(copy.visitsToday)).toBeTruthy();
    expect(screen.getByText(copy.countsHint)).toBeTruthy();
  });
});

describe('HQ Staff tick-boxes', () => {
  it('saves the ticked permissions of one person', async () => {
    permsMock.mockResolvedValue({ ok: true, data: { permissions: ['hq.monitor'] } });
    render(
      <IndigoEmployees
        employees={[
          {
            id: 'e1',
            email: 'e@example.test',
            displayName: 'Eve',
            isActive: true,
            hospitalIds: [],
            permissions: [],
          },
        ]}
        hospitals={[{ id: 'h1', name: 'North' }]}
      />,
    );
    fireEvent.click(screen.getByLabelText(copy.permissionLabels['hq.monitor']!));
    fireEvent.click(screen.getByRole('button', { name: copy.permissionsSave }));
    await waitFor(() => expect(permsMock).toHaveBeenCalledWith('e1', ['hq.monitor']));
    await waitFor(() => expect(screen.getByText(copy.permissionsSaved)).toBeTruthy());
  });
});
