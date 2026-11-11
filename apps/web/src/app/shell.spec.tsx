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
import { BookingScreen } from '@/components/book/booking-screen';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';

jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useParams: () => ({ code: 'DEMOONE' }),
  usePathname: () => '/admin',
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
  it('redirects / to /login', () => {
    expect(() => HomePage()).toThrow('REDIRECT:/login');
  });

  it('renders the login page and layout', () => {
    render(
      <LoginLayout>
        <LoginPage />
      </LoginLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('renders the HQ page and layout with page context in the top bar', async () => {
    render(
      <AdminLayout>
        <HospitalsScreen loadOptions={{ delayMs: 0 }} />
      </AdminLayout>,
    );
    expect(screen.getAllByText('Hospigo HQ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hospitals').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Demo Hospital One')).length).toBeGreaterThan(0);
    const current = screen
      .getAllByRole('link', { name: 'Hospitals' })
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
  });

  it('renders the staff page and layout', () => {
    render(
      <StaffLayout>
        <StaffDashboardPage />
      </StaffLayout>,
    );
    expect(screen.getAllByText('Demo Hospital One').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Branch switcher').textContent).toContain('Main Branch (sample)');
    expect(screen.getByText('Coming later.')).toBeTruthy();
  });

  it('renders the public booking page and layout', async () => {
    render(
      <BookLayout>
        <BookingScreen code="DEMOONE" loadOptions={{ delayMs: 0 }} />
      </BookLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Book an OPD appointment' })).toBeTruthy();
    expect(await screen.findByText('Demo Doctor A')).toBeTruthy();
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

  it('opens and closes the mobile navigation menu', () => {
    render(
      <AdminLayout>
        <HospitalsScreen loadOptions={{ delayMs: 0 }} />
      </AdminLayout>,
    );

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
