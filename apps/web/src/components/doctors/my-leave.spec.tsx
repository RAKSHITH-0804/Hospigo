import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MyLeave } from '@/components/doctors/my-leave';
import { staffCopy } from '@/config/staff-copy';
import type { MyLeaveRequest } from '@/lib/leave/types';

const listMock = jest.fn();
const askMock = jest.fn();
const cancelMock = jest.fn();
jest.mock('@/lib/leave/client', () => ({
  listMyLeaveRequests: (...a: unknown[]) => listMock(...a),
  askForLeave: (...a: unknown[]) => askMock(...a),
  cancelMyLeaveRequest: (...a: unknown[]) => cancelMock(...a),
}));

const copy = staffCopy.leave;

const request = (over: Partial<MyLeaveRequest> = {}): MyLeaveRequest => ({
  id: 'r1',
  fromDate: '2027-01-10',
  toDate: '2027-01-12',
  status: 'PENDING',
  requestedAt: '2026-11-23T05:00:00.000Z',
  decidedAt: null,
  ...over,
});

beforeEach(() => {
  listMock.mockReset();
  askMock.mockReset();
  cancelMock.mockReset();
});

describe('MyLeave', () => {
  it('shows every request with its state and a Cancel button only for waiting ones', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: {
        today: '2026-11-23',
        items: [
          request(),
          request({ id: 'r2', status: 'APPROVED', decidedAt: '2026-11-24T05:00:00.000Z' }),
          request({ id: 'r3', status: 'REJECTED', decidedAt: '2026-11-24T05:00:00.000Z' }),
        ],
      },
    });
    render(<MyLeave />);
    expect(await screen.findByText(copy.status.PENDING!)).toBeTruthy();
    expect(screen.getByText(copy.status.APPROVED!)).toBeTruthy();
    expect(screen.getByText(copy.status.REJECTED!)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: new RegExp(copy.cancel) })).toHaveLength(1);
  });

  it('says so when there are no requests yet', async () => {
    listMock.mockResolvedValue({ ok: true, data: { today: '2026-11-23', items: [] } });
    render(<MyLeave />);
    expect(await screen.findByText(copy.none)).toBeTruthy();
  });

  it('shows a calm error and Try again reloads', async () => {
    listMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'UNKNOWN' });
    render(<MyLeave />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    listMock.mockResolvedValueOnce({ ok: true, data: { today: '2026-11-23', items: [] } });
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText(copy.none)).toBeTruthy();
  });

  it('asks without dates: nothing is sent', async () => {
    listMock.mockResolvedValue({ ok: true, data: { today: '2026-11-23', items: [] } });
    render(<MyLeave />);
    await screen.findByText(copy.none);
    fireEvent.click(screen.getByRole('button', { name: copy.ask }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.pickDates);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('cancels a waiting request and shows it cancelled', async () => {
    listMock.mockResolvedValue({ ok: true, data: { today: '2026-11-23', items: [request()] } });
    cancelMock.mockResolvedValue({
      ok: true,
      data: request({ status: 'CANCELLED', decidedAt: '2026-11-23T06:00:00.000Z' }),
    });
    render(<MyLeave />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(copy.cancel) }));
    await waitFor(() => expect(screen.getByText(copy.status.CANCELLED!)).toBeTruthy());
    expect(cancelMock).toHaveBeenCalledWith('r1');
    expect(screen.queryByRole('button', { name: new RegExp(copy.cancel) })).toBeNull();
  });

  it('when the cancel is refused (already decided) it shows the sentence and reloads the real state', async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: { today: '2026-11-23', items: [request()] } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          today: '2026-11-23',
          items: [request({ status: 'APPROVED', decidedAt: '2026-11-23T06:00:00.000Z' })],
        },
      });
    cancelMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'LEAVE_REQUEST_CONFLICT',
      reason: 'ALREADY_DECIDED',
    });
    render(<MyLeave />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(copy.cancel) }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      copy.errors.conflicts.ALREADY_DECIDED,
    );
    await waitFor(() => expect(screen.getByText(copy.status.APPROVED!)).toBeTruthy());
  });
});
