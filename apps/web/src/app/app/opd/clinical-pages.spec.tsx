import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import ConsultPage from '@/app/app/opd/visits/[id]/consult/page';
import VitalsPage from '@/app/app/opd/visits/[id]/vitals/page';
import OpdPage from '@/app/app/opd/page';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { makeConsult, makeQueueItem, makeVisit, PULSE } from '@/lib/opd/clinical-test-fixtures';

const sessionMock = jest.fn();
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
  requireKind: async () => sessionMock(),
  requirePermission: async (code: string) => {
    const session = await sessionMock();
    if (!session.permissions?.includes(code)) {
      throw new Error('REDIRECT:/app?notice=no-permission');
    }
    return session;
  },
  redirectToRefresh: async () => {
    throw new Error('REDIRECT:/api/auth/refresh');
  },
}));

jest.mock('@/components/opd/opd-queue', () => ({
  OpdQueue: (props: Record<string, unknown>) => (
    <div data-testid="queue" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/vitals-form', () => ({
  VitalsForm: (props: Record<string, unknown>) => (
    <div data-testid="vitals" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/consult-screen', () => ({
  ConsultScreen: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <div data-testid="consult" data-props={JSON.stringify(props)}>
      {children}
    </div>
  ),
}));
jest.mock('@/components/opd/previous-visits', () => ({
  PreviousVisits: (props: Record<string, unknown>) => (
    <div data-testid="previous" data-props={JSON.stringify(props)} />
  ),
}));

const copy = staffCopy.opd.clinical;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const propsOf = (testId: string) =>
  JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}');
const session = (permissions: string[]) => ({ kind: 'HOSPITAL', permissions });
const DOCTOR = [
  'opd.queue.read',
  'opd.notes.read',
  'opd.notes.write',
  'opd.vitals.read',
  'opd.vitals.write',
];
const NURSE = ['opd.queue.read', 'opd.notes.read', 'opd.vitals.read', 'opd.vitals.write'];
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

beforeEach(() => {
  fetchMock.mockReset();
  sessionMock.mockReset();
});

describe('OPD queue page', () => {
  it('without the queue permission (reception) points to Patients and fetches nothing', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.create']));
    render(await OpdPage());
    expect(screen.getByText(copy.queue.noAccessTitle)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the API refusing the queue shows the same message, other failures show an error', async () => {
    sessionMock.mockResolvedValue(session(DOCTOR));
    fetchMock.mockResolvedValue({ status: 'forbidden' });
    const first = render(await OpdPage());
    expect(screen.getByText(copy.queue.noAccessTitle)).toBeTruthy();
    first.unmount();
    fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
    render(await OpdPage());
    expect(screen.getByText(copy.queue.loadErrorTitle)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });

  it('a doctor gets the queue with Open and Vitals; a nurse only Vitals', async () => {
    const queue = { date: 'd', scope: 'OWN', total: 1, items: [makeQueueItem()] };
    fetchMock.mockResolvedValue(ok(queue));
    sessionMock.mockResolvedValue(session(DOCTOR));
    const first = render(await OpdPage());
    expect(fetchMock).toHaveBeenCalledWith('/opd/queue');
    expect(propsOf('queue')).toMatchObject({
      refreshSeconds: opdWebConfig.queueRefreshSeconds,
      canOpenConsultation: true,
      canViewNotes: true,
      canRecordVitals: true,
      canRequestCancel: false,
    });
    expect(propsOf('queue').initial.items).toHaveLength(1);
    first.unmount();
    sessionMock.mockResolvedValue(session(NURSE));
    render(await OpdPage());
    expect(propsOf('queue')).toMatchObject({
      canOpenConsultation: false,
      canViewNotes: true,
      canRecordVitals: true,
    });
  });
});

describe('vitals page', () => {
  const vitals = { visit: makeVisit(), fields: [] };

  it('needs the vitals permission', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    await expect(VitalsPage(params('visit-1'))).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('fetches the visit vitals and the fields in parallel and passes write permission', async () => {
    sessionMock.mockResolvedValue(session(NURSE));
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/vitals-fields') ? ok({ items: [PULSE] }) : ok(vitals),
    );
    render(await VitalsPage(params('visit/1')));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/visits/visit%2F1/vitals',
      '/opd/vitals-fields',
    ]);
    expect(propsOf('vitals')).toMatchObject({ canWrite: true, backHref: '/app/opd' });
    expect(propsOf('vitals').fields).toHaveLength(1);
  });

  it('read-only for staff without vitals.write', async () => {
    sessionMock.mockResolvedValue(session(['opd.vitals.read']));
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/vitals-fields') ? ok({ items: [PULSE] }) : ok(vitals),
    );
    render(await VitalsPage(params('visit-1')));
    expect(propsOf('vitals').canWrite).toBe(false);
  });

  it('not found and failures are shown in plain words', async () => {
    sessionMock.mockResolvedValue(session(NURSE));
    fetchMock.mockResolvedValue({ status: 'notFound' });
    const first = render(await VitalsPage(params('visit-1')));
    expect(screen.getByText(copy.vitals.notFoundTitle)).toBeTruthy();
    first.unmount();
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/vitals-fields') ? { status: 'error', code: 'UNKNOWN' } : ok(vitals),
    );
    render(await VitalsPage(params('visit-1')));
    expect(screen.getByText(copy.vitals.errorTitle)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.tryAgain);
  });
});

