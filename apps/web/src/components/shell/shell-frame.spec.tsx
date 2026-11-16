import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { BranchChip } from '@/components/shell/branch-chip';
import { PatientSearch } from '@/components/shell/patient-search';
import { PoweredBy } from '@/components/shell/powered-by';
import { UserMenu } from '@/components/shell/user-menu';
import { SampleDataBadge } from '@/components/sample-data-badge';
import { formatRoleLabel, formatRoleLabels, staffCopy } from '@/config/staff-copy';
import * as brandingModule from '@/config/branding';
import StaffLayout from '@/app/app/layout';
import SettingsPage from '@/app/app/settings/page';
import { metadata as dashboardMetadata } from '@/app/app/page';

jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => '/app',
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
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

const requireKindMock = jest.fn();
const requirePermissionMock = jest.fn();

jest.mock('@/lib/auth/guards', () => ({
  requireKind: (...args: unknown[]) => requireKindMock(...args),
  requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
}));

function hospitalSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    displayName: 'Ada Lovelace',
    email: 'ada@example.test',
    kind: 'HOSPITAL',
    hospitalName: 'Demo Hospital One',
    activeBranchId: 'b1',
    activeBranchName: 'North Main',
    roleCodes: ['RECEPTIONIST'],
    mustChangePassword: false,
    branches: [{ id: 'b1', name: 'North Main', isMain: true }],
    enabledModules: [{ code: 'OPD', name: 'OPD' }],
    permissions: ['patients.registry.read'],
    ...overrides,
  };
}

