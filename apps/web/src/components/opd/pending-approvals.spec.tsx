import { act, render, screen } from '@testing-library/react';
import {
  ApprovalsBell,
  PendingApprovalsProvider,
  PendingBadge,
} from '@/components/opd/pending-approvals';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.opd.approvals;

function respond(counts: number[]) {
  let i = 0;
  const fetchMock = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ count: counts[Math.min(i++, counts.length - 1)] }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('pending approvals', () => {
  const originalFetch = global.fetch;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('shows the number next to a label, and nothing at zero', async () => {
    respond([3, 0]);
    render(
      <PendingApprovalsProvider enabled>
        <span>OPD queue</span>
        <PendingBadge />
      </PendingApprovalsProvider>,
    );
    await act(async () => {});
    expect(screen.getByLabelText('3 waiting for approval').textContent).toBe('3');
    await act(async () => {
      jest.advanceTimersByTime(opdWebConfig.approvalsPollSeconds * 1000);
    });
    expect(screen.queryByLabelText(/waiting for approval/)).toBeNull();
  });

  it('asks again every few seconds and tells the person when a NEW request arrives', async () => {
    const fetchMock = respond([1, 1, 2]);
    render(
      <PendingApprovalsProvider enabled>
        <PendingBadge />
      </PendingApprovalsProvider>,
    );
    await act(async () => {});
    expect(screen.queryByText(copy.toast)).toBeNull(); // the first number is not "new"
    await act(async () => {
      jest.advanceTimersByTime(opdWebConfig.approvalsPollSeconds * 1000);
    });
    expect(screen.queryByText(copy.toast)).toBeNull(); // unchanged
    await act(async () => {
      jest.advanceTimersByTime(opdWebConfig.approvalsPollSeconds * 1000);
    });
    expect(screen.getByRole('status').textContent).toBe(copy.toast);
    expect(screen.getByLabelText('2 waiting for approval')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      '/api/staff/opd/refund-requests/pending-count',
    );
  });

  it('a person who cannot approve never asks and sees no bell or badge', async () => {
    const fetchMock = respond([5]);
    render(
      <PendingApprovalsProvider enabled={false}>
        <ApprovalsBell enabled={false} />
        <PendingBadge />
      </PendingApprovalsProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(opdWebConfig.approvalsPollSeconds * 3000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByLabelText(/waiting for approval/)).toBeNull();
  });

  it('the bell links to the requests with the number', async () => {
    respond([4]);
    render(
      <PendingApprovalsProvider enabled>
        <ApprovalsBell enabled />
      </PendingApprovalsProvider>,
    );
    await act(async () => {});
    const link = screen.getByRole('link', { name: '4 waiting for approval' });
    expect(link.getAttribute('href')).toBe('/app/opd/refunds');
  });

  it('a failed poll keeps the last number', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 2 }) })
      .mockRejectedValue(new Error('offline'));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(
      <PendingApprovalsProvider enabled>
        <PendingBadge />
      </PendingApprovalsProvider>,
    );
    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(opdWebConfig.approvalsPollSeconds * 1000);
    });
    expect(screen.getByLabelText('2 waiting for approval')).toBeTruthy();
  });
});
