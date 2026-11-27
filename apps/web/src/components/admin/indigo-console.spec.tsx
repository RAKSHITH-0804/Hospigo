import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndigoEmployees } from '@/components/admin/indigo-employees';
import { OnboardHospital } from '@/components/admin/onboard-hospital';
import { staffCopy } from '@/config/staff-copy';

const onboardMock = jest.fn();
const createEmployeeMock = jest.fn();
const saveHospitalsMock = jest.fn();
const setActiveMock = jest.fn();
jest.mock('@/lib/indigo/client', () => ({
  onboardHospital: (...args: unknown[]) => onboardMock(...args),
  createEmployee: (...args: unknown[]) => createEmployeeMock(...args),
  saveEmployeeHospitals: (...args: unknown[]) => saveHospitalsMock(...args),
  setEmployeeActive: (...args: unknown[]) => setActiveMock(...args),
}));

const copy = staffCopy.admin.console;
const hq = staffCopy.admin.hq;
const next = () => fireEvent.click(screen.getByRole('button', { name: hq.next }));
const catalog = [
  { code: 'OPD', name: 'Outpatient' },
  { code: 'IPD', name: 'Inpatient' },
];

beforeEach(() => {
  onboardMock.mockReset();
  createEmployeeMock.mockReset();
  saveHospitalsMock.mockReset();
  setActiveMock.mockReset();
});

describe('OnboardHospital', () => {
  it('sends the hospital, the branches with one main branch, the modules and the first SuperAdmin', async () => {
    onboardMock.mockResolvedValue({
      ok: true,
      data: {
        hospital: { id: 'h9', code: 'NEWCO', name: 'New Co' },
        branches: [{ code: 'MAIN', name: 'Main Branch', accessCode: 'newco-main', isMain: true }],
        superAdmin: { id: 'u1', email: 'boss@example.test', temporaryPassword: 'Temp-Pass-123' },
        nextStep: 'npm run hospital:starter -- --hospital NEWCO',
      },
    });
    render(<OnboardHospital moduleCatalog={catalog} />);
    fireEvent.change(screen.getByLabelText(copy.hospitalCode), { target: { value: 'newco' } });
    fireEvent.change(screen.getByLabelText(copy.hospitalName), { target: { value: 'New Co' } });
    next();
    fireEvent.change(screen.getByLabelText(copy.branchAccessCode, { exact: false }), {
      target: { value: 'newco-main' },
    });
    fireEvent.change(screen.getByLabelText(copy.adminName), { target: { value: 'The Boss' } });
    fireEvent.change(screen.getByLabelText(copy.adminEmail), {
      target: { value: 'boss@example.test' },
    });
    next();
    fireEvent.click(screen.getByLabelText('Inpatient'));
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
    await waitFor(() => expect(onboardMock).toHaveBeenCalledTimes(1));
    expect(onboardMock).toHaveBeenCalledWith({
      code: 'NEWCO',
      name: 'New Co',
      branches: [{ code: 'MAIN', name: 'Main Branch', accessCode: 'newco-main', isMain: true }],
      moduleCodes: ['OPD', 'IPD'],
      superAdmin: { name: 'The Boss', email: 'boss@example.test' },
    });
    // the one-time password is shown once, with the next step
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Temp-Pass-123'));
    expect(screen.getByText(/hospital:starter/)).toBeTruthy();
  });

  it('says plainly when a code is already used, and OPD cannot be unticked', async () => {
    onboardMock.mockResolvedValue({ ok: false, code: 'INDIGO_CONFLICT', status: 409 });
    render(<OnboardHospital moduleCatalog={catalog} />);
    next();
    next();
    expect((screen.getByLabelText(/Outpatient/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.taken));
  });

  it('can add a second branch and chooses which one is the main branch', async () => {
    onboardMock.mockResolvedValue({ ok: false, code: 'X', status: 400 });
    render(<OnboardHospital moduleCatalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: copy.addBranch }));
    const mains = screen.getAllByRole('radio');
    expect(mains).toHaveLength(2);
    fireEvent.click(mains[1]!);
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
    await waitFor(() => expect(onboardMock).toHaveBeenCalledTimes(1));
    const sent = onboardMock.mock.calls[0]![0] as { branches: Array<{ isMain: boolean }> };
    expect(sent.branches.map((b) => b.isMain)).toEqual([false, true]);
  });
});

describe('IndigoEmployees', () => {
  const hospitals = [
    { id: 'h1', name: 'North' },
    { id: 'h2', name: 'South' },
  ];

  it('adds an employee, shows the one-time password, and lists the person without hospitals', async () => {
    createEmployeeMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'e1',
        email: 'new@example.test',
        displayName: 'New One',
        temporaryPassword: 'Temp-Emp-456',
      },
    });
    render(<IndigoEmployees employees={[]} hospitals={hospitals} />);
    expect(screen.getByText(copy.employeesEmpty)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(copy.employeeName), { target: { value: 'New One' } });
    fireEvent.change(screen.getByLabelText(copy.employeeEmail), {
      target: { value: 'new@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.employeeCreate }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Temp-Emp-456'));
    expect(createEmployeeMock).toHaveBeenCalledWith({ name: 'New One', email: 'new@example.test' });
    expect(screen.getByText(/New One · new@example.test/)).toBeTruthy();
  });

  it('assigns hospitals and switches an employee off and on', async () => {
    saveHospitalsMock.mockResolvedValue({ ok: true, data: { hospitalIds: ['h1', 'h2'] } });
    setActiveMock.mockResolvedValue({ ok: true, data: { id: 'e1', isActive: false } });
    render(
      <IndigoEmployees
        employees={[
          {
            id: 'e1',
            email: 'e@example.test',
            displayName: 'Eve',
            isActive: true,
            hospitalIds: ['h1'],
          },
        ]}
        hospitals={hospitals}
      />,
    );
    fireEvent.click(screen.getByLabelText('South'));
    fireEvent.click(screen.getByRole('button', { name: copy.employeeSaveHospitals }));
    await waitFor(() => expect(saveHospitalsMock).toHaveBeenCalledWith('e1', ['h1', 'h2']));
    fireEvent.click(screen.getByRole('button', { name: copy.employeeOff }));
    await waitFor(() => expect(setActiveMock).toHaveBeenCalledWith('e1', false));
    await waitFor(() => expect(screen.getByRole('button', { name: copy.employeeOn })).toBeTruthy());
  });
});
