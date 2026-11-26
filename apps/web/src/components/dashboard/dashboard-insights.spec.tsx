import { render, screen, waitFor } from '@testing-library/react';
import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { staffCopy } from '@/config/staff-copy';
import type { DashboardSummary } from '@/lib/dashboard/types';

const copy = staffCopy.dashboard.insights;

const base = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  branchId: 'b1',
  sections: { money: true, queue: true, vitals: false, doctor: false, approvals: false },
  today: { registrations: 3, visits: 9, waiting: 4, completed: 5, collectionPaise: 250000 },
  trend: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(i + 10).padStart(2, '0')}`,
    visits: i,
    collectionPaise: i * 1000,
  })),
  paymentMix: [{ mode: 'Cash', amountPaise: 1000 }],
  topDoctors: [{ doctor: 'Dr. Rao', visits: 7 }],
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
        today: { registrations: 1, visits: 2, waiting: 1, completed: 1, collectionPaise: null },
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
