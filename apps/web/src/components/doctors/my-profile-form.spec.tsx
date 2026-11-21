import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MyProfileForm, previewLines } from '@/components/doctors/my-profile-form';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import type { MyProfileResponse } from '@/lib/doctors/types';

const saveMock = jest.fn();
jest.mock('@/lib/doctors/client', () => ({
  saveMyProfile: (...args: unknown[]) => saveMock(...args),
}));

const copy = staffCopy.doctorProfile;
const errors = staffCopy.settings.settingsErrors;
const limits = {
  printedName: 80,
  qualifications: 150,
  speciality: 80,
  registrationNo: 40,
  department: 100,
};

const profile = (over: Partial<MyProfileResponse> = {}): MyProfileResponse => ({
  id: 'dp1',
  code: 'DR1',
  name: 'Login Meena',
  printedName: null,
  printName: 'Login Meena',
  department: 'General',
  qualifications: null,
  speciality: null,
  registrationNo: null,
  active: true,
  branches: ['Main Branch', 'East Branch'],
  missing: ['qualifications', 'speciality', 'registrationNo'],
  limits,
  ...over,
});
const complete = (): MyProfileResponse =>
  profile({
    printedName: 'Dr. M. Rao',
    printName: 'Dr. M. Rao',
    qualifications: 'MBBS, MD',
    speciality: 'General Medicine',
    registrationNo: 'KMC/12345',
    missing: [],
  });

const renderForm = (initial: MyProfileResponse | null = profile()) =>
  render(<MyProfileForm initial={initial} initialErrorCode={null} />);
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: copy.save }));

beforeEach(() => saveMock.mockReset());

describe('previewLines', () => {
  it('prints the name, qualifications, speciality and the registration number with its caption', () => {
    expect(
      previewLines({
        printName: 'Dr. M. Rao',
        qualifications: 'MBBS',
        speciality: 'GP',
        registrationNo: 'R1',
      }),
    ).toEqual(['Dr. M. Rao', 'MBBS', 'GP', `${staffCopy.print.fields.doctorRegistrationNo}: R1`]);
    expect(
      previewLines({
        printName: 'Dr X',
        qualifications: null,
        speciality: null,
        registrationNo: null,
      }),
    ).toEqual(['Dr X']);
  });
});

describe('MyProfileForm', () => {
  it('shows the login name, the department (set by an Admin) and the branches, and the saved details', () => {
    renderForm(complete());
    expect(screen.getByText('Login Meena')).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Main Branch, East Branch')).toBeTruthy();
    expect(input(copy.printedName).value).toBe('Dr. M. Rao');
    expect(input(copy.qualifications).value).toBe('MBBS, MD');
    expect(input(copy.speciality).value).toBe('General Medicine');
    expect(input(copy.registrationNo).value).toBe('KMC/12345');
    // the department has no input: only an Admin changes it
    expect(screen.queryByLabelText(copy.department)).toBeNull();
  });

  it('reminds which details are empty, and says nothing when all are filled', () => {
    const first = renderForm();
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(copy.reminderTitle);
    expect(note.textContent).toContain(
      `${copy.missingNames.qualifications}, ${copy.missingNames.speciality}, ${copy.missingNames.registrationNo}`,
    );
    first.unmount();
    renderForm(complete());
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows how it will print, and says so when nothing is set', () => {
    const empty = renderForm();
    expect(screen.getByText(copy.previewEmpty)).toBeTruthy();
    empty.unmount();
    renderForm(complete());
    const preview = screen.getByTestId('profile-preview');
    expect(preview.textContent).toContain('Dr. M. Rao');
    expect(preview.textContent).toContain('MBBS, MD');
    expect(preview.textContent).toContain(
      `${staffCopy.print.fields.doctorRegistrationNo}: KMC/12345`,
    );
  });

  it('saves the four details (never the department), shows the answer and clears the reminder', async () => {
    saveMock.mockResolvedValue({ ok: true, data: complete() });
    renderForm();
    type(copy.printedName, 'Dr. M. Rao');
    type(copy.qualifications, 'MBBS, MD');
    type(copy.speciality, 'General Medicine');
    type(copy.registrationNo, 'KMC/12345');
    save();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(saveMock).toHaveBeenCalledWith({
      printedName: 'Dr. M. Rao',
      qualifications: 'MBBS, MD',
      speciality: 'General Medicine',
      registrationNo: 'KMC/12345',
    });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByTestId('profile-preview').textContent).toContain('Dr. M. Rao');
  });

  it('Saved. fades after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      saveMock.mockResolvedValue({ ok: true, data: complete() });
      renderForm();
      save();
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

  it('explains a refusal naming the field, keeps what was typed, and a later success clears it', async () => {
    saveMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'registrationNo',
      reason: 'INVALID',
    });
    renderForm();
    type(copy.registrationNo, '<x>');
    save();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.registrationNo} ${errors.reasons.INVALID}`,
    );
    expect(input(copy.registrationNo).value).toBe('<x>');
    saveMock.mockResolvedValueOnce({ ok: true, data: complete() });
    save();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the usual message when permission is refused', async () => {
    saveMock.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
    renderForm();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden),
    );
  });

  it('sends one request for a double click', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderForm();
    const button = screen.getByRole('button', { name: copy.save });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: complete() });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
  });

  it('takes the limits of the fields from the API', () => {
    renderForm();
    expect(input(copy.printedName).maxLength).toBe(80);
    expect(input(copy.qualifications).maxLength).toBe(150);
    expect(input(copy.speciality).maxLength).toBe(80);
    expect(input(copy.registrationNo).maxLength).toBe(40);
  });

  it('shows a calm message when the profile could not be read', () => {
    render(<MyProfileForm initial={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    expect(screen.queryByLabelText(copy.printedName)).toBeNull();
  });
});
