import { render, screen, waitFor } from '@testing-library/react';
import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { staffCopy } from '@/config/staff-copy';
import type { DashboardSummary } from '@/lib/dashboard/types';

const copy = staffCopy.dashboard.insights;

const base = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  branchId: 'b1',
  sections: { money: true, queue: true, vitals: false, doctor: false, approvals: false },
  today: {
    registrations: 3,
    visits: 9,
    waiting: 4,
    completed: 5,
    longWaiting: 2,
    collectionPaise: 250000,
  },
  trend: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(i + 10).padStart(2, '0')}`,
    visits: i,
    collectionPaise: i * 1000,
  })),
  paymentMix: [{ mode: 'Cash', code: 'CASH', amountPaise: 1000 }],
  topDoctors: [{ doctor: 'Dr. Rao', doctorId: 'd1', visits: 7 }],
  vitals: null,
  doctor: null,
  pendingApprovals: null,
  ...over,
});

describe('DashboardInsights', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const reply = (body: unknown, ok = true) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      json: async () => body,
    }) as unknown as typeof fetch;
  };

  it('shows the real numbers, the money block and the charts', async () => {
    reply(base());
    render(<DashboardInsights />);
    await waitFor(() => expect(screen.getByText(copy.visitsToday)).toBeTruthy());
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText(copy.collectionTrend)).toBeTruthy();
    expect(screen.getByText(/Dr\. Rao/)).toBeTruthy();
    expect(screen.queryByText(copy.approvals)).toBeNull();
  });

  it('leaves out the blocks the person may not see', async () => {
    reply(
      base({
        sections: { money: false, queue: true, vitals: false, doctor: true, approvals: false },
        today: {
          registrations: 1,
          visits: 2,
          waiting: 1,
          completed: 1,
          longWaiting: null,
          collectionPaise: null,
        },
        doctor: { myWaiting: 1, mySeenToday: 1 },
      }),
    );
    render(<DashboardInsights />);
    await waitFor(() => expect(screen.getByText(copy.myWaiting)).toBeTruthy());
    expect(screen.queryByText(copy.collection)).toBeNull();
    expect(screen.queryByText(copy.collectionTrend)).toBeNull();
  });

  it('says so when there are no visits, and shows one plain message when the call fails', async () => {
    reply(base({ trend: base().trend.map((t) => ({ ...t, visits: 0 })) }));
    const { unmount } = render(<DashboardInsights />);
    await waitFor(() => expect(screen.getByText(copy.empty)).toBeTruthy());
    unmount();
    reply({}, false);
    render(<DashboardInsights />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.failed));
  });
});

describe('Attention required', () => {
  it('lists only real things that wait, with the long waits', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        base({
          sections: { money: true, queue: true, vitals: true, doctor: false, approvals: true },
          vitals: { waiting: 3, recordedToday: 1 },
          pendingApprovals: 2,
        }),
    }) as unknown as typeof fetch;
    render(<DashboardInsights />);
    await waitFor(() => expect(screen.getByText(staffCopy.dashboard.attention.title)).toBeTruthy());
    expect(screen.getByText(/2 refund or cancel requests/)).toBeTruthy();
    expect(screen.getByText(/3 patients waiting for vitals/)).toBeTruthy();
    expect(screen.getByText(/2 patients waiting more than 30 minutes/)).toBeTruthy();
  });
});

describe('Clickable blocks and charts', () => {
  it('a block and a chart lead to the screens the person may open, and nowhere else', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => base(),
    }) as unknown as typeof fetch;
    const { unmount } = render(
      <DashboardInsights permissions={['opd.queue.read', 'opd.reports.read']} />,
    );
    await waitFor(() => expect(screen.getByText(copy.visitsToday)).toBeTruthy());
    expect(screen.getByText(copy.visitsToday).closest('a')?.getAttribute('href')).toBe('/app/opd');
    expect(screen.getByText(copy.collection).closest('a')?.getAttribute('href')).toBe(
      '/app/opd/reports',
    );
    expect(document.querySelector('a[href="/app/opd/reports?date=2026-11-10"]')).not.toBeNull();
    expect(document.querySelector('a[href="/app/opd/reports?paymentMode=CASH"]')).not.toBeNull();
    expect(document.querySelector('a[href="/app/opd/reports?doctor=d1"]')).not.toBeNull();
    unmount();
    render(<DashboardInsights permissions={[]} />);
    await waitFor(() => expect(screen.getByText(copy.visitsToday)).toBeTruthy());
    expect(screen.getByText(copy.visitsToday).closest('a')).toBeNull();
    expect(document.querySelector('a[href^="/app/opd/reports"]')).toBeNull();
  });
});
