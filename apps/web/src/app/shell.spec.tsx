import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import HomePage from './page';
import LoginLayout from './login/layout';
import LoginPage from './login/page';
import AdminLayout from './admin/layout';
import { HospitalsScreen } from '@/components/admin/hospitals-screen';
import StaffLayout from './app/layout';
import StaffDashboardPage from './app/page';
import BookLayout from './book/[code]/layout';
import { BookingComingSoon } from '@/components/book/booking-coming-soon';
import { staffCopy } from '@/config/staff-copy';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';

jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useParams: () => ({ code: 'DEMOONE' }),
  usePathname: () => '/admin',
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/auth/session', () => ({
  getSession: jest.fn(async () => null),
  homeForKind: (kind: 'HQ' | 'HOSPITAL') => (kind === 'HQ' ? '/admin' : '/app'),
}));

jest.mock('@/lib/auth/guards', () => ({
  requireKind: jest.fn(async (kind: 'HQ' | 'HOSPITAL') => ({
    id: 'u1',
    displayName: 'Test User',
    email: 'test@example.test',
    kind,
    hospitalName: kind === 'HOSPITAL' ? 'Demo Hospital One' : null,
    activeBranchId: kind === 'HOSPITAL' ? 'b1' : null,
    activeBranchName: kind === 'HOSPITAL' ? 'North Main' : null,
    roleCodes: kind === 'HOSPITAL' ? ['RECEPTIONIST'] : ['HQ_ADMIN'],
    mustChangePassword: false,
    branches: kind === 'HOSPITAL' ? [{ id: 'b1', name: 'North Main', isMain: true }] : [],
    enabledModules:
      kind === 'HOSPITAL'
        ? [
            { code: 'OPD', name: 'OPD' },
            { code: 'IPD', name: 'IPD' },
            { code: 'PHARMACY', name: 'Pharmacy' },
          ]
        : [],
    permissions: kind === 'HOSPITAL' ? ['patients.registry.read', 'patients.registry.write'] : [],
  })),
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

describe('web shell smoke', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
  });

  it('redirects / to /login', () => {
    expect(() => HomePage()).toThrow('REDIRECT:/login');
  });

  it('renders the login page and layout', async () => {
    const layout = await LoginLayout({ children: <LoginPage /> });
    render(layout);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('renders the HQ page and layout with sidebar navigation', async () => {
    const layout = await AdminLayout({
      children: <HospitalsScreen loadOptions={{ delayMs: 0 }} />,
    });
    render(layout);
    expect(screen.getAllByText('Hospigo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hospitals').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Demo Hospital One')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeTruthy();
    expect(screen.getByText('Powered by Indigo')).toBeTruthy();
    const current = screen
      .getAllByRole('link', { name: 'Hospitals' })
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
  });

  it('renders the staff page and layout', async () => {
    const page = await StaffDashboardPage({});
    const layout = await StaffLayout({ children: page });
    render(layout);
    expect(screen.getAllByText('Demo Hospital One').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Active branch').textContent).toContain('North Main');
    expect(screen.getByRole('link', { name: 'Patients' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'OPD queue' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    const navOrder = screen
      .getAllByRole('link')
      .map((el) => el.textContent ?? '')
      .filter((t) => ['Dashboard', 'Patients', 'OPD queue'].includes(t));
    expect(navOrder.slice(0, 3)).toEqual(['Dashboard', 'Patients', 'OPD queue']);
    // the dashboard offers only what this person may do (reception here: no settings)
    expect(screen.getByRole('link', { name: /Register a patient/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Find a patient/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Hospital settings/ })).toBeNull();
    expect(screen.queryByText('Coming later.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.getByText('Powered by Indigo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('shows module unavailable notice on the dashboard', async () => {
    const page = await StaffDashboardPage({
      searchParams: Promise.resolve({ notice: 'module-unavailable' }),
    });
    const layout = await StaffLayout({ children: page });
    render(layout);
    expect(screen.getByRole('status').textContent).toMatch(/not available/i);
  });

  it('shows no-permission notice on the dashboard', async () => {
    const page = await StaffDashboardPage({
      searchParams: Promise.resolve({ notice: 'no-permission' }),
    });
    const layout = await StaffLayout({ children: page });
    render(layout);
    expect(screen.getByRole('status').textContent).toMatch(/permission/i);
  });

  it('renders the public booking page and layout', () => {
    render(
      <BookLayout>
        <BookingComingSoon />
      </BookLayout>,
    );
    expect(screen.getByRole('heading', { name: staffCopy.booking.heading })).toBeTruthy();
  });

  it('renders loading, empty, and error states', () => {
    const onRetry = jest.fn();
    render(
      <div>
        <LoadingState label="Loading records" />
        <EmptyState title="No records yet" />
        <ErrorState message="Something went wrong." onRetry={onRetry} />
      </div>,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading records');
    expect(screen.getByText('No records yet')).toBeTruthy();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('opens and closes the mobile navigation menu', async () => {
    const layout = await AdminLayout({
      children: <HospitalsScreen loadOptions={{ delayMs: 0 }} />,
    });
    render(layout);

    const openMenu = screen.getByRole('button', { name: 'Open menu' });
    expect(openMenu).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();

    fireEvent.click(openMenu);
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    expect(openMenu.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
    expect(openMenu.getAttribute('aria-expanded')).toBe('false');
  });
});
