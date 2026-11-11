import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import HomePage from './page';
import LoginLayout from './login/layout';
import LoginPage from './login/page';
import AdminLayout from './admin/layout';
import AdminPage from './admin/page';
import StaffLayout from './app/layout';
import StaffHomePage from './app/page';
import BookLayout from './book/[code]/layout';
import BookPage from './book/[code]/page';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';

jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useParams: () => ({ code: 'sample-code' }),
}));

jest.mock('next/link', () => {
  return function Link({ href, children }: { href: string; children: ReactNode }) {
    return <a href={href}>{children}</a>;
  };
});

describe('web shell smoke', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }) as unknown as typeof fetch;
  });

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

  it('renders the HQ page and layout', async () => {
    render(
      <AdminLayout>
        <AdminPage />
      </AdminLayout>,
    );
    expect(screen.getAllByText('Indigo HQ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hospitals').length).toBeGreaterThan(0);
    expect(await screen.findByText('ok')).toBeTruthy();
  });

  it('renders the staff page and layout', () => {
    render(
      <StaffLayout>
        <StaffHomePage />
      </StaffLayout>,
    );
    expect(screen.getAllByText('Hospital staff').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Branch switcher')).toBeTruthy();
    expect(screen.getByText('No records yet')).toBeTruthy();
  });

  it('renders the public booking page and layout', () => {
    render(
      <BookLayout>
        <BookPage />
      </BookLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Book an appointment' })).toBeTruthy();
    expect(screen.getByText('Access code: sample-code')).toBeTruthy();
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
        <AdminPage />
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
