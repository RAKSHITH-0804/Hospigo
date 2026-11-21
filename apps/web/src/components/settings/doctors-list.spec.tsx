import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DoctorsList } from '@/components/settings/doctors-list';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import type { DoctorProfile, DoctorsListResponse } from '@/lib/doctors/types';

const saveMock = jest.fn();
jest.mock('@/lib/doctors/client', () => ({
  saveDoctorProfile: (...args: unknown[]) => saveMock(...args),
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
  canWrite: true,
  ...over,
});

const renderList = (initial: DoctorsListResponse | null = data()) =>
  render(<DoctorsList initial={initial} initialErrorCode={null} />);
const edit = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `${name}: ${copy.edit}` }));
const panel = () => screen.getByRole('button', { name: copy.save }).closest('form') as HTMLElement;
const field = (label: string) => within(panel()).getByLabelText(label) as HTMLInputElement;

beforeEach(() => saveMock.mockReset());

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

  it('Edit opens the five fields filled with what is saved, and Close hides them', () => {
    renderList();
    edit('Login Anil');
    expect(field(copy.printedName).value).toBe('Dr. A. Rao');
    expect(field(copy.qualifications).value).toBe('MBBS, MD');
    expect(field(copy.speciality).value).toBe('Cardiology');
    expect(field(copy.registrationNo).value).toBe('KMC/1');
    expect(field(copy.department).value).toBe('Cardiology');
    fireEvent.click(screen.getByRole('button', { name: `Login Anil: ${copy.done}` }));
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
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

  it('says so when there are no doctors, and when they could not be read', () => {
    const empty = renderList(data({ items: [] }));
    expect(screen.getByText(copy.empty)).toBeTruthy();
    empty.unmount();
    render(<DoctorsList initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });
});
