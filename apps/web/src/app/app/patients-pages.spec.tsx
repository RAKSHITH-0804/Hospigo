import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import PatientsPage from '@/app/app/patients/page';
import NewPatientPage from '@/app/app/patients/new/page';
import PatientRecordPage from '@/app/app/patients/[id]/page';
import EditPatientPage from '@/app/app/patients/[id]/edit/page';
import PatientSlipPage from '@/app/app/patients/[id]/slip/page';
import SettingsIndexPage from '@/app/app/settings/page';
import SettingsSectionPage from '@/app/app/settings/[section]/page';
import { SETTINGS_SECTIONS } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';

const requireKindMock = jest.fn();
const fetchMock = jest.fn();

jest.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('next/link', () => {
  return function Link({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

jest.mock('@/lib/patients/server', () => ({
  ...jest.requireActual('@/lib/patients/server'),
  fetchStaffOnServer: (...args: unknown[]) => fetchMock(...args),
}));

jest.mock('@/lib/auth/guards', () => ({
  requirePermission: async (code: string) => {
    const session = await requireKindMock('HOSPITAL');
    if (!session.permissions?.includes(code)) {
      throw new Error('REDIRECT:/app?notice=no-permission');
    }
    return session;
  },
  redirectToRefresh: async () => {
    throw new Error('REDIRECT:/api/auth/refresh');
  },
}));

jest.mock('@/components/patients/patients-search', () => ({
  PatientsSearch: (props: Record<string, unknown>) => (
    <div data-testid="patients-search" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/patients/patient-form', () => ({
  PatientForm: (props: Record<string, unknown>) => (
    <div data-testid="patient-form" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/patients/patient-record', () => ({
  PatientRecord: (props: Record<string, unknown>) => (
    <div data-testid="patient-record" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/patients/patient-slip', () => ({
  PatientSlip: (props: Record<string, unknown>) => (
    <div data-testid="patient-slip" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/patients/uhid-start-card', () => ({
  UhidStartCard: (props: Record<string, unknown>) => (
    <div data-testid="uhid-card" data-props={JSON.stringify(props)} />
  ),
}));

function hospitalSession(permissions: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    kind: 'HOSPITAL',
    displayName: 'Ada',
    email: 'ada@example.test',
    hospitalName: 'Demo Hospital One',
    permissions,
    ...overrides,
  };
}

function propsOf(testId: string): Record<string, unknown> {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}');
}

const idParams = { params: Promise.resolve({ id: 'p1' }) };
const NO_PERMISSION = 'REDIRECT:/app?notice=no-permission';
const CONFIG_PATH = '/patients/form-config';

const listPage = {
  items: [{ id: 'p1', uhid: 'U1', name: 'Mock' }],
  total: 1,
  page: 1,
  pageSize: 20,
};
const patient = { id: 'p1', uhid: 'U1', name: 'Mock Alpha', ageYears: 36 };
const formConfig = {
  fields: [{ code: 'title', label: 'Title', dataType: 'DROPDOWN', required: false }],
};

function ok(data: unknown) {
  return { status: 'ok', data };
}

function byPath(configResult: unknown, otherResult: unknown) {
  return async (requested: string) => (requested === CONFIG_PATH ? configResult : otherResult);
}

describe('patients pages', () => {
  beforeEach(() => {
    requireKindMock.mockReset();
    fetchMock.mockReset();
  });

  it('list page requires registry read, fetches page 1 on the server and passes it as props', async () => {
    requireKindMock.mockResolvedValue(hospitalSession([]));
    await expect(PatientsPage({})).rejects.toThrow(NO_PERMISSION);
    expect(fetchMock).not.toHaveBeenCalled();

    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockResolvedValue(ok(listPage));
    render(await PatientsPage({ searchParams: Promise.resolve({ q: '  98765  ' }) }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/patients', {
      sort: 'newest',
      page: 1,
      pageSize: 20,
      q: '98765',
    });
    expect(propsOf('patients-search')).toMatchObject({
      canWrite: false,
      minLength: 2,
      pageSize: 20,
      initial: {
        params: { q: '98765', sort: 'newest', page: 1 },
        draft: '98765',
        result: listPage,
        errorCode: null,
        hint: false,
      },
    });
    expect(screen.queryByRole('link', { name: staffCopy.patients.registerAction })).toBeNull();
  });

  it('list page puts Register patient in the title row only with write permission', async () => {
    requireKindMock.mockResolvedValue(
      hospitalSession(['patients.registry.read', 'patients.registry.write']),
    );
    fetchMock.mockResolvedValue(ok(listPage));
    render(await PatientsPage({ searchParams: Promise.resolve({}) }));
    const header = screen
      .getByRole('heading', { name: staffCopy.patients.title })
      .closest('header');
    const register = screen.getByRole('link', { name: staffCopy.patients.registerAction });
    expect(header?.contains(register)).toBe(true);
    expect(propsOf('patients-search')).toMatchObject({ canWrite: true });
  });

  it('list page does not send text shorter than the minimum and passes the hint', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockResolvedValue(ok(listPage));
    render(await PatientsPage({ searchParams: Promise.resolve({ q: 'a' }) }));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ q: undefined });
    expect(propsOf('patients-search').initial).toMatchObject({
      params: { q: '' },
      draft: 'a',
      hint: true,
    });
  });

  it('list page treats an API 400 with fieldErrors.q as the hint and shows the plain list', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock
      .mockResolvedValueOnce({ status: 'invalid', fieldErrors: { q: 'INVALID' } })
      .mockResolvedValueOnce(ok(listPage));
    render(await PatientsPage({ searchParams: Promise.resolve({ q: '+9' }) }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ q: undefined });
    expect(propsOf('patients-search').initial).toMatchObject({
      params: { q: '' },
      draft: '+9',
      hint: true,
      result: listPage,
    });
  });

  it('list page passes a server fetch failure as an error code', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockResolvedValue({ status: 'forbidden' });
    render(await PatientsPage({ searchParams: Promise.resolve({}) }));
    expect(propsOf('patients-search').initial).toMatchObject({
      result: null,
      errorCode: 'FORBIDDEN',
    });
  });

  it('register page requires registry write and passes form-config fetched on the server', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    await expect(NewPatientPage()).rejects.toThrow(NO_PERMISSION);

    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.write']));
    fetchMock.mockResolvedValue(ok(formConfig));
    render(await NewPatientPage());
    expect(fetchMock).toHaveBeenCalledWith(CONFIG_PATH);
    expect(propsOf('patient-form')).toMatchObject({
      mode: 'register',
      title: staffCopy.pageTitles.patientRegister,
      backHref: '/app/patients',
      boot: { fields: formConfig.fields },
    });
  });

  it('record page requires registry read and fetches patient and form-config together', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
    await expect(PatientRecordPage(idParams)).rejects.toThrow(NO_PERMISSION);

    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockImplementation(byPath(ok(formConfig), ok(patient)));
    render(await PatientRecordPage(idParams));
    expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      CONFIG_PATH,
      '/patients/p1',
    ]);
    expect(propsOf('patient-record')).toEqual({
      patient,
      labels: { title: 'Title' },
      canWrite: false,
      canCreateVisit: false,
      canReadBills: false,
      visitsTab: { status: 'noAccess' },
    });
  });

  describe('record page: visits and bills tabs (Step 4b)', () => {
    const VISITS_PATH = '/patients/p1/visits';
    const visitsPage = { items: [{ id: 'v1' }], total: 1, page: 1, pageSize: 10 };

    function withVisits(visitsResult: unknown) {
      return async (requested: string) => {
        if (requested === CONFIG_PATH) {
          return ok(formConfig);
        }
        if (requested === VISITS_PATH) {
          return visitsResult;
        }
        return ok(patient);
      };
    }

    it('without opd.visits.read it never asks for visits', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
      fetchMock.mockImplementation(byPath(ok(formConfig), ok(patient)));
      render(await PatientRecordPage(idParams));
      expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(VISITS_PATH);
    });

    it('with opd.visits.read it fetches page 1 in parallel with the patient and passes it on', async () => {
      requireKindMock.mockResolvedValue(
        hospitalSession(['patients.registry.read', 'opd.visits.read']),
      );
      fetchMock.mockImplementation(withVisits(ok(visitsPage)));
      render(await PatientRecordPage(idParams));
      expect(fetchMock).toHaveBeenCalledWith(VISITS_PATH, { page: 1, pageSize: 10 });
      expect(propsOf('patient-record')).toMatchObject({
        canCreateVisit: false,
        canReadBills: false,
        visitsTab: { status: 'ok', data: visitsPage },
      });
    });

    it('reads the page and the tab from the address; bad values fall back to page 1 / no tab', async () => {
      requireKindMock.mockResolvedValue(
        hospitalSession(['patients.registry.read', 'opd.visits.read', 'opd.billing.read']),
      );
      fetchMock.mockImplementation(withVisits(ok(visitsPage)));
      render(
        await PatientRecordPage({
          ...idParams,
          searchParams: Promise.resolve({ vp: '3', tab: 'bills' }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(VISITS_PATH, { page: 3, pageSize: 10 });
      expect(propsOf('patient-record')).toMatchObject({ canReadBills: true, initialTab: 'bills' });

      fetchMock.mockReset();
      fetchMock.mockImplementation(withVisits(ok(visitsPage)));
      render(
        await PatientRecordPage({
          ...idParams,
          searchParams: Promise.resolve({ vp: '-4', tab: ['x', 'y'] }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(VISITS_PATH, { page: 1, pageSize: 10 });
    });

    it('the New visit button needs BOTH visits.create and billing.collect', async () => {
      for (const [perms, expected] of [
        [['opd.visits.create'], false],
        [['opd.billing.collect'], false],
        [['opd.visits.create', 'opd.billing.collect'], true],
      ] as const) {
        requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read', ...perms]));
        fetchMock.mockImplementation(byPath(ok(formConfig), ok(patient)));
        const view = render(await PatientRecordPage(idParams));
        expect(propsOf('patient-record').canCreateVisit).toBe(expected);
        view.unmount();
      }
    });

    it('a forbidden or failed visits fetch becomes a calm message, not a broken page', async () => {
      requireKindMock.mockResolvedValue(
        hospitalSession(['patients.registry.read', 'opd.visits.read']),
      );
      fetchMock.mockImplementation(withVisits({ status: 'forbidden' }));
      const first = render(await PatientRecordPage(idParams));
      expect(propsOf('patient-record').visitsTab).toEqual({ status: 'noAccess' });
      first.unmount();

      fetchMock.mockImplementation(withVisits({ status: 'error', code: 'UNAVAILABLE' }));
      render(await PatientRecordPage(idParams));
      expect(propsOf('patient-record').visitsTab).toEqual({
        status: 'error',
        message: staffCopy.errors.unreachable,
      });
    });
  });

  it('record page shows the not-found state', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockImplementation(byPath(ok(formConfig), { status: 'notFound' }));
    render(await PatientRecordPage(idParams));
    expect(screen.getByText(staffCopy.patients.record.notFoundTitle)).toBeTruthy();
  });

  it('edit page requires registry write and passes form-config and the patient as boot data', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    await expect(EditPatientPage(idParams)).rejects.toThrow(NO_PERMISSION);

    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.write']));
    fetchMock.mockImplementation(byPath(ok(formConfig), ok(patient)));
    render(await EditPatientPage(idParams));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(propsOf('patient-form')).toMatchObject({
      mode: 'edit',
      patientId: 'p1',
      title: staffCopy.pageTitles.patientEdit,
      backHref: '/app/patients/p1',
      boot: { fields: formConfig.fields, detail: patient },
    });
  });

  it('edit page passes not-found as the boot failure', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.write']));
    fetchMock.mockImplementation(byPath(ok(formConfig), { status: 'notFound' }));
    render(await EditPatientPage(idParams));
    expect(propsOf('patient-form').boot).toEqual({ failure: 'notFound' });
  });

  it('slip page requires read, passes the session hospital name and injects @page size', async () => {
    requireKindMock.mockResolvedValue(hospitalSession([]));
    await expect(PatientSlipPage(idParams)).rejects.toThrow(NO_PERMISSION);

    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockResolvedValue(ok(patient));
    const { container } = render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip')).toEqual({ patient, hospitalName: 'Demo Hospital One' });
    expect(container.querySelector('style')?.textContent).toBe('@page { size: A4; margin: 0; }');
  });

  it('slip page falls back to the brand when the hospital has no name', async () => {
    requireKindMock.mockResolvedValue(
      hospitalSession(['patients.registry.read'], { hospitalName: null }),
    );
    fetchMock.mockResolvedValue(ok(patient));
    render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip').hospitalName).toBe(staffCopy.brand);
  });

  describe('settings routes', () => {
    const info = {
      nextNumber: 12,
      nextUhidPreview: 'T12',
      resetRule: 'NEVER',
      periodYear: 0,
      periodLabel: null,
    };
    const section = (id: string) => ({ params: Promise.resolve({ section: id }) });

    it('/app/settings without hospital.settings.read gets the no-permission redirect (not an empty page)', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
      await expect(SettingsIndexPage()).rejects.toThrow(NO_PERMISSION);
      await expect(SettingsSectionPage(section('patient-registration'))).rejects.toThrow(
        NO_PERMISSION,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('/app/settings redirects to the first section the user may see', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      await expect(SettingsIndexPage()).rejects.toThrow(`REDIRECT:${SETTINGS_SECTIONS[0]!.route}`);
    });

    it('a section renders the frame, the nav with aria-current and the server-fetched number', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok(info));
      const { unmount } = render(await SettingsSectionPage(section('patient-registration')));
      expect(screen.getByRole('heading', { name: staffCopy.settings.title })).toBeTruthy();
      expect(screen.getByText(staffCopy.settings.description)).toBeTruthy();
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      const current = nav.querySelector('[aria-current="page"]');
      expect(current?.textContent).toBe(staffCopy.settings.sections.patientRegistration);
      expect(current?.getAttribute('href')).toBe('/app/settings/patient-registration');
      expect(fetchMock).toHaveBeenCalledWith('/patients/uhid/start-number');
      expect(propsOf('uhid-card')).toEqual({
        canWrite: false,
        initialInfo: info,
        initialErrorCode: null,
      });
      unmount();

      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'hospital.settings.write']),
      );
      render(await SettingsSectionPage(section('patient-registration')));
      expect(propsOf('uhid-card')).toMatchObject({ canWrite: true });
    });

    it('an unknown section shows the not-found state inside the frame', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      render(await SettingsSectionPage(section('nope')));
      expect(screen.getByText(staffCopy.settings.notFoundTitle)).toBeTruthy();
      expect(screen.queryByTestId('uhid-card')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the section list comes from one config list with the required fields', () => {
      for (const entry of SETTINGS_SECTIONS) {
        expect(entry.route).toBe(`/app/settings/${entry.id}`);
        expect(staffCopy.settings.sections[entry.copyKey]).toBeTruthy();
        expect(entry.permission).toBe('hospital.settings.read');
      }
    });
  });
});

describe('loading skeletons', () => {
  it.each([
    'patients/loading.tsx',
    'patients/new/loading.tsx',
    'patients/[id]/loading.tsx',
    'patients/[id]/edit/loading.tsx',
    'settings/loading.tsx',
  ])('has %s', (file) => {
    expect(fs.existsSync(path.join(__dirname, file))).toBe(true);
  });
});
