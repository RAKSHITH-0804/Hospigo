import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DoctorsList } from '@/components/settings/doctors-list';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import type { DoctorProfile, DoctorsListResponse } from '@/lib/doctors/types';

const saveMock = jest.fn();
jest.mock('@/lib/doctors/client', () => ({
  saveDoctorProfile: (...args: unknown[]) => saveMock(...args),
}));

const leaveListMock = jest.fn();
jest.mock('@/lib/leave/client', () => ({
  listLeaveRequests: (...args: unknown[]) => leaveListMock(...args),
  decideLeaveRequest: jest.fn(),
}));

const availabilityMock = jest.fn();
jest.mock('@/lib/availability/client', () => ({
  getAvailability: (...args: unknown[]) => availabilityMock(...args),
}));

const copy = staffCopy.settings.doctors;
const errors = staffCopy.settings.settingsErrors;
const limits = {
  printedName: 80,
  qualifications: 150,
  speciality: 80,
  registrationNo: 40,
  department: 100,
};

const doctor = (over: Partial<DoctorProfile> = {}): DoctorProfile => ({
  id: 'd1',
  code: 'DR001',
  name: 'Login Meena',
  printedName: null,
  printName: 'Login Meena',
  department: 'General',
  qualifications: null,
  speciality: null,
  registrationNo: null,
  active: true,
  branches: ['Main Branch'],
  missing: ['qualifications', 'speciality', 'registrationNo'],
  signature: null,
  ...over,
});
const full = (over: Partial<DoctorProfile> = {}): DoctorProfile =>
  doctor({
    id: 'd2',
    code: 'DR002',
    name: 'Login Anil',
    printedName: 'Dr. A. Rao',
    printName: 'Dr. A. Rao',
    qualifications: 'MBBS, MD',
    speciality: 'Cardiology',
    registrationNo: 'KMC/1',
    department: 'Cardiology',
    missing: [],
    ...over,
  });
const data = (over: Partial<DoctorsListResponse> = {}): DoctorsListResponse => ({
  items: [doctor(), full()],
  limits,
  images: {
    maxBytes: 1048576,
    maxSidePx: 4000,
    minSidePx: 16,
    types: ['image/png', 'image/jpeg', 'image/webp'],
  },
  canWrite: true,
  ...over,
});

const renderList = (initial: DoctorsListResponse | null = data()) =>
  render(<DoctorsList initial={initial} initialErrorCode={null} />);
const edit = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `${name}: ${copy.edit}` }));
const panel = () => screen.getByRole('button', { name: copy.save }).closest('form') as HTMLElement;
const field = (label: string) => within(panel()).getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  saveMock.mockReset();
  availabilityMock.mockReset();
});

