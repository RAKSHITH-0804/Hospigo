import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConsultScreen } from '@/components/opd/consult-screen';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { makeConsult, makeNote, makeVisit } from '@/lib/opd/clinical-test-fixtures';
import type { OrderView } from '@/lib/opd/tests-types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.tests.doctor;
const consultCopy = staffCopy.opd.clinical.consult;
const fetchMock = jest.fn();
const settings = {
  autosaveSeconds: 5,
  minChars: 2,
  debounceMs: 300,
  limit: 10,
  calendarWeekStart: 1,
  followUpQuickDays: [1, 3, 7],
  testsSearch: { minChars: 2, debounceMs: 300, limit: 10 },
};
const url = (tail: string) => `/api/staff/opd/visits/visit-1${tail}`;
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const started = () =>
  makeVisit({ status: 'IN_CONSULTATION', consultationStartedAt: '2026-11-19T04:10:00.000Z' });
const finished = () => makeVisit({ status: 'COMPLETED', completedAt: '2026-11-19T04:30:00.000Z' });

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: 'o1',
  chargeItemId: 't1',
  code: 'INV001',
  name: 'Mock Test 001',
  status: 'ORDERED',
  notTakenReason: null,
  billNumber: null,
  orderedAt: '2026-11-20T04:00:00.000Z',
  resolvedAt: null,
  ...over,
});

