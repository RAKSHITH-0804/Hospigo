import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AvailabilityPanel } from '@/components/settings/availability-panel';
import { staffCopy } from '@/config/staff-copy';
import type { Availability } from '@/lib/availability/types';

const getMock = jest.fn();
const switchMock = jest.fn();
const timingsMock = jest.fn();
const addLeaveMock = jest.fn();
const removeLeaveMock = jest.fn();
jest.mock('@/lib/availability/client', () => ({
  getAvailability: (...args: unknown[]) => getMock(...args),
  saveSwitch: (...args: unknown[]) => switchMock(...args),
  saveTimings: (...args: unknown[]) => timingsMock(...args),
  addLeave: (...args: unknown[]) => addLeaveMock(...args),
  removeLeave: (...args: unknown[]) => removeLeaveMock(...args),
}));

const copy = staffCopy.availability;

const base = (over: Partial<Availability> = {}): Availability => ({
  doctorProfileId: 'd1',
  code: 'DR001',
  name: 'Dr Rao',
  availabilityOn: true,
  today: '2026-11-23',
  branches: [{ id: 'b1', name: 'Main', editable: true }],
  timings: [],
  leaves: [],
  canWrite: true,
  ...over,
});

const ok = (data: Availability) => ({ ok: true, data });

beforeEach(() => {
  for (const m of [getMock, switchMock, timingsMock, addLeaveMock, removeLeaveMock]) {
    m.mockReset();
  }
});

async function shown(data: Availability = base()) {
  getMock.mockResolvedValue(ok(data));
  render(<AvailabilityPanel doctorId="d1" />);
  await screen.findByText(copy.switchTitle);
}