describe('DoctorsList', () => {
  it('lists every doctor with what prints, the department and the branches; empty details say Not set', () => {
    renderList();
    // a doctor without a printed name prints the login name, so that name shows twice
    expect(screen.getAllByText('Login Meena')).toHaveLength(2);
    expect(screen.getByText('Login Anil')).toBeTruthy();
    expect(screen.getByText('Dr. A. Rao')).toBeTruthy();
    expect(screen.getByText('MBBS, MD')).toBeTruthy();
    expect(screen.getAllByText(copy.notSet).length).toBeGreaterThanOrEqual(3);
  });

  it('marks only the doctor whose details are missing', () => {
    renderList();
    const missing = screen.getAllByText('Login Meena')[0]!.closest('li') as HTMLElement;
    const filled = screen.getByText('Login Anil').closest('li') as HTMLElement;
    expect(missing.textContent).toContain(copy.missingTag);
    expect(filled.textContent).not.toContain(copy.missingTag);
  });

  it('Edit opens a pop-up with the five fields filled with what is saved, and Close hides it', () => {
    renderList();
    edit('Login Anil');
    expect(field(copy.printedName).value).toBe('Dr. A. Rao');
    expect(field(copy.qualifications).value).toBe('MBBS, MD');
    expect(field(copy.speciality).value).toBe('Cardiology');
    expect(field(copy.registrationNo).value).toBe('KMC/1');
    expect(field(copy.department).value).toBe('Cardiology');
    const dialog = screen.getByRole('dialog', {
      name: copy.editTitle.replace('{name}', 'Login Anil'),
    });
    expect(within(dialog).getByRole('button', { name: copy.save })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: staffCopy.modal.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
  });

  it('each doctor has a Fees link that opens the price list for that doctor only', () => {
    renderList();
    const link = screen.getByRole('link', { name: `Login Anil: ${copy.fees}` });
    expect(link.getAttribute('href')).toBe('/app/settings/prices?kind=DOCTOR_FEE&q=DR002');
  });

  it('saves the five fields of that doctor and updates the row from the answer', async () => {
    saveMock.mockResolvedValue({
      ok: true,
      data: doctor({
        printedName: 'Dr. M. Rao',
        printName: 'Dr. M. Rao',
        qualifications: 'MBBS',
        speciality: 'GP',
        registrationNo: 'R/9',
        department: 'Medicine',
        missing: [],
      }),
    });
    renderList();
    edit('Login Meena');
    fireEvent.change(field(copy.printedName), { target: { value: 'Dr. M. Rao' } });
    fireEvent.change(field(copy.qualifications), { target: { value: 'MBBS' } });
    fireEvent.change(field(copy.speciality), { target: { value: 'GP' } });
    fireEvent.change(field(copy.registrationNo), { target: { value: 'R/9' } });
    fireEvent.change(field(copy.department), { target: { value: 'Medicine' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(saveMock).toHaveBeenCalledWith('d1', {
      printedName: 'Dr. M. Rao',
      qualifications: 'MBBS',
      speciality: 'GP',
      registrationNo: 'R/9',
      department: 'Medicine',
    });
    const row = screen.getAllByText('Login Meena')[0]!.closest('li') as HTMLElement;
    expect(row.textContent).toContain('Dr. M. Rao');
    expect(row.textContent).toContain('Medicine');
    expect(row.textContent).not.toContain(copy.missingTag);
  });

  it('Saved. fades after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      saveMock.mockResolvedValue({ ok: true, data: doctor() });
      renderList();
      edit('Login Meena');
      fireEvent.click(screen.getByRole('button', { name: copy.save }));
      await act(async () => {});
      expect(screen.getByRole('status').textContent).toBe(copy.saved);
      act(() => {
        jest.advanceTimersByTime(settingsScreenConfig.savedMessageMs + 10);
      });
      expect(screen.getByRole('status').textContent).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('explains a refusal and keeps what was typed', async () => {
    saveMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'department',
      reason: 'TOO_LONG',
    });
    renderList();
    edit('Login Meena');
    fireEvent.change(field(copy.department), { target: { value: 'Surgery' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.department} ${errors.reasons.TOO_LONG}`,
    );
    expect(field(copy.department).value).toBe('Surgery');
  });

  it('says so when a doctor is no longer in the Admin scope (404)', async () => {
    saveMock.mockResolvedValue({ ok: false, status: 404, code: 'SETTINGS_NOT_FOUND' });
    renderList();
    edit('Login Meena');
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(errors.notFound));
  });

  it('sends one request for a double click on Save', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderList();
    edit('Login Meena');
    const button = screen.getByRole('button', { name: copy.save });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: doctor() });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
  });

  it('takes the limits from the API', () => {
    renderList();
    edit('Login Meena');
    expect(field(copy.printedName).maxLength).toBe(80);
    expect(field(copy.qualifications).maxLength).toBe(150);
    expect(field(copy.registrationNo).maxLength).toBe(40);
    expect(field(copy.department).maxLength).toBe(100);
  });

  it('a reader (no write permission) sees the details but no Edit button', () => {
    renderList(data({ canWrite: false }));
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(copy.edit) })).toBeNull();
    expect(screen.getByText('Login Anil')).toBeTruthy();
  });

  it('the Availability button opens a pop-up for that doctor only; Close, Escape and a click outside close it (also for a reader)', async () => {
    availabilityMock.mockResolvedValue({
      ok: true,
      data: {
        doctorProfileId: 'd1',
        code: 'DR001',
        name: 'Login Meena',
        availabilityOn: true,
        today: '2026-11-23',
        branches: [],
        timings: [],
        leaves: [],
        canWrite: false,
      },
    });
    renderList(data({ canWrite: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const open = () =>
      fireEvent.click(
        screen.getByRole('button', { name: `Login Meena: ${staffCopy.availability.open}` }),
      );
    open();
    const dialog = screen.getByRole('dialog', {
      name: staffCopy.availability.dialogTitle.replace('{name}', 'Login Meena'),
    });
    expect(await within(dialog).findByText(staffCopy.availability.switchTitle)).toBeTruthy();
    expect(availabilityMock).toHaveBeenCalledTimes(1);
    expect(availabilityMock).toHaveBeenCalledWith('d1');

    fireEvent.click(within(dialog).getByRole('button', { name: staffCopy.modal.close }));
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when there are no doctors, and when they could not be read', () => {
    const empty = renderList(data({ items: [] }));
    expect(screen.getByText(copy.empty)).toBeTruthy();
    empty.unmount();
    render(<DoctorsList initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });

  it('shows the Leave requests button with the waiting number and opens the approval pop-up', async () => {
    leaveListMock.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 1, pageSize: 10, pendingCount: 0, today: '2026-11-23' },
    });
    render(<DoctorsList initial={data()} initialErrorCode={null} pendingLeaveRequests={3} />);
    fireEvent.click(
      screen.getByRole('button', { name: staffCopy.leave.openWithCount.replace('{count}', '3') }),
    );
    expect(await screen.findByRole('dialog', { name: staffCopy.leave.dialogTitle })).toBeTruthy();
    // the pop-up reports the real number back, so the button label follows
    await waitFor(() => expect(leaveListMock).toHaveBeenCalled());
  });

  it('shows the plain Leave requests button when the number is unknown, and none when read-only', () => {
    renderList();
    expect(screen.getByRole('button', { name: staffCopy.leave.open })).toBeTruthy();
  });

  it('a read-only viewer has no Leave requests button', () => {
    renderList(data({ canWrite: false }));
    expect(screen.queryByRole('button', { name: staffCopy.leave.open })).toBeNull();
  });
});