describe('shell frame', () => {
  beforeEach(() => {
    window.localStorage.clear();
    requireKindMock.mockReset();
    requirePermissionMock.mockReset();
    requireKindMock.mockResolvedValue(hospitalSession());
    requirePermissionMock.mockImplementation(async (code: string) => {
      const session = await requireKindMock('HOSPITAL');
      if (!session.permissions?.includes(code)) {
        throw new Error('REDIRECT:/app?notice=no-permission');
      }
      return session;
    });
  });

  it('toggles sidebar collapse and persists the preference', async () => {
    render(
      <AppShell
        title="Demo"
        items={[{ href: '/app', label: 'Dashboard', icon: 'dashboard' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: staffCopy.shell.collapseSidebar })).toBeTruthy();
    });
    const toggle = screen.getByRole('button', { name: staffCopy.shell.collapseSidebar });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole('button', { name: staffCopy.shell.expandSidebar })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(window.localStorage.getItem(staffCopy.shell.collapsedStorageKey)).toBe('1');
  });

  it('expanded header puts hospital name on its own ellipsis row', async () => {
    render(
      <AppShell
        title="Demo North Clinic"
        brandLabel={staffCopy.brand}
        items={[{ href: '/app', label: 'Dashboard', icon: 'dashboard' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: staffCopy.shell.collapseSidebar })).toBeTruthy();
    });
    const sidebar = screen.getByTestId('shell-sidebar');
    const hospital = sidebar.querySelector('.shell-brand-hospital');
    expect(hospital).toBeTruthy();
    expect(hospital?.textContent).toBe('Demo North Clinic');
    expect(hospital?.classList.contains('shell-brand-hospital')).toBe(true);
    expect(hospital?.classList.contains('truncate')).toBe(true);
    const wordmark = within(sidebar).getByText(staffCopy.brand);
    expect(wordmark.textContent).toBe(staffCopy.brand);
    expect(wordmark.classList.contains('whitespace-nowrap')).toBe(true);
    expect(wordmark.classList.contains('truncate')).toBe(false);
    expect(wordmark.classList.contains('sr-only')).toBe(false);
  });

  it('collapsed header shows only the mark with accessible brand name', async () => {
    window.localStorage.setItem(staffCopy.shell.collapsedStorageKey, '1');
    render(
      <AppShell
        title="Demo Hospital One"
        brandLabel={staffCopy.brand}
        items={[{ href: '/app/patients', label: 'Patients', icon: 'patients' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: staffCopy.shell.expandSidebar })).toBeTruthy();
    });
    const sidebar = screen.getByTestId('shell-sidebar');
    expect(sidebar.className).toContain('is-collapsed');
    expect(within(sidebar).getByText(staffCopy.brandMark)).toBeTruthy();
    const wordmark = within(sidebar).getByText(staffCopy.brand);
    expect(
      wordmark.closest('.sr-only') || wordmark.parentElement?.classList.contains('sr-only'),
    ).toBeTruthy();
    expect(sidebar.querySelector('.shell-brand-hospital')).toBeNull();
    expect(within(sidebar).getByLabelText(`${staffCopy.brand}, Demo Hospital One`)).toBeTruthy();
  });

  it('shows tooltip on hover and focus and dismisses on Escape', async () => {
    window.localStorage.setItem(staffCopy.shell.collapsedStorageKey, '1');
    render(
      <AppShell
        title="Demo"
        items={[{ href: '/app/patients', label: 'Patients', icon: 'patients' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Patients' })).toBeTruthy();
    });
    const link = screen.getByRole('link', { name: 'Patients' });
    fireEvent.mouseEnter(link.parentElement!);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(link);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  it('toggles with Ctrl+B and ignores the shortcut inside an input', async () => {
    render(
      <AppShell
        title="Demo"
        items={[{ href: '/app', label: 'Dashboard', icon: 'dashboard' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
        showPatientSearch
      >
        <div />
      </AppShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: staffCopy.shell.collapseSidebar })).toBeTruthy();
    });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(window.localStorage.getItem(staffCopy.shell.collapsedStorageKey)).toBe('1');
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(window.localStorage.getItem(staffCopy.shell.collapsedStorageKey)).toBe('1');
  });

  it('does not render empty group labels', () => {
    render(
      <AppShell
        title="Demo"
        groups={[
          { label: '', items: [{ href: '/app', label: 'Dashboard', icon: 'dashboard' }] },
          { label: 'Setup', items: [] },
        ]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );
    expect(screen.queryByText('Setup')).toBeNull();
  });

  it('puts Settings last only when hospital.settings.read is present', async () => {
    requireKindMock.mockResolvedValue(
      hospitalSession({
        permissions: ['patients.registry.read', 'hospital.settings.read'],
        roleCodes: ['BRANCH_ADMIN'],
      }),
    );
    const withSettings = await StaffLayout({ children: <div /> });
    const { unmount } = render(withSettings);
    const links = screen
      .getAllByRole('link')
      .filter((el) =>
        ['Patients', 'Dashboard', 'OPD queue', 'Settings'].includes(el.textContent ?? ''),
      );
    expect(links[links.length - 1]?.textContent).toContain('Settings');
    unmount();

    requireKindMock.mockResolvedValue(hospitalSession({ permissions: ['patients.registry.read'] }));
    const without = await StaffLayout({ children: <div /> });
    render(without);
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('guards the settings page on hospital.settings.read', async () => {
    requireKindMock.mockResolvedValue(hospitalSession({ permissions: ['patients.registry.read'] }));
    await expect(SettingsPage()).rejects.toThrow('REDIRECT:/app?notice=no-permission');

    requireKindMock.mockResolvedValue(
      hospitalSession({
        permissions: ['hospital.settings.read'],
        roleCodes: ['BRANCH_ADMIN'],
      }),
    );
    const page = await SettingsPage();
    render(page);
    expect(screen.getByRole('heading', { name: staffCopy.settings.title })).toBeTruthy();
  });

  it('PoweredBy shows text when indigoLogo is null and image when set', () => {
    const { unmount } = render(<PoweredBy />);
    expect(screen.getByText(staffCopy.poweredByIndigo)).toBeTruthy();
    unmount();

    const original = brandingModule.branding.indigoLogo;
    brandingModule.branding.indigoLogo = {
      src: '/brand/indigo.svg',
      alt: 'Indigo',
      width: 80,
      height: 20,
    };
    render(<PoweredBy />);
    expect(screen.getByAltText('Indigo')).toBeTruthy();
    brandingModule.branding.indigoLogo = original;
  });

  it('renders the patient search form markup', () => {
    render(<PatientSearch />);
    const form = screen.getByRole('search');
    expect(form.getAttribute('method')?.toLowerCase()).toBe('get');
    expect(form.getAttribute('action')).toBe('/app/patients');
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.name).toBe('q');
  });

  it('focuses the search input on / and blurs on Escape', () => {
    render(<PatientSearch />);
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('user menu shows name, email, role badge, branch, hospital, and sign out', () => {
    render(
      <UserMenu
        displayName="Ada Lovelace"
        email="ada@example.test"
        roleCodes={['RECEPTIONIST']}
        branchName="North Main"
        hospitalName="Demo Hospital One"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: staffCopy.shell.userMenuAria }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(menu).getByText('ada@example.test')).toBeTruthy();
    expect(within(menu).getByText('Receptionist')).toBeTruthy();
    expect(within(menu).getByText('North Main')).toBeTruthy();
    expect(within(menu).getByText('Demo Hospital One')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: staffCopy.signOut })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('user menu email exposes full address via tooltip and roles wrap in one row', async () => {
    const longEmail = 'ada.lovelace.very.long.address@example.test';
    render(
      <UserMenu
        displayName="Ada Lovelace"
        email={longEmail}
        roleCodes={['RECEPTIONIST', 'NURSE', 'DOCTOR']}
        branchName="North Main"
        hospitalName="Demo Hospital One"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: staffCopy.shell.userMenuAria }));
    const menu = screen.getByRole('menu');
    const emailEl = within(menu).getByText(longEmail);
    expect(emailEl.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(emailEl);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    expect(screen.getByRole('tooltip').textContent).toBe(longEmail);
    const roles = within(menu).getByTestId('user-menu-roles');
    expect(roles.classList.contains('shell-user-menu-roles')).toBe(true);
    expect(within(roles).getByText('Receptionist')).toBeTruthy();
    expect(within(roles).getByText('Nurse')).toBeTruthy();
    expect(within(roles).getByText('Doctor')).toBeTruthy();
    expect(roles.children.length).toBe(3);
  });

  it('branch chip is not interactive for hospital-wide and branch-scoped users', () => {
    for (const role of ['SUPER_ADMIN', 'RECEPTIONIST']) {
      const { unmount } = render(<BranchChip name={`Branch for ${role}`} />);
      const chip = screen.getByLabelText(staffCopy.shell.branchChipAria);
      expect(chip.tagName).toBe('SPAN');
      expect(chip.getAttribute('role')).toBeNull();
      expect(chip.getAttribute('tabindex')).toBeNull();
      expect(chip.closest('button')).toBeNull();
      expect(chip.closest('a')).toBeNull();
      unmount();
    }
  });

  it('skip link targets the main landmark', () => {
    render(
      <AppShell
        title="Demo"
        items={[{ href: '/app', label: 'Dashboard', icon: 'dashboard' }]}
        userDisplayName="Ada"
        userEmail="ada@example.test"
        roleCodes={['RECEPTIONIST']}
      >
        <div />
      </AppShell>,
    );
    const skip = screen.getByRole('link', { name: staffCopy.skipToMain });
    expect(skip.getAttribute('href')).toBe(`#${staffCopy.mainLandmarkId}`);
    expect(document.getElementById(staffCopy.mainLandmarkId)?.tagName).toBe('MAIN');
  });

  it('exports a staff page title for the template', () => {
    expect(dashboardMetadata.title).toBe(staffCopy.pageTitles.dashboard);
  });

  it('maps role labels and title-cases unknown codes', () => {
    expect(formatRoleLabel('RECEPTIONIST')).toBe('Receptionist');
    expect(formatRoleLabel('CUSTOM_ROLE')).toBe('Custom Role');
    expect(formatRoleLabels(['NURSE', 'DOCTOR'])).toBe('Nurse, Doctor');
  });

  it('renders SampleDataBadge as a content-sized pill', () => {
    render(<SampleDataBadge />);
    const badge = screen.getByText(staffCopy.sampleData);
    expect(badge.classList.contains('sample-data-badge')).toBe(true);
  });
});
