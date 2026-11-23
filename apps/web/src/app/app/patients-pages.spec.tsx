import fs from 'fs';
import path from 'path';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import PatientsPage from '@/app/app/patients/page';
import NewPatientPage from '@/app/app/patients/new/page';
import PatientRecordPage from '@/app/app/patients/[id]/page';
import EditPatientPage from '@/app/app/patients/[id]/edit/page';
import PatientSlipPage from '@/app/app/patients/[id]/slip/page';
import MyProfilePage from '@/app/app/profile/page';
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
  requireKind: async () => requireKindMock('HOSPITAL'),
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

jest.mock('@/components/doctors/my-profile-form', () => ({
  MyProfileForm: (props: Record<string, unknown>) => (
    <div data-testid="my-profile" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/images/logo-card', () => ({
  LogoCard: (props: Record<string, unknown>) => (
    <div data-testid="logo-card" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/staff/staff-admin', () => ({
  StaffAdmin: (props: Record<string, unknown>) => (
    <div data-testid="staff-admin" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/staff/code-format-card', () => ({
  CodeFormatCard: (props: Record<string, unknown>) => (
    <div data-testid="code-format" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/staff/roles-manager', () => ({
  RolesManager: (props: Record<string, unknown>) => (
    <div data-testid="roles-manager" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/settings/doctors-list', () => ({
  DoctorsList: (props: Record<string, unknown>) => (
    <div data-testid="doctors-list" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/settings/opd-rules-form', () => ({
  OpdRulesForm: (props: Record<string, unknown>) => (
    <div data-testid="opd-rules" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/settings/registration-fields', () => ({
  RegistrationFields: (props: Record<string, unknown>) => (
    <div data-testid="registration-fields" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/settings/uhid-format-card', () => ({
  UhidFormatCard: (props: Record<string, unknown>) => (
    <div data-testid="uhid-format" data-props={JSON.stringify(props)} />
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
      // Step 6b: reception actions for tests and refunds follow their own permissions
      canRequestRefund: false,
      canSeeTests: false,
      visitsTab: { status: 'noAccess' },
    });
  });

  it('record page passes the refund and tests permissions on (Step 6b)', async () => {
    requireKindMock.mockResolvedValue(
      hospitalSession(['patients.registry.read', 'opd.refunds.request', 'opd.investigations.bill']),
    );
    fetchMock.mockImplementation(byPath(ok(formConfig), ok(patient)));
    render(await PatientRecordPage(idParams));
    expect(propsOf('patient-record')).toMatchObject({
      canRequestRefund: true,
      canSeeTests: true,
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
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes('form-config') ? ok(formConfig) : ok(patient)),
    );
    const { container } = render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip')).toEqual({
      patient,
      hospitalName: 'Demo Hospital One',
      relative: '',
    });
    expect(container.querySelector('style')?.textContent).toBe('@page { size: A4; margin: 0; }');
  });

  it('slip page falls back to the brand when the hospital has no name', async () => {
    requireKindMock.mockResolvedValue(
      hospitalSession(['patients.registry.read'], { hospitalName: null }),
    );
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes('form-config') ? ok(formConfig) : ok(patient)),
    );
    render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip').hospitalName).toBe(staffCopy.brand);
  });

  it('slip page prints the relation and the relative name together, and still works without the form config', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    const withRelative = {
      ...patient,
      customFieldValues: [
        { code: 'relation_type', optionLabel: 'S/O' },
        { code: 'relative_name', valueText: 'Ravi Kumar' },
      ],
    };
    const relativeFields = [
      {
        code: 'relation_type',
        label: 'r',
        dataType: 'DROPDOWN',
        required: false,
        sortOrder: 1,
        section: 'RELATIVE',
      },
      {
        code: 'relative_name',
        label: 'n',
        dataType: 'TEXT',
        required: false,
        sortOrder: 2,
        section: 'RELATIVE',
      },
    ];
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('form-config') ? ok({ fields: relativeFields }) : ok(withRelative),
      ),
    );
    render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip').relative).toBe('S/O Ravi Kumar');
    cleanup();
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes('form-config') ? { status: 'error' } : ok(withRelative)),
    );
    render(await PatientSlipPage(idParams));
    expect(propsOf('patient-slip').relative).toBe('');
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

    it('the registration fields section renders the frame, the nav with aria-current and the server-fetched fields', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok(info));
      const { unmount } = render(await SettingsSectionPage(section('patient-registration')));
      expect(screen.getByRole('heading', { name: staffCopy.settings.title })).toBeTruthy();
      expect(screen.getByText(staffCopy.settings.description)).toBeTruthy();
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      const current = nav.querySelector('[aria-current="page"]');
      expect(current?.textContent).toBe(staffCopy.settings.sections.patientRegistration);
      expect(current?.getAttribute('href')).toBe('/app/settings/patient-registration');
      expect(fetchMock).toHaveBeenCalledWith('/settings/patient-fields');
      // only this section's data is fetched: the number screens have their own page
      expect(fetchMock).not.toHaveBeenCalledWith('/patients/uhid/start-number');
      expect(fetchMock).not.toHaveBeenCalledWith('/settings/uhid-format');
      expect(propsOf('registration-fields')).toEqual({
        canWrite: false,
        initial: info,
        initialErrorCode: null,
      });
      expect(screen.queryByTestId('uhid-card')).toBeNull();
      unmount();

      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'hospital.settings.write']),
      );
      render(await SettingsSectionPage(section('patient-registration')));
      expect(propsOf('registration-fields')).toMatchObject({ canWrite: true });
    });

    it('the patient numbers section shows the format and the next number, writable with hospital.settings.write', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok(info));
      const { unmount } = render(await SettingsSectionPage(section('patient-numbers')));
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(
        staffCopy.settings.sections.patientNumbers,
      );
      expect(fetchMock).toHaveBeenCalledWith('/patients/uhid/start-number');
      expect(fetchMock).toHaveBeenCalledWith('/settings/uhid-format');
      expect(fetchMock).not.toHaveBeenCalledWith('/settings/patient-fields');
      expect(propsOf('uhid-format')).toMatchObject({ canWrite: false, initial: info });
      expect(propsOf('uhid-card')).toEqual({
        canWrite: false,
        initialInfo: info,
        initialErrorCode: null,
      });
      unmount();
      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'hospital.settings.write']),
      );
      render(await SettingsSectionPage(section('patient-numbers')));
      expect(propsOf('uhid-card')).toMatchObject({ canWrite: true });
      expect(propsOf('uhid-format')).toMatchObject({ canWrite: true });
    });

    it('the OPD rules section is fetched on the server and writable only with opd.settings.write', async () => {
      const rules = { followUpFreeDays: 7, repeatVisitFreeHours: 0, persisted: false, limits: {} };
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok(rules));
      const first = render(await SettingsSectionPage(section('opd-rules')));
      expect(fetchMock).toHaveBeenCalledWith('/settings/opd-rules');
      expect(propsOf('opd-rules')).toEqual({ initial: rules, canWrite: false });
      first.unmount();
      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'opd.settings.write']),
      );
      render(await SettingsSectionPage(section('opd-rules')));
      expect(propsOf('opd-rules')).toMatchObject({ canWrite: true });
    });

    it('a failed read of the OPD rules shows the calm message, not the form', async () => {
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
      render(await SettingsSectionPage(section('opd-rules')));
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
      expect(screen.queryByTestId('opd-rules')).toBeNull();
    });

    it('the Doctors section needs its own permission and is fetched on the server', async () => {
      const list = { items: [], limits: {}, canWrite: true };
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok(list));
      // settings read alone is not enough for this page, and the menu does not offer it
      await expect(SettingsSectionPage(section('doctors'))).rejects.toThrow(
        'REDIRECT:/app?notice=no-permission',
      );
      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'opd.doctors.read']),
      );
      const { unmount } = render(await SettingsSectionPage(section('doctors')));
      expect(fetchMock).toHaveBeenCalledWith('/doctor-profiles');
      expect(propsOf('doctors-list')).toEqual({ initial: list, initialErrorCode: null });
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      expect(nav.textContent).toContain(staffCopy.settings.sections.doctors);
      unmount();
      // without the doctors permission the menu does not list it
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      fetchMock.mockResolvedValue(ok({ followUpFreeDays: 7, repeatVisitFreeHours: 0, limits: {} }));
      render(await SettingsSectionPage(section('opd-rules')));
      const plain = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      expect(plain.textContent).not.toContain(staffCopy.settings.sections.doctors);
    });

    it('a failed read of the doctors passes the error code to the list', async () => {
      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'opd.doctors.read']),
      );
      fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
      render(await SettingsSectionPage(section('doctors')));
      expect(propsOf('doctors-list')).toEqual({ initial: null, initialErrorCode: 'UNAVAILABLE' });
    });

    it('the Logo section needs the settings permission and reads the logo and limits on the server', async () => {
      const branding = { logo: { id: 'i1' }, canWrite: true, limits: { maxBytes: 1 } };
      fetchMock.mockResolvedValue(ok(branding));
      requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
      await expect(SettingsSectionPage(section('branding'))).rejects.toThrow(
        'REDIRECT:/app?notice=no-permission',
      );
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      render(await SettingsSectionPage(section('branding')));
      expect(fetchMock).toHaveBeenCalledWith('/settings/branding');
      expect(propsOf('logo-card')).toEqual({ initial: branding, initialErrorCode: null });
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      expect(nav.textContent).toContain(staffCopy.settings.sections.branding);
    });

    it('a failed read of the logo passes the error code to the card', async () => {
      fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      render(await SettingsSectionPage(section('branding')));
      expect(propsOf('logo-card')).toEqual({ initial: null, initialErrorCode: 'UNAVAILABLE' });
    });

    it('the Staff section needs user.read, reads the list and the options on the server, and passes the code format on', async () => {
      const staffList = { items: [], total: 0, page: 1, pageSize: 25 };
      const staffOptions = {
        roles: [],
        branches: [],
        canWrite: true,
        codeFormat: { prefix: 'STF' },
      };
      fetchMock.mockImplementation(async (path: string) =>
        ok(path === '/staff' ? staffList : staffOptions),
      );
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read']));
      await expect(SettingsSectionPage(section('staff'))).rejects.toThrow(
        'REDIRECT:/app?notice=no-permission',
      );
      requireKindMock.mockResolvedValue(
        hospitalSession(['hospital.settings.read', 'user.read', 'hospital.settings.write']),
      );
      render(await SettingsSectionPage(section('staff')));
      expect(fetchMock).toHaveBeenCalledWith('/staff');
      expect(fetchMock).toHaveBeenCalledWith('/staff/options');
      expect(propsOf('staff-admin')).toEqual({
        initial: staffList,
        options: staffOptions,
        initialErrorCode: null,
      });
      expect(propsOf('code-format')).toEqual({
        initial: { prefix: 'STF' },
        initialErrorCode: null,
        canWrite: true,
      });
      const nav = screen.getByRole('navigation', { name: staffCopy.settings.navAria });
      expect(nav.textContent).toContain(staffCopy.settings.sections.staff);
    });

    it('the code format can only be changed with the settings write permission', async () => {
      fetchMock.mockResolvedValue(ok({ items: [], roles: [], branches: [], codeFormat: {} }));
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read', 'user.read']));
      render(await SettingsSectionPage(section('staff')));
      expect(propsOf('code-format').canWrite).toBe(false);
    });

    it('a failed read of the staff passes an error code, not a blank page', async () => {
      fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read', 'user.read']));
      render(await SettingsSectionPage(section('staff')));
      expect(propsOf('staff-admin')).toEqual({
        initial: null,
        options: null,
        initialErrorCode: 'UNAVAILABLE',
      });
    });

    it('the Roles section needs role.read and reads the roles, the catalog and the templates', async () => {
      const roles = { items: [], canWrite: true };
      const catalog = { items: [{ code: 'a.b', description: 'A', group: 'a' }] };
      const templates = { items: [{ key: 'NURSE' }] };
      fetchMock.mockImplementation(async (path: string) =>
        ok(path === '/roles' ? roles : path === '/roles/catalog' ? catalog : templates),
      );
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read', 'user.read']));
      await expect(SettingsSectionPage(section('roles'))).rejects.toThrow(
        'REDIRECT:/app?notice=no-permission',
      );
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read', 'role.read']));
      render(await SettingsSectionPage(section('roles')));
      expect(propsOf('roles-manager')).toEqual({
        initial: roles,
        catalog: catalog.items,
        templates: templates.items,
        initialErrorCode: null,
      });
    });

    it('a failed read of the roles passes the error code', async () => {
      fetchMock.mockResolvedValue({ status: 'forbidden' });
      requireKindMock.mockResolvedValue(hospitalSession(['hospital.settings.read', 'role.read']));
      render(await SettingsSectionPage(section('roles')));
      expect(propsOf('roles-manager')).toEqual({
        initial: null,
        catalog: null,
        templates: [],
        initialErrorCode: 'FORBIDDEN',
      });
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
        // every page needs settings read; Doctors, Staff and Roles also need their own permission
        const own: Record<string, string> = {
          doctors: 'opd.doctors.read',
          staff: 'user.read',
          roles: 'role.read',
          prices: 'opd.prices.write',
        };
        expect(entry.permission).toBe(own[entry.id] ?? 'hospital.settings.read');
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

describe('My profile page', () => {
  const profile = { id: 'dp1', name: 'Dr Meena', missing: [], limits: {} };
  const me = {
    id: 'u1',
    code: 'STF001',
    name: 'Anita',
    email: 'a@example.test',
    phone: null,
    branches: ['Main Branch'],
    roles: ['Nurse'],
    isDoctor: false,
    limits: { nameMax: 100, phoneMax: 20 },
  };
  const byPath = (map: Record<string, unknown>) => (path: string) =>
    Promise.resolve(map[path] ?? { status: 'error', code: 'UNKNOWN' });

  it('is open to every signed-in role: no doctor permission needed, only the account is read', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockImplementation(byPath({ '/account/me': ok(me) }));
    render(await MyProfilePage());
    expect(fetchMock).toHaveBeenCalledWith('/account/me');
    expect(fetchMock).not.toHaveBeenCalledWith('/doctor-profiles/me');
    expect(screen.getByRole('heading', { name: staffCopy.account.title })).toBeTruthy();
    expect(screen.queryByTestId('my-profile')).toBeNull();
  });

  it('a doctor also gets the doctor part, read on the server', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['opd.doctors.own']));
    fetchMock.mockImplementation(
      byPath({ '/account/me': ok(me), '/doctor-profiles/me': ok(profile) }),
    );
    render(await MyProfilePage());
    expect(fetchMock).toHaveBeenCalledWith('/account/me');
    expect(fetchMock).toHaveBeenCalledWith('/doctor-profiles/me');
    expect(propsOf('my-profile')).toEqual({ initial: profile, initialErrorCode: null });
  });

  it('a login with the doctor permission but no doctor profile gets a calm message, not a form', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['opd.doctors.own']));
    fetchMock.mockImplementation(
      byPath({ '/account/me': ok(me), '/doctor-profiles/me': { status: 'forbidden' } }),
    );
    render(await MyProfilePage());
    expect(screen.getByText(staffCopy.doctorProfile.noProfileTitle)).toBeTruthy();
    expect(screen.queryByTestId('my-profile')).toBeNull();
  });

  it('passes a failed doctor read to the form as an error code', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['opd.doctors.own']));
    fetchMock.mockImplementation(
      byPath({
        '/account/me': ok(me),
        '/doctor-profiles/me': { status: 'error', code: 'UNAVAILABLE' },
      }),
    );
    render(await MyProfilePage());
    expect(propsOf('my-profile')).toEqual({ initial: null, initialErrorCode: 'UNAVAILABLE' });
  });

  it('a failed account read shows the error, not a blank page', async () => {
    requireKindMock.mockResolvedValue(hospitalSession(['patients.registry.read']));
    fetchMock.mockImplementation(
      byPath({ '/account/me': { status: 'error', code: 'UNAVAILABLE' } }),
    );
    render(await MyProfilePage());
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
