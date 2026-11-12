import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import StaffLayout from './layout';
import { OpdQueueScreen } from '@/components/app/opd-queue-screen';

jest.mock('next/navigation', () => ({
  usePathname: () => '/app/opd',
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/auth/guards', () => ({
  requireKind: jest.fn(async () => ({
    id: 'u1',
    displayName: 'Staff User',
    email: 'staff@demo-north.example.test',
    kind: 'HOSPITAL',
    hospitalName: 'Demo Hospital One',
    activeBranchId: 'b1',
    activeBranchName: 'Main',
    roleCodes: [],
    mustChangePassword: false,
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

describe('OPD queue concept screen', () => {
  it('renders mock queue data, sample badge, and three status chip variants', async () => {
    const layout = await StaffLayout({ children: <OpdQueueScreen /> });
    render(layout);

    expect(screen.getAllByText('Sample data').length).toBeGreaterThan(0);
    expect(screen.getByText('Powered by Hospigo')).toBeTruthy();
    expect(screen.getAllByText('Demo Hospital One').length).toBeGreaterThan(0);
    expect(await screen.findByText(/Demo Doctor A/)).toBeTruthy();
    expect(screen.getByText('Sample Patient 01')).toBeTruthy();
    expect(screen.getAllByText('In consultation').length).toBeGreaterThan(0);
    expect(
      (screen.getByRole('button', { name: 'Call next patient' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const consultation = document.querySelector('[data-status="In consultation"]');
    const paid = document.querySelector('[data-status="Checked in paid"]');
    const unpaid = document.querySelector('[data-status="Booked unpaid at desk"]');
    expect(consultation).toBeTruthy();
    expect(paid).toBeTruthy();
    expect(unpaid).toBeTruthy();
    expect(consultation?.classList.contains('status-chip')).toBe(true);
    expect(paid?.classList.contains('status-chip')).toBe(true);
    expect(unpaid?.classList.contains('status-chip')).toBe(true);

    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('marks OPD queue as the current sidebar page', async () => {
    const layout = await StaffLayout({
      children: <OpdQueueScreen loadOptions={{ delayMs: 0 }} />,
    });
    render(layout);
    await screen.findByText('Sample Patient 01');
    const current = screen
      .getAllByRole('link', { name: 'OPD queue' })
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
  });

  it('shows Main Branch (sample) in the branch switcher', async () => {
    const layout = await StaffLayout({
      children: <OpdQueueScreen loadOptions={{ delayMs: 0 }} />,
    });
    render(layout);
    expect(screen.getByLabelText('Branch switcher').textContent).toContain('Main Branch (sample)');
  });

  it('shows loading, empty, and error with retry', async () => {
    const { rerender } = render(<OpdQueueScreen loadOptions={{ mode: 'ok', delayMs: 0 }} />);
    await screen.findByText('Sample Patient 01');

    rerender(<OpdQueueScreen loadOptions={{ mode: 'empty', delayMs: 0 }} />);
    expect(await screen.findByText('No tokens yet')).toBeTruthy();

    rerender(<OpdQueueScreen loadOptions={{ mode: 'error', delayMs: 0 }} />);
    expect(await screen.findByText('OPD queue could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    rerender(<OpdQueueScreen loadOptions={{ mode: 'ok', delayMs: 20 }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading OPD queue');
    await waitFor(() => {
      expect(screen.getByText('Sample Patient 01')).toBeTruthy();
    });
  });
});
