import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PreviousVisits } from '@/components/opd/previous-visits';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const fetchMock = jest.fn();
jest.mock('@/lib/patients/server', () => ({
  fetchStaffOnServer: (...args: unknown[]) => fetchMock(...args),
}));

const copy = staffCopy.opd.clinical.consult;
const visit = (id: string, status: string, date: string, doctor = 'Dr Meena') => ({
  id,
  status,
  visitDate: date,
  doctor: { id: 'd1', code: 'DR1', name: doctor },
});

async function show(items: unknown[], currentVisitId = 'now') {
  fetchMock.mockResolvedValue({
    status: 'ok',
    data: { items, total: items.length, page: 1, pageSize: 10 },
  });
  render(await PreviousVisits({ patientId: 'p/1', currentVisitId }));
}

beforeEach(() => fetchMock.mockReset());

describe('PreviousVisits', () => {
  it('lists only earlier COMPLETED visits (not this one, not unfinished ones) with a link each', async () => {
    await show([
      visit('now', 'COMPLETED', '2026-11-19'),
      visit('a', 'COMPLETED', '2026-11-10'),
      visit('b', 'WAITING', '2026-11-12'),
      visit('c', 'CANCELLED', '2026-11-11'),
      visit('d', 'COMPLETED', '2026-10-01', 'Dr Rao'),
    ]);
    const links = screen.getAllByRole('link', { name: copy.previousOpen });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/app/opd/visits/a/consult',
      '/app/opd/visits/d/consult',
    ]);
    expect(screen.getByText(/10 Nov 2026 · Dr Meena/)).toBeTruthy();
    expect(screen.getByText(/01 Oct 2026 · Dr Rao/)).toBeTruthy();
  });

  it('asks the API for the patient visits (id encoded) and shows at most the configured number', async () => {
    const many = Array.from({ length: 12 }, (_, i) => visit(`v${i}`, 'COMPLETED', '2026-11-01'));
    await show(many);
    expect(fetchMock).toHaveBeenCalledWith('/patients/p%2F1/visits', {
      pageSize: opdWebConfig.previousVisitsLimit + 5,
    });
    expect(screen.getAllByRole('link', { name: copy.previousOpen })).toHaveLength(
      opdWebConfig.previousVisitsLimit,
    );
  });

  it('says there are none, and never breaks the page when the list cannot be loaded', async () => {
    await show([]);
    expect(screen.getByText(copy.previousEmpty)).toBeTruthy();
    fetchMock.mockResolvedValue({ status: 'forbidden' });
    render(await PreviousVisits({ patientId: 'p1', currentVisitId: 'now' }));
    expect(screen.getAllByText(copy.previousEmpty)).toHaveLength(2);
  });
});