describe('AvailabilityPanel', () => {
  it('shows a loading line, then the switch, the empty timetable and the empty leave list', async () => {
    getMock.mockResolvedValue(ok(base()));
    render(<AvailabilityPanel doctorId="d1" />);
    expect(screen.getByText(copy.loading)).toBeTruthy();
    expect(await screen.findByText(copy.switchOn)).toBeTruthy();
    expect(screen.getByText(copy.noSlots)).toBeTruthy();
    expect(screen.getByText(copy.noLeave)).toBeTruthy();
    expect(getMock).toHaveBeenCalledWith('d1');
  });

  it('says so when it cannot load and tries again on request', async () => {
    getMock.mockResolvedValueOnce({ ok: false, status: 0, code: 'UNAVAILABLE' });
    render(<AvailabilityPanel doctorId="d1" />);
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    getMock.mockResolvedValueOnce(ok(base()));
    fireEvent.click(screen.getByRole('button', { name: copy.retry }));
    expect(await screen.findByText(copy.switchOn)).toBeTruthy();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('switches the doctor off and on with the answer of the API; a double click sends once', async () => {
    await shown();
    switchMock.mockResolvedValue(ok(base({ availabilityOn: false })));
    const button = screen.getByRole('button', { name: copy.turnOff });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText(copy.switchOff)).toBeTruthy();
    expect(switchMock).toHaveBeenCalledTimes(1);
    expect(switchMock).toHaveBeenCalledWith('d1', false);
    expect(screen.getByRole('button', { name: copy.turnOn })).toBeTruthy();
  });

  it('shows the saved weekly times and saves a changed list for that branch', async () => {
    await shown(
      base({ timings: [{ id: 't1', branchId: 'b1', weekday: 1, start: '09:00', end: '13:00' }] }),
    );
    expect((screen.getByLabelText(copy.from) as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText(copy.day) as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: copy.addSlot }));
    const days = screen.getAllByLabelText(copy.day);
    const froms = screen.getAllByLabelText(copy.from);
    const tos = screen.getAllByLabelText(copy.to);
    fireEvent.change(days[1]!, { target: { value: '3' } });
    fireEvent.change(froms[1]!, { target: { value: '14:00' } });
    fireEvent.change(tos[1]!, { target: { value: '16:30' } });
    timingsMock.mockResolvedValue(
      ok(
        base({
          timings: [
            { id: 't1', branchId: 'b1', weekday: 1, start: '09:00', end: '13:00' },
            { id: 't2', branchId: 'b1', weekday: 3, start: '14:00', end: '16:30' },
          ],
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: copy.saveTimetable }));
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    expect(timingsMock).toHaveBeenCalledWith('d1', 'b1', [
      { weekday: 1, start: '09:00', end: '13:00' },
      { weekday: 3, start: '14:00', end: '16:30' },
    ]);
  });

  it('refuses an end before the start, a missing time and an overlap before anything is sent', async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: copy.addSlot }));
    const save = () => fireEvent.click(screen.getByRole('button', { name: copy.saveTimetable }));
    save();
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.localTime);
    fireEvent.change(screen.getByLabelText(copy.from), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText(copy.to), { target: { value: '09:00' } });
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.localEndBeforeStart),
    );
    fireEvent.change(screen.getByLabelText(copy.to), { target: { value: '13:00' } });
    fireEvent.click(screen.getByRole('button', { name: copy.addSlot }));
    const froms = screen.getAllByLabelText(copy.from);
    const tos = screen.getAllByLabelText(copy.to);
    fireEvent.change(froms[1]!, { target: { value: '12:30' } });
    fireEvent.change(tos[1]!, { target: { value: '15:00' } });
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.localOverlap),
    );
    expect(timingsMock).not.toHaveBeenCalled();
  });

  it('explains a refusal of the API and keeps what was typed', async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: copy.addSlot }));
    fireEvent.change(screen.getByLabelText(copy.from), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(copy.to), { target: { value: '10:00' } });
    timingsMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'AVAILABILITY_INVALID',
      reason: 'OVERLAP',
    });
    fireEvent.click(screen.getByRole('button', { name: copy.saveTimetable }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.reasons.OVERLAP);
    expect((screen.getByLabelText(copy.from) as HTMLInputElement).value).toBe('09:00');
  });

  it('adds a leave period with the calendar quick picks and lists it from the answer', async () => {
    await shown();
    addLeaveMock.mockResolvedValue(
      ok(base({ leaves: [{ id: 'l1', fromDate: '2026-11-23', toDate: '2026-11-24' }] })),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.leaveFrom) }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.today }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.leaveTo) }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: copy.tomorrow }),
    );
    fireEvent.click(screen.getByRole('button', { name: copy.addLeave }));
    expect(await screen.findByText(copy.leaveSaved)).toBeTruthy();
    expect(addLeaveMock).toHaveBeenCalledWith('d1', '2026-11-23', '2026-11-24');
    expect(screen.queryByText(copy.noLeave)).toBeNull();
  });

  it('asks for both days before sending a leave', async () => {
    await shown();
    fireEvent.click(screen.getByRole('button', { name: copy.addLeave }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.pickDates);
    expect(addLeaveMock).not.toHaveBeenCalled();
  });

  it('removes a leave period, marks an ended one and shows a refusal calmly', async () => {
    await shown(
      base({
        leaves: [
          { id: 'l1', fromDate: '2026-11-01', toDate: '2026-11-02' },
          { id: 'l2', fromDate: '2026-12-01', toDate: '2026-12-01' },
        ],
      }),
    );
    expect(screen.getAllByText(new RegExp(copy.ended))).toHaveLength(1);
    removeLeaveMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      code: 'AVAILABILITY_LEAVE_NOT_FOUND',
    });
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(copy.removeLeave) })[1]!);
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.notFound);
    removeLeaveMock.mockResolvedValueOnce(
      ok(base({ leaves: [{ id: 'l1', fromDate: '2026-11-01', toDate: '2026-11-02' }] })),
    );
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(copy.removeLeave) })[1]!);
    expect(await screen.findByText(copy.leaveRemoved)).toBeTruthy();
    expect(removeLeaveMock).toHaveBeenLastCalledWith('d1', 'l2');
  });

  it('a reader sees everything and has no buttons to change it', async () => {
    await shown(
      base({
        canWrite: false,
        timings: [{ id: 't1', branchId: 'b1', weekday: 1, start: '09:00', end: '13:00' }],
        leaves: [{ id: 'l1', fromDate: '2026-12-01', toDate: '2026-12-03' }],
      }),
    );
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect((screen.getByLabelText(copy.from) as HTMLInputElement).disabled).toBe(true);
  });

  it('a branch the Admin does not manage is shown read-only', async () => {
    await shown(
      base({
        branches: [
          { id: 'b1', name: 'Main', editable: true },
          { id: 'b2', name: 'North', editable: false },
        ],
        timings: [{ id: 't1', branchId: 'b2', weekday: 2, start: '08:00', end: '09:00' }],
      }),
    );
    expect(screen.getByText(copy.branchReadOnly)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: copy.saveTimetable })).toHaveLength(1);
  });

  it('says so when the doctor has no branch the Admin can manage', async () => {
    await shown(base({ branches: [] }));
    expect(screen.getByText(copy.noBranches)).toBeTruthy();
  });
});
