import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OpdQueue } from '@/components/opd/opd-queue';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { OPD_QUEUE_API } from '@/lib/opd/clinical-client';
import { makeQueueItem } from '@/lib/opd/clinical-test-fixtures';
import type { QueueResponse } from '@/lib/opd/clinical-types';

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
const fetchMock = jest.fn();

const first = makeQueueItem({ id: 'v1', token: { date: 'd', no: 1, label: 'T1' } });
const second = makeQueueItem({
  id: 'v2',
  token: { date: 'd', no: 2, label: 'T2' },
  status: 'IN_CONSULTATION',
  vitalsRecorded: true,
  patient: { id: 'p2', uhid: 'NHEL0002', name: 'Sita Devi', gender: 'F', ageYears: null },
  doctor: { id: 'd2', code: 'DR002', name: 'Dr Rao' },
});

const queue = (over: Partial<QueueResponse> = {}): QueueResponse => ({
  date: '2026-11-19',
  scope: 'OWN',
  total: 2,
  doctors: [],
  items: [first, second],
  ...over,
});

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('OpdQueue', () => {
  it('lists the patients with token, name, age, status and vitals state', () => {
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.getByText('T1')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText(/NHEL0001 · Male · 41 years/)).toBeTruthy();
    expect(screen.getByText(/NHEL0002 · Female · —/)).toBeTruthy();
    expect(screen.getByText(copy.statusWaiting)).toBeTruthy();
    expect(screen.getByText(copy.statusInConsultation)).toBeTruthy();
    expect(screen.getByText(copy.vitalsDone)).toBeTruthy();
    expect(screen.getByText(copy.vitalsPending)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 waiting, 1 in consultation');
  });

  it('flags a patient who has been waiting since an earlier day (the list never forgets them)', () => {
    const older = makeQueueItem({
      id: 'v0',
      visitDate: '2026-11-18',
      token: { date: '2026-11-18', no: 9, label: 'T9' },
    });
    render(
      <OpdQueue
        initial={queue({ items: [older, first], total: 2 })}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.getAllByText('From 18 Nov 2026')).toHaveLength(1);
    // a patient of today carries no tag
    expect(screen.queryByText(/From 19 Nov 2026/)).toBeNull();
    expect(screen.getAllByText(/^From /)).toHaveLength(1);
    expect(screen.getByText('T9')).toBeTruthy();
  });

  it('a doctor sees only their own queue (no doctor column) and Open + Vitals links', () => {
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.queryByText(copy.colDoctor)).toBeNull();
    const open = screen.getAllByRole('link', { name: copy.open });
    expect(open.map((a) => a.getAttribute('href'))).toEqual([
      '/app/opd/visits/v1/consult',
      '/app/opd/visits/v2/consult',
    ]);
    expect(
      screen.getAllByRole('link', { name: copy.vitals }).map((a) => a.getAttribute('href')),
    ).toEqual(['/app/opd/visits/v1/vitals', '/app/opd/visits/v2/vitals']);
  });

  it('a nurse sees the whole branch with the doctor column and only the Vitals link', () => {
    render(
      <OpdQueue
        initial={queue({ scope: 'BRANCH' })}
        refreshSeconds={0}
        canOpenConsultation={false}
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.getByText(copy.colDoctor)).toBeTruthy();
    expect(screen.getByText('Dr Rao')).toBeTruthy();
    expect(screen.queryByRole('link', { name: copy.open })).toBeNull();
    expect(screen.getAllByRole('link', { name: copy.vitals })).toHaveLength(2);
  });

  const done = makeQueueItem({
    id: 'v9',
    status: 'COMPLETED',
    completedAt: '2026-11-19T05:30:00.000Z',
    vitalsRecorded: true,
    token: { date: 'd', no: 9, label: 'T9' },
    patient: { id: 'p9', uhid: 'NHEL0009', name: 'Anil Seen', gender: 'M', ageYears: 50 },
  });

  it('keeps who was completed today in the list: tabs Waiting, Completed today and All with counts', () => {
    render(
      <OpdQueue
        initial={queue({ items: [first, second, done], total: 3 })}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      '1 waiting, 1 in consultation, 1 completed today',
    );
    // doctors and nurses act, so they start on Waiting: the completed patient is not in that tab
    expect(
      screen.getByRole('button', { name: `${copy.tabWaiting} (2)` }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByText('Anil Seen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${copy.tabCompleted} (1)` }));
    expect(screen.getByText('Anil Seen')).toBeTruthy();
    expect(screen.queryByText('Ravi Kumar')).toBeNull();
    expect(screen.getByText(copy.statusCompleted)).toBeTruthy();
    expect(screen.getByText(/^at /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `${copy.tabAll} (3)` }));
    expect(screen.getByText('Anil Seen')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
  });

  it('a completed patient gets View (note) and Vitals, not Open; no earlier-day tag for completed ones', () => {
    render(
      <OpdQueue
        initial={queue({ items: [{ ...done, visitDate: '2026-11-18' }], total: 1 })}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `${copy.tabCompleted} (1)` }));
    expect(screen.queryByRole('link', { name: copy.open })).toBeNull();
    expect(screen.getByRole('link', { name: copy.view }).getAttribute('href')).toBe(
      '/app/opd/visits/v9/consult',
    );
    expect(screen.getByRole('link', { name: copy.vitals }).getAttribute('href')).toBe(
      '/app/opd/visits/v9/vitals',
    );
    expect(screen.queryByText(/^From /)).toBeNull();
  });

  it('reception (read only) starts on All and sees every patient with the doctor and vitals state but no buttons', () => {
    render(
      <OpdQueue
        initial={queue({ scope: 'BRANCH', items: [first, second, done], total: 3 })}
        refreshSeconds={0}
        canOpenConsultation={false}
        canViewNotes={false}
        canRecordVitals={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: `${copy.tabAll} (3)` }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('Anil Seen')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText(copy.colDoctor)).toBeTruthy();
    expect(screen.getAllByText(copy.vitalsDone)).toHaveLength(2);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a completed visit without vitals says "Not recorded" (not "Pending"); waiting ones stay "Pending"', () => {
    const missed = {
      ...done,
      id: 'v8',
      vitalsRecorded: false,
      token: { date: 'd', no: 8, label: 'T8' },
    };
    render(
      <OpdQueue
        initial={queue({ items: [first, missed], total: 2 })}
        refreshSeconds={0}
        canOpenConsultation={false}
        canViewNotes={false}
        canRecordVitals={false}
      />,
    );
    expect(screen.getAllByText(copy.vitalsPending)).toHaveLength(1);
    expect(screen.getAllByText(copy.vitalsNotRecorded)).toHaveLength(1);
  });

  it('an empty Completed tab says nobody has been seen yet today', () => {
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `${copy.tabCompleted} (0)` }));
    expect(screen.getByText(copy.emptyCompletedTitle)).toBeTruthy();
  });

  it('shows an empty state when nobody is waiting', () => {
    render(
      <OpdQueue
        initial={queue({ items: [], total: 0 })}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a nurse or reception can pick one doctor: the queue is asked again for that doctor and the choice stays through refreshes', async () => {
    const doctors = [
      { id: 'd1', name: 'Dr Anil' },
      { id: 'd2', name: 'Dr Rao' },
    ];
    fetchMock.mockResolvedValue(json(queue({ scope: 'BRANCH', doctors, items: [second] })));
    render(
      <OpdQueue
        initial={queue({ scope: 'BRANCH', doctors })}
        refreshSeconds={0}
        canOpenConsultation={false}
        canViewNotes={false}
        canRecordVitals
      />,
    );
    const select = screen.getByLabelText(copy.doctorFilter) as HTMLSelectElement;
    expect(within(select).getByText(copy.allDoctors)).toBeTruthy();
    await act(async () => {
      fireEvent.change(select, { target: { value: 'd2' } });
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${OPD_QUEUE_API}?doctorProfileId=d2`);
    expect(screen.queryByText('Ravi Kumar')).toBeNull();
    expect(screen.getByText('Sita Devi')).toBeTruthy();
    // the choices stay (they come from the whole branch queue), and Refresh keeps the doctor
    expect(within(select).getByText('Dr Anil')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${OPD_QUEUE_API}?doctorProfileId=d2`);
    // back to everyone
    await act(async () => {
      fireEvent.change(select, { target: { value: '' } });
    });
    expect(fetchMock.mock.calls[2]![0]).toBe(OPD_QUEUE_API);
  });

  it('a doctor sees no doctor filter, and neither does a branch with nobody in the queue', () => {
    const own = render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    expect(screen.queryByLabelText(copy.doctorFilter)).toBeNull();
    own.unmount();
    render(
      <OpdQueue
        initial={queue({ scope: 'BRANCH', doctors: [], items: [] })}
        refreshSeconds={0}
        canOpenConsultation={false}
        canViewNotes={false}
        canRecordVitals
      />,
    );
    expect(screen.queryByLabelText(copy.doctorFilter)).toBeNull();
  });

  it('Refresh loads the queue again and shows the new patient', async () => {
    fetchMock.mockResolvedValue(
      json(
        queue({
          items: [
            first,
            makeQueueItem({ id: 'v3', patient: { ...first.patient, name: 'New Person' } }),
          ],
        }),
      ),
    );
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(OPD_QUEUE_API);
    expect(screen.getByText('New Person')).toBeTruthy();
    expect(screen.queryByText('Sita Devi')).toBeNull();
  });

  it('refreshes by itself every N seconds, not before, and never when set to 0', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(json(queue()));
    const { unmount } = render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={20}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(19_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    fetchMock.mockClear();
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(600_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not refresh while the tab is hidden', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(json(queue()));
    const spy = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={5}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a failed refresh keeps the list on screen and says so; the next good one clears it', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'UNAVAILABLE' }, 503));
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    });
    expect(screen.getByRole('alert').textContent).toBe(copy.refreshFailed);
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    fetchMock.mockResolvedValueOnce(json(queue()));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('one refresh at a time: the button is disabled while it runs', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={0}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    });
    const busy = screen.getByRole('button', { name: copy.refreshing }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(json(queue()));
    });
    expect((screen.getByRole('button', { name: copy.refresh }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('the automatic refresh does not start a new request while the last one is still running', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    render(
      <OpdQueue
        initial={queue()}
        refreshSeconds={20}
        canOpenConsultation
        canViewNotes
        canRecordVitals
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