describe('consultation page', () => {
  it('needs the notes permission', async () => {
    sessionMock.mockResolvedValue(session(['opd.queue.read']));
    await expect(ConsultPage(params('visit-1'))).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('fetches the note and the vitals together and streams the previous visits in', async () => {
    sessionMock.mockResolvedValue(session(DOCTOR));
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/vitals')
        ? ok({ visit: makeVisit(), fields: [{ code: 'pulse' }] })
        : ok(makeConsult()),
    );
    render(await ConsultPage(params('visit-1')));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/visits/visit-1/consultation',
      '/opd/visits/visit-1/vitals',
    ]);
    expect(propsOf('consult')).toMatchObject({
      canWrite: true,
      canRecordVitals: true,
      backHref: '/app/opd',
      settings: {
        autosaveSeconds: opdWebConfig.autosaveSeconds,
        minChars: opdWebConfig.medicineSearchMinChars,
        debounceMs: opdWebConfig.medicineSearchDebounceMs,
        limit: opdWebConfig.medicineSearchLimit,
      },
    });
    expect(propsOf('consult').vitals).toEqual([{ code: 'pulse' }]);
    expect(propsOf('previous')).toEqual({ patientId: 'p1', currentVisitId: 'visit-1' });
  });

  it('a nurse reads without write permission; without vitals.read the vitals are not fetched', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    fetchMock.mockResolvedValue(ok(makeConsult()));
    render(await ConsultPage(params('visit-1')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(propsOf('consult')).toMatchObject({
      canWrite: false,
      canRecordVitals: false,
      vitals: [],
    });
  });

  it('a failed vitals fetch does not stop the note from showing', async () => {
    sessionMock.mockResolvedValue(session(DOCTOR));
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/vitals') ? { status: 'error', code: 'UNAVAILABLE' } : ok(makeConsult()),
    );
    render(await ConsultPage(params('visit-1')));
    expect(propsOf('consult').vitals).toEqual([]);
  });

  it('a doctor who may order tests also gets the tests of the visit; a failed fetch does not stop the note', async () => {
    sessionMock.mockResolvedValue(session([...DOCTOR, 'opd.investigations.order']));
    const orders = [
      { id: 'o1', chargeItemId: 't1', code: 'INV001', name: 'Mock', status: 'ORDERED' },
    ];
    fetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/investigations')) {
        return ok({ visitId: 'visit-1', visitStatus: 'IN_CONSULTATION', orders });
      }
      return path.endsWith('/vitals') ? ok({ visit: makeVisit(), fields: [] }) : ok(makeConsult());
    });
    const first = render(await ConsultPage(params('visit-1')));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/visits/visit-1/consultation',
      '/opd/visits/visit-1/investigations',
      '/opd/visits/visit-1/vitals',
    ]);
    expect(propsOf('consult')).toMatchObject({
      canOrderTests: true,
      initialTests: orders,
      settings: {
        testsSearch: {
          minChars: opdWebConfig.testsSearchMinChars,
          debounceMs: opdWebConfig.testsSearchDebounceMs,
          limit: opdWebConfig.testsSearchLimit,
        },
      },
    });
    first.unmount();
    fetchMock.mockImplementation(async (path: string) =>
      path.endsWith('/investigations')
        ? { status: 'error', code: 'UNAVAILABLE' }
        : path.endsWith('/vitals')
          ? ok({ visit: makeVisit(), fields: [] })
          : ok(makeConsult()),
    );
    render(await ConsultPage(params('visit-1')));
    expect(propsOf('consult')).toMatchObject({ canOrderTests: true, initialTests: [] });
  });

  it('a doctor without the ordering permission never asks for tests', async () => {
    sessionMock.mockResolvedValue(session(DOCTOR));
    fetchMock.mockResolvedValue(ok(makeConsult()));
    render(await ConsultPage(params('visit-1')));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('investigations'))).toBe(false);
    expect(propsOf('consult')).toMatchObject({ canOrderTests: false, initialTests: [] });
  });

  it('not found and failures are shown in plain words', async () => {
    sessionMock.mockResolvedValue(session(DOCTOR));
    fetchMock.mockResolvedValue({ status: 'notFound' });
    const first = render(await ConsultPage(params('visit-1')));
    expect(screen.getByText(copy.vitals.notFoundTitle)).toBeTruthy();
    first.unmount();
    fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
    render(await ConsultPage(params('visit-1')));
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });
});
