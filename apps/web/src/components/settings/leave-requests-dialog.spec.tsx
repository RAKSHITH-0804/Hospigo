import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LeaveRequestsDialog } from '@/components/settings/leave-requests-dialog';
import { staffCopy } from '@/config/staff-copy';
import type { AdminLeaveRequest } from '@/lib/leave/types';

const listMock = jest.fn();
const decideMock = jest.fn();
jest.mock('@/lib/leave/client', () => ({
  listLeaveRequests: (...a: unknown[]) => listMock(...a),
  decideLeaveRequest: (...a: unknown[]) => decideMock(...a),
}));

const copy = staffCopy.leave;

const row = (over: Partial<AdminLeaveRequest> = {}): AdminLeaveRequest => ({
  id: 'r1',
  fromDate: '2027-01-10',
  toDate: '2027-01-12',
  status: 'PENDING',
  requestedAt: '2026-11-23T05:00:00.000Z',
  decidedAt: null,
  doctor: { id: 'd1', code: 'DOC1', name: 'Dr Meena' },
  decidedByName: null,
  ...over,
});
const page = (items: AdminLeaveRequest[], over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
    pendingCount: items.filter((i) => i.status === 'PENDING').length,
    today: '2026-11-23',
    ...over,
  },
});

const renderDialog = () => {
  const onPending = jest.fn();
  render(<LeaveRequestsDialog onClose={() => undefined} onPendingChange={onPending} />);
  return onPending;
};

beforeEach(() => {
  listMock.mockReset();
  decideMock.mockReset();
});

describe('LeaveRequestsDialog', () => {
  it('opens on the waiting requests, with Approve and Reject, and tells the page the count', async () => {
    listMock.mockResolvedValue(page([row()]));
    const onPending = renderDialog();
    expect(await screen.findByText('Dr Meena')).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith({ status: 'PENDING', page: 1, pageSize: 10 });
    expect(screen.getByRole('button', { name: new RegExp(`^${copy.approve}`) })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(`^${copy.reject}`) })).toBeTruthy();
    expect(onPending).toHaveBeenCalledWith(1);
  });

  it('says nothing is waiting when the list is empty', async () => {
    listMock.mockResolvedValue(page([]));
    renderDialog();
    expect(await screen.findByText(copy.emptyPending)).toBeTruthy();
  });

  it('approve sends the decision, shows the message and reloads the list', async () => {
    listMock.mockResolvedValueOnce(page([row()])).mockResolvedValueOnce(page([]));
    decideMock.mockResolvedValue({ ok: true, data: row({ status: 'APPROVED' }) });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${copy.approve}`) }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith('r1', 'approve'));
    expect(await screen.findByText(copy.approved)).toBeTruthy();
    expect(await screen.findByText(copy.emptyPending)).toBeTruthy();
  });

  it('reject sends reject', async () => {
    listMock.mockResolvedValueOnce(page([row()])).mockResolvedValueOnce(page([]));
    decideMock.mockResolvedValue({ ok: true, data: row({ status: 'REJECTED' }) });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${copy.reject}`) }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith('r1', 'reject'));
    expect(await screen.findByText(copy.rejected)).toBeTruthy();
  });

  it('a refused decision shows the calm sentence and reloads the real list (already decided)', async () => {
    listMock.mockResolvedValueOnce(page([row()])).mockResolvedValueOnce(page([]));
    decideMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'LEAVE_REQUEST_CONFLICT',
      reason: 'ALREADY_DECIDED',
    });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${copy.approve}`) }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      copy.errors.conflicts.ALREADY_DECIDED,
    );
    expect(await screen.findByText(copy.emptyPending)).toBeTruthy();
  });

  it('own request: the Admin is told they cannot decide it', async () => {
    listMock.mockResolvedValue(page([row()]));
    decideMock.mockResolvedValue({ ok: false, status: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${copy.approve}`) }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.self);
  });

  it('decided requests show their state and no buttons; the filter asks the API for that state', async () => {
    listMock.mockResolvedValueOnce(page([row()]));
    renderDialog();
    await screen.findByText('Dr Meena');
    listMock.mockResolvedValueOnce(
      page([
        row({
          status: 'APPROVED',
          decidedByName: 'Admin Ravi',
          decidedAt: '2026-11-24T05:00:00.000Z',
        }),
      ]),
    );
    fireEvent.change(screen.getByLabelText(copy.filterLabel), { target: { value: 'APPROVED' } });
    expect(await screen.findByText(copy.status.APPROVED!)).toBeTruthy();
    expect(screen.getByText(copy.decidedBy.replace('{name}', 'Admin Ravi'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(`^${copy.approve}`) })).toBeNull();
    expect(listMock).toHaveBeenLastCalledWith({ status: 'APPROVED', page: 1, pageSize: 10 });
  });

  it('a load error shows a calm message and Try again', async () => {
    listMock.mockResolvedValueOnce({ ok: false, status: 500, code: 'UNKNOWN' });
    renderDialog();
    expect(await screen.findByRole('alert')).toBeTruthy();
    listMock.mockResolvedValueOnce(page([]));
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText(copy.emptyPending)).toBeTruthy();
  });
});
