import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import AdminLayout from './layout';
import { HospitalsScreen } from '@/components/admin/hospitals-screen';

jest.mock('next/navigation', () => ({
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

describe('admin hospitals concept screen', () => {
  it('renders mock hospitals, sample badge, Storage wording, and card plus table markup', async () => {
    render(
      <AdminLayout>
        <HospitalsScreen />
      </AdminLayout>,
    );

    expect(screen.getAllByText('Sample data').length).toBeGreaterThan(0);
    expect(
      (screen.getByRole('button', { name: 'Onboard hospital' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((await screen.findAllByText('Demo Hospital One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEMOONE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Onboarding').length).toBeGreaterThan(0);
    expect(screen.getByText('Database, Redis, Storage, WebSocket: all up')).toBeTruthy();
    expect(screen.getByTestId('hospitals-card-list')).toBeTruthy();
    expect(screen.getByTestId('hospitals-table')).toBeTruthy();
    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('marks Hospitals as the current sidebar page', async () => {
    render(
      <AdminLayout>
        <HospitalsScreen loadOptions={{ delayMs: 0 }} />
      </AdminLayout>,
    );
    await screen.findAllByText('Demo Hospital One');
    const current = screen
      .getAllByRole('link', { name: 'Hospitals' })
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
  });

  it('shows loading, empty, and error with retry', async () => {
    const { rerender } = render(<HospitalsScreen loadOptions={{ mode: 'ok', delayMs: 0 }} />);
    await screen.findAllByText('Demo Hospital One');

    rerender(<HospitalsScreen loadOptions={{ mode: 'empty', delayMs: 0 }} />);
    expect(await screen.findByText('No hospitals yet')).toBeTruthy();

    rerender(<HospitalsScreen loadOptions={{ mode: 'error', delayMs: 0 }} />);
    expect(await screen.findByText('Hospitals could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    rerender(<HospitalsScreen loadOptions={{ mode: 'ok', delayMs: 20 }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading hospitals');
    await waitFor(() => {
      expect(screen.getAllByText('Demo Hospital One').length).toBeGreaterThan(0);
    });
  });
});
