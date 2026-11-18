import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import StaffLayout from './layout';
import OpdPage from './opd/page';
import { staffCopy } from '@/config/staff-copy';
import { makeQueueItem } from '@/lib/opd/clinical-test-fixtures';

const fetchMock = jest.fn();
let permissions: string[] = [];

jest.mock('next/navigation', () => ({
  usePathname: () => '/app/opd',
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/patients/server', () => ({
  ...jest.requireActual('@/lib/patients/server'),
  fetchStaffOnServer: (...args: unknown[]) => fetchMock(...args),
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
    branches: [{ id: 'b1', name: 'Main', isMain: true }],
    enabledModules: [
      { code: 'OPD', name: 'OPD' },
      { code: 'IPD', name: 'IPD' },
      { code: 'PHARMACY', name: 'Pharmacy' },
    ],
    permissions,
  })),
}));

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.clinical.queue;

beforeEach(() => {
  fetchMock.mockReset();
  permissions = ['opd.queue.read', 'opd.notes.write', 'opd.vitals.write'];
});

describe('OPD queue page inside the staff shell', () => {
  it('shows the REAL queue (no sample badge) and marks OPD queue as the current page', async () => {
    fetchMock.mockResolvedValue({
      status: 'ok',
      data: { date: 'd', scope: 'OWN', total: 1, items: [makeQueueItem()] },
    });
    render(await StaffLayout({ children: await OpdPage() }));
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.queryByText('Sample data')).toBeNull();
    expect(screen.getAllByText('Demo Hospital One').length).toBeGreaterThan(0);
    const current = screen
      .getAllByRole('link', { name: 'OPD queue' })
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Active branch').textContent).toContain('Main');
    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('reception (no queue permission) sees a pointer to Patients, not fake numbers', async () => {
    permissions = ['opd.visits.create'];
    render(await StaffLayout({ children: await OpdPage() }));
    expect(screen.getByText(copy.noAccessTitle)).toBeTruthy();
    expect(screen.queryByText('Sample data')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