type Handler = (body: Record<string, unknown>) => unknown;
function api(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
    const method = init?.method ?? 'GET';
    const key = `${method} ${path}`;
    const handler = handlers[key] ?? handlers[`${method} ${path.split('?')[0]}`];
    if (!handler) {
      throw new Error(`unexpected fetch ${key}`);
    }
    return handler(init?.body ? JSON.parse(String(init.body)) : {});
  });
}
const sent = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`);

function renderScreen(
  over: {
    initial?: ReturnType<typeof makeConsult>;
    tests?: OrderView[];
    canOrderTests?: boolean;
    withSettings?: boolean;
  } = {},
) {
  return render(
    <ConsultScreen
      initial={over.initial ?? makeConsult({ visit: started(), consultation: makeNote() })}
      vitals={[]}
      canWrite
      canRecordVitals
      canOrderTests={over.canOrderTests ?? true}
      initialTests={over.tests ?? []}
      settings={over.withSettings === false ? { ...settings, testsSearch: undefined } : settings}
      backHref="/app/opd"
    />,
  );
}

const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const search = async (text: string) => {
  fireEvent.change(screen.getByLabelText(copy.searchLabel), { target: { value: text } });
  await wait(400);
};

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('doctor Tests box on the consultation screen', () => {
  it('shows with the permission and settings; staff without them see no box', () => {
    const { unmount } = renderScreen();
    expect(screen.getByRole('region', { name: copy.heading })).toBeTruthy();
    expect(screen.getByText(copy.empty)).toBeTruthy();
    unmount();
    renderScreen({ canOrderTests: false });
    expect(screen.queryByRole('region', { name: copy.heading })).toBeNull();
  });

  it('is hidden when the search settings are not given', () => {
    renderScreen({ withSettings: false });
    expect(screen.queryByRole('region', { name: copy.heading })).toBeNull();
  });

  it('searches the tests list (no prices) and adds a test as a chip, once', async () => {
    api({
      'GET /api/staff/opd/investigations/tests': () =>
        json({
          items: [
            { id: 't1', code: 'INV001', name: 'Mock Test 001' },
            { id: 't2', code: 'INV002', name: 'Mock Test 002' },
          ],
        }),
    });
    renderScreen();
    await search('mock');
    expect(sent()).toEqual(['GET /api/staff/opd/investigations/tests?q=mock&limit=10']);
    expect(screen.queryByText(/₹/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mock Test 001' }));
    expect(screen.getByText(/Mock Test 001 · Ordered/)).toBeTruthy();
    // already chosen: not offered again
    await search('mock');
    expect(screen.queryByRole('button', { name: 'Mock Test 001' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mock Test 002' })).toBeTruthy();
  });

  it('does not search below the minimum characters and shows a clear message when nothing matches', async () => {
    api({ 'GET /api/staff/opd/investigations/tests': () => json({ items: [] }) });
    renderScreen();
    await search('m');
    expect(fetchMock).not.toHaveBeenCalled();
    await search('zzz');
    expect(screen.getByText(copy.searchNone)).toBeTruthy();
  });

  it('a failed search says so and offers nothing', async () => {
    api({ 'GET /api/staff/opd/investigations/tests': () => json({ code: 'UNKNOWN' }, 500) });
    renderScreen();
    await search('mock');
    expect(screen.getByRole('alert').textContent).toContain(copy.searchError);
  });

  it('saves the list by itself after the autosave delay, and shows the server status', async () => {
    api({
      'GET /api/staff/opd/investigations/tests': () =>
        json({ items: [{ id: 't1', code: 'INV001', name: 'Mock Test 001' }] }),
      'PUT /api/staff/opd/visits/visit-1/investigations': (body) => {
        expect(body).toEqual({ chargeItemIds: ['t1'] });
        return json({ orders: [order()] });
      },
    });
    renderScreen();
    await search('mock');
    fireEvent.click(screen.getByRole('button', { name: 'Mock Test 001' }));
    await wait(5000);
    expect(sent()).toContain('PUT /api/staff/opd/visits/visit-1/investigations');
    expect(screen.getByText(/Mock Test 001 · Ordered/)).toBeTruthy();
    // nothing else changed: no second save
    const before = fetchMock.mock.calls.length;
    await wait(15000);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('"Complete" saves the tests first, then completes (a test added a second ago is not lost)', async () => {
    const calls: string[] = [];
    api({
      'GET /api/staff/opd/investigations/tests': () =>
        json({ items: [{ id: 't1', code: 'INV001', name: 'Mock Test 001' }] }),
      'PUT /api/staff/opd/visits/visit-1/investigations': () => {
        calls.push('tests');
        return json({ orders: [order()] });
      },
      'POST /api/staff/opd/visits/visit-1/complete': () => {
        calls.push('complete');
        return json(
          makeConsult({
            visit: finished(),
            consultation: makeNote({
              status: 'COMPLETED',
              completedAt: '2026-11-19T04:30:00.000Z',
            }),
          }),
        );
      },
    });
    renderScreen({
      initial: makeConsult({ visit: started(), consultation: makeNote({ complaints: 'cough' }) }),
    });
    await search('mock');
    fireEvent.click(screen.getByRole('button', { name: 'Mock Test 001' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: consultCopy.complete }));
    });
    expect(calls).toEqual(['tests', 'complete']);
  });

  it('a failed tests save stops "Complete" and says the save failed', async () => {
    api({
      'GET /api/staff/opd/investigations/tests': () =>
        json({ items: [{ id: 't1', code: 'INV001', name: 'Mock Test 001' }] }),
      'PUT /api/staff/opd/visits/visit-1/investigations': () =>
        json({ code: 'TEST_NOT_FOUND' }, 404),
    });
    renderScreen({
      initial: makeConsult({ visit: started(), consultation: makeNote({ complaints: 'cough' }) }),
    });
    await search('mock');
    fireEvent.click(screen.getByRole('button', { name: 'Mock Test 001' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: consultCopy.complete }));
    });
    expect(sent().some((c) => c.includes('/complete'))).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain(consultCopy.saveStatusError);
  });

  it('a test still only ordered can be removed; billed, declined and unknown statuses cannot', () => {
    renderScreen({
      tests: [
        order({ id: 'a', chargeItemId: 'a', name: 'Alpha' }),
        order({ id: 'b', chargeItemId: 'b', name: 'Bravo', status: 'BILLED' }),
        order({
          id: 'c',
          chargeItemId: 'c',
          name: 'Charlie',
          status: 'NOT_TAKEN',
          notTakenReason: 'done elsewhere',
        }),
        order({ id: 'd', chargeItemId: 'd', name: 'Delta', status: 'RESULT_READY' }),
      ],
    });
    expect(screen.getByText('Alpha · Ordered')).toBeTruthy();
    expect(screen.getByText('Bravo · Billed')).toBeTruthy();
    expect(screen.getByText('Charlie · Not taken: done elsewhere')).toBeTruthy();
    expect(screen.getByText('Delta · In progress')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeTruthy();
    for (const name of ['Bravo', 'Charlie', 'Delta']) {
      expect(screen.queryByRole('button', { name: `Remove ${name}` })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }));
    expect(screen.queryByText('Alpha · Ordered')).toBeNull();
  });

  it('removing the last test saves an empty list', async () => {
    api({
      'PUT /api/staff/opd/visits/visit-1/investigations': (body) => {
        expect(body).toEqual({ chargeItemIds: [] });
        return json({ orders: [] });
      },
    });
    renderScreen({ tests: [order({ chargeItemId: 'a', name: 'Alpha' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha' }));
    await wait(5000);
    expect(sent()).toEqual(['PUT /api/staff/opd/visits/visit-1/investigations']);
  });

  it('after completion the box is read-only: statuses only, no search, no remove', () => {
    renderScreen({
      initial: makeConsult({
        visit: finished(),
        consultation: makeNote({ status: 'COMPLETED', completedAt: '2026-11-19T04:30:00.000Z' }),
      }),
      tests: [order({ chargeItemId: 'a', name: 'Alpha', status: 'BILLED' })],
    });
    expect(screen.getByText('Alpha · Billed')).toBeTruthy();
    expect(screen.queryByLabelText(copy.searchLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('a nurse (no ordering permission) sees tests read-only, only if there are any', () => {
    renderScreen({
      canOrderTests: false,
      tests: [order({ chargeItemId: 'a', name: 'Alpha' })],
    });
    expect(screen.getByText('Alpha · Ordered')).toBeTruthy();
    expect(screen.queryByLabelText(copy.searchLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).toBeNull();
  });

  it('does not save tests when the doctor has no ordering permission', async () => {
    api({
      'PUT /api/staff/opd/visits/visit-1/consultation': () =>
        json(makeConsult({ visit: started(), consultation: makeNote() })),
    });
    renderScreen({ canOrderTests: false });
    fireEvent.change(screen.getByLabelText(/Symptoms/i), { target: { value: 'cough' } });
    await wait(5000);
    expect(sent().some((c) => c.includes('/investigations'))).toBe(false);
    void url;
  });
});
