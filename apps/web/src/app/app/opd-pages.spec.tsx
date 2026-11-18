import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import NewVisitPage from '@/app/app/patients/[id]/visits/new/page';
import VisitReceiptPage from '@/app/app/opd/visits/[id]/receipt/page';
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
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
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

jest.mock('@/components/opd/new-visit-form', () => ({
  NewVisitForm: (props: Record<string, unknown>) => (
    <div data-testid="new-visit-form" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/visit-receipt', () => ({
  VisitReceipt: (props: Record<string, unknown>) => (
    <div data-testid="visit-receipt" data-props={JSON.stringify(props)} />
  ),
}));

const NO_PERMISSION = 'REDIRECT:/app?notice=no-permission';
const idParams = { params: Promise.resolve({ id: 'p1' }) };
const patient = { id: 'p1', uhid: 'U1', name: 'Mock Alpha', phone: '+919876543210' };
const doctors = { items: [{ id: 'd1', name: 'Dr Meena' }] };

function session(permissions: string[]) {
  return { id: 'u1', kind: 'HOSPITAL', hospitalName: 'Demo Hospital One', permissions };
}
const ok = (data: unknown) => ({ status: 'ok', data });
function propsOf(testId: string): Record<string, unknown> {
  return JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}');
}

describe('OPD pages (server)', () => {
  beforeEach(() => {
    requireKindMock.mockReset();
    fetchMock.mockReset();
  });

  describe('new visit page', () => {
    it('needs opd.visits.create', async () => {
      requireKindMock.mockResolvedValue(session(['patients.registry.read']));
      await expect(NewVisitPage(idParams)).rejects.toThrow(NO_PERMISSION);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('also needs opd.billing.collect: without it nothing is fetched and a message is shown', async () => {
      requireKindMock.mockResolvedValue(session(['opd.visits.create']));
      render(await NewVisitPage(idParams));
      expect(screen.getByText(staffCopy.opd.newVisit.noPermissionTitle)).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('new-visit-form')).toBeNull();
    });

    it('fetches the patient and the doctors together and passes only what the form needs', async () => {
      requireKindMock.mockResolvedValue(session(['opd.visits.create', 'opd.billing.collect']));
      fetchMock.mockImplementation(async (path: string) =>
        path === '/opd/doctors' ? ok(doctors) : ok(patient),
      );
      render(await NewVisitPage(idParams));
      expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
        '/opd/doctors',
        '/patients/p1',
      ]);
      const props = propsOf('new-visit-form');
      expect(props).toEqual({
        patient: { id: 'p1', name: 'Mock Alpha', uhid: 'U1' },
        doctors: doctors.items,
      });
      // Phone and other personal fields never reach the client form.
      expect(JSON.stringify(props)).not.toContain('9876543210');
    });

    it('patient not found, patient error and doctors error show calm messages', async () => {
      requireKindMock.mockResolvedValue(session(['opd.visits.create', 'opd.billing.collect']));
      fetchMock.mockImplementation(async (path: string) =>
        path === '/opd/doctors' ? ok(doctors) : { status: 'notFound' },
      );
      const first = render(await NewVisitPage(idParams));
      expect(screen.getByText(staffCopy.patients.record.notFoundTitle)).toBeTruthy();
      first.unmount();

      fetchMock.mockImplementation(async (path: string) =>
        path === '/opd/doctors' ? ok(doctors) : { status: 'error', code: 'UNAVAILABLE' },
      );
      const second = render(await NewVisitPage(idParams));
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
      second.unmount();

      fetchMock.mockImplementation(async (path: string) =>
        path === '/opd/doctors' ? { status: 'forbidden' } : ok(patient),
      );
      render(await NewVisitPage(idParams));
      expect(screen.getByText(staffCopy.opd.newVisit.doctorsErrorTitle)).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    });
  });

  describe('receipt page', () => {
    it('needs opd.visits.read', async () => {
      requireKindMock.mockResolvedValue(session(['patients.registry.read']));
      await expect(VisitReceiptPage(idParams)).rejects.toThrow(NO_PERMISSION);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches the visit, injects the page size from config, and passes the hospital name', async () => {
      requireKindMock.mockResolvedValue(session(['opd.visits.read', 'opd.billing.read']));
      fetchMock.mockResolvedValue(ok({ id: 'p1', patient: { id: 'p1' } }));
      const { container } = render(await VisitReceiptPage(idParams));
      expect(fetchMock).toHaveBeenCalledWith('/opd/visits/p1');
      expect(propsOf('visit-receipt')).toMatchObject({ hospitalName: 'Demo Hospital One' });
      expect(container.querySelector('style')?.textContent).toBe('@page { size: A5; margin: 0; }');
    });

    it('not found and errors show calm messages', async () => {
      requireKindMock.mockResolvedValue(session(['opd.visits.read']));
      fetchMock.mockResolvedValue({ status: 'notFound' });
      const first = render(await VisitReceiptPage(idParams));
      expect(screen.getByText(staffCopy.opd.receipt.notFoundTitle)).toBeTruthy();
      first.unmount();
      fetchMock.mockResolvedValue({ status: 'error', code: 'UNKNOWN' });
      render(await VisitReceiptPage(idParams));
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.tryAgain);
    });
  });
});
