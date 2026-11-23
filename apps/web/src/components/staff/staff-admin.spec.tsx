import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StaffAdmin } from '@/components/staff/staff-admin';
import { staffCopy } from '@/config/staff-copy';
import type { StaffListResponse, StaffMember, StaffOptions } from '@/lib/staff/types';

const listMock = jest.fn();
const createMock = jest.fn();
const updateMock = jest.fn();
const actionMock = jest.fn();
jest.mock('@/lib/staff/client', () => ({
  listStaff: (...args: unknown[]) => listMock(...args),
  createStaff: (...args: unknown[]) => createMock(...args),
  updateStaff: (...args: unknown[]) => updateMock(...args),
  staffAction: (...args: unknown[]) => actionMock(...args),
}));

const copy = staffCopy.staffAdmin.staff;
const form = copy.form;

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u1',
  code: 'STF001',
  name: 'Anita Rao',
  email: 'anita@example.test',
  phone: '98765',
  status: 'ACTIVE',
  branches: [{ id: 'b1', name: 'Main Branch' }],
  roles: [
    {
      assignmentId: 'a1',
      roleId: 'r-nurse',
      code: 'NURSE',
      name: 'Nurse',
      isSystem: false,
      scope: 'BRANCH',
      branchIds: ['b1'],
    },
  ],
  doctorCode: null,
  lastLoginAt: null,
  editable: true,
  isYou: false,
  ...over,
});
const list = (items: StaffMember[], over: Partial<StaffListResponse> = {}): StaffListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...over,
});
const options = (over: Partial<StaffOptions> = {}): StaffOptions => ({
  roles: [
    {
      id: 'r-nurse',
      code: 'NURSE',
      name: 'Nurse',
      description: 'Vitals',
      isSystem: false,
      assignable: true,
      reason: null,
    },
    {
      id: 'r-super',
      code: 'SUPER_ADMIN',
      name: 'Super admin',
      description: null,
      isSystem: true,
      assignable: false,
      reason: 'SYSTEM_ROLE',
    },
    {
      id: 'r-risky',
      code: 'RISKY',
      name: 'Risky',
      description: null,
      isSystem: false,
      assignable: false,
      reason: 'NOT_GRANTABLE',
    },
  ],
  branches: [
    { id: 'b1', name: 'Main Branch' },
    { id: 'b2', name: 'East Branch' },
  ],
  canHospitalScope: true,
  canWrite: true,
  codeFormat: {
    prefix: 'STF',
    minWidth: 3,
    next: 'STF002',
    limits: { prefixMax: 6, minWidthMin: 1, minWidthMax: 8 },
  },
  limits: { nameMax: 100, emailMax: 254, phoneMax: 20, maxRolesPerPerson: 5 },
  ...over,
});

const renderAdmin = (
  items: StaffMember[] = [
    member(),
    member({
      id: 'u2',
      code: 'STF002',
      name: 'Ravi Kumar',
      email: 'ravi@example.test',
      status: 'INVITED',
      phone: null,
    }),
  ],
  opts: StaffOptions | null = options(),
) => render(<StaffAdmin initial={list(items)} options={opts} initialErrorCode={null} />);
const refused = (over: Record<string, unknown>) => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  ...over,
});

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  actionMock.mockReset();
});

describe('StaffAdmin: the list', () => {
  it('shows each person with code, status, email, branches and roles', () => {
    renderAdmin();
    const card = screen.getByText('Anita Rao').closest('li') as HTMLElement;
    expect(within(card).getByText(/STF001/)).toBeTruthy();
    expect(within(card).getByText(copy.statuses.ACTIVE!)).toBeTruthy();
    expect(within(card).getByText('anita@example.test')).toBeTruthy();
    expect(within(card).getByText('Main Branch')).toBeTruthy();
    expect(within(card).getByText('Nurse')).toBeTruthy();
    expect(within(card).getByText(copy.neverSignedIn)).toBeTruthy();
    const second = screen.getByText('Ravi Kumar').closest('li') as HTMLElement;
    expect(within(second).getByText(copy.statuses.INVITED!)).toBeTruthy();
    expect(within(second).getByText(copy.notSet, { selector: 'dd' })).toBeTruthy();
  });

  it('marks a whole-hospital role and a doctor code, and says (You) for the signed-in person', () => {
    renderAdmin([
      member({
        isYou: true,
        doctorCode: 'DR001',
        roles: [
          {
            assignmentId: 'a',
            roleId: 'r',
            code: 'X',
            name: 'Auditor',
            isSystem: false,
            scope: 'HOSPITAL',
            branchIds: [],
          },
        ],
      }),
    ]);
    expect(screen.getByText(/Anita Rao \(You\)/)).toBeTruthy();
    expect(screen.getByText(`Auditor (${copy.wholeHospitalTag})`)).toBeTruthy();
    expect(screen.getByText(/Doctor DR001/)).toBeTruthy();
  });

  it('shows a calm error when the list or the options could not be loaded', () => {
    render(<StaffAdmin initial={null} options={null} initialErrorCode="UNAVAILABLE" />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    render(<StaffAdmin initial={null} options={null} initialErrorCode={null} />);
    expect(screen.getAllByRole('alert')[1]!.textContent).toBe(copy.loadError);
  });

  it('a person who cannot change staff sees the list without Add, Edit or Switch off', () => {
    renderAdmin(undefined, options({ canWrite: false }));
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.add })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(copy.edit) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(copy.actions.switchOff) })).toBeNull();
  });

  it("a person outside the Admin's branches shows a note instead of buttons", () => {
    renderAdmin([member({ editable: false })]);
    expect(screen.getByText(copy.notEditable)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Anita Rao: ${copy.edit}` })).toBeNull();
  });
});

describe('StaffAdmin: search, filter and pages', () => {
  it('asks the API again, after a short pause, with the typed text', async () => {
    listMock.mockResolvedValue({ ok: true, data: list([member({ name: 'Only Match' })]) });
    renderAdmin();
    fireEvent.change(screen.getByLabelText(copy.searchLabel), { target: { value: ' ana ' } });
    expect(listMock).not.toHaveBeenCalled(); // not on every key press
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ q: 'ana', status: '', page: 1 }));
    await waitFor(() => expect(screen.getByText('Only Match')).toBeTruthy());
    expect(screen.queryByText('Ravi Kumar')).toBeNull();
  });

  it('the status filter asks for that status at once', async () => {
    listMock.mockResolvedValue({ ok: true, data: list([]) });
    renderAdmin();
    fireEvent.change(screen.getByLabelText(copy.statusLabel), { target: { value: 'INVITED' } });
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith({ q: '', status: 'INVITED', page: 1 }),
    );
    await waitFor(() => expect(screen.getByText(copy.empty)).toBeTruthy());
  });

  it('Next asks for page 2', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: list([member({ name: 'Page Two' })], { page: 2, total: 40 }),
    });
    render(
      <StaffAdmin
        initial={list([member()], { total: 40 })}
        options={options()}
        initialErrorCode={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: staffCopy.pagination.next }));
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ q: '', status: '', page: 2 }));
    await waitFor(() => expect(screen.getByText('Page Two')).toBeTruthy());
  });

  it('shows the refusal when the list cannot be read, and keeps the old list', async () => {
    listMock.mockResolvedValue(refused({ status: 0, code: 'UNAVAILABLE' }));
    renderAdmin();
    fireEvent.change(screen.getByLabelText(copy.statusLabel), { target: { value: 'ACTIVE' } });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable),
    );
    expect(screen.getByText('Anita Rao')).toBeTruthy();
  });
});

describe('StaffAdmin: add staff', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: copy.add }));
  const fill = () => {
    fireEvent.change(screen.getByLabelText(form.name), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText(new RegExp(form.email)), {
      target: { value: 'new@example.test' },
    });
  };

  it('offers only the branches and roles the API allows; a blocked role says why and cannot be ticked', () => {
    renderAdmin();
    open();
    expect(screen.getByLabelText('Main Branch')).toBeTruthy();
    expect(screen.getByLabelText('East Branch')).toBeTruthy();
    expect((screen.getByLabelText('Super admin') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(form.notAllowed.SYSTEM_ROLE!)).toBeTruthy();
    expect((screen.getByLabelText('Risky') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(form.notAllowed.NOT_GRANTABLE!)).toBeTruthy();
    expect((screen.getByLabelText('Nurse') as HTMLInputElement).disabled).toBe(false);
  });

  it('needs at least one branch and one role before anything is sent', () => {
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    expect(screen.getByRole('alert').textContent).toBe(form.needBranch);
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    expect(screen.getByRole('alert').textContent).toBe(form.needRole);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sends the typed values, shows the new person and tells the email was sent', async () => {
    const created = member({
      id: 'u9',
      code: 'STF009',
      name: 'New Person',
      email: 'new@example.test',
      status: 'INVITED',
    });
    createMock.mockResolvedValue({ ok: true, data: { staff: created, activationSent: true } });
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByLabelText('Nurse'));
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith({
      name: 'New Person',
      email: 'new@example.test',
      phone: '',
      branchIds: ['b1'],
      roles: [{ roleId: 'r-nurse' }],
    });
    await waitFor(() => expect(screen.getByText('New Person')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(
      form.added.replace('{email}', 'new@example.test'),
    );
    expect(screen.queryByRole('button', { name: form.addSubmit })).toBeNull(); // the form closes
  });

  it('a hospital-wide Admin can choose every branch for a role; it is sent as the HOSPITAL scope', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: { staff: member({ id: 'u9', name: 'Wide' }), activationSent: true },
    });
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByLabelText('Nurse'));
    fireEvent.change(screen.getByLabelText(form.scopeFor.replace('{role}', 'Nurse')), {
      target: { value: 'ALL' },
    });
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0]![0].roles).toEqual([{ roleId: 'r-nurse', scope: 'HOSPITAL' }]);
  });

  it('a Branch Admin is not offered the every-branch choice', () => {
    renderAdmin(undefined, options({ canHospitalScope: false }));
    open();
    fireEvent.click(screen.getByLabelText('Nurse'));
    expect(screen.queryByLabelText(form.scopeFor.replace('{role}', 'Nurse'))).toBeNull();
    expect(screen.queryByText(form.scopeTitle)).toBeNull();
  });

  it('says so when the person was added but the email could not be sent', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: { staff: member({ id: 'u9', name: 'No Mail' }), activationSent: false },
    });
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByLabelText('Nurse'));
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(form.addedNoMail));
  });

  it('keeps the form and names the problem when the API refuses', async () => {
    createMock.mockResolvedValue(refused({ field: 'email', reason: 'DUPLICATE' }));
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByLabelText('Nurse'));
    fireEvent.click(screen.getByRole('button', { name: form.addSubmit }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${staffCopy.settings.settingsErrors.prefix} ${staffCopy.settings.settingsErrors.fields.email} ${staffCopy.settings.settingsErrors.reasons.DUPLICATE}`,
    );
    expect(screen.getByLabelText(form.name)).toBeTruthy();
  });

  it('a double click sends one request', async () => {
    let finish: (v: unknown) => void = () => undefined;
    createMock.mockReturnValue(new Promise((r) => (finish = r)));
    renderAdmin();
    open();
    fill();
    fireEvent.click(screen.getByLabelText('Main Branch'));
    fireEvent.click(screen.getByLabelText('Nurse'));
    const submit = screen.getByRole('button', { name: form.addSubmit });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(createMock).toHaveBeenCalledTimes(1);
    finish(refused({ field: 'name', reason: 'REQUIRED' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});

describe('StaffAdmin: change, switch off and on, resend', () => {
  it('Edit opens the form with the current values; Save sends them and updates the card', async () => {
    updateMock.mockResolvedValue({ ok: true, data: member({ name: 'Anita R. Rao' }) });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.edit}` }));
    expect((screen.getByLabelText(form.name) as HTMLInputElement).value).toBe('Anita Rao');
    expect((screen.getByLabelText('Main Branch') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('East Branch') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Nurse') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(form.name), { target: { value: 'Anita R. Rao' } });
    fireEvent.click(screen.getByRole('button', { name: form.save }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith('u1', {
      name: 'Anita R. Rao',
      email: 'anita@example.test',
      phone: '98765',
      branchIds: ['b1'],
      roles: [{ roleId: 'r-nurse' }],
    });
    await waitFor(() => expect(screen.getByText('Anita R. Rao')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(form.saved);
  });

  it('for the signed-in person the branches and roles are locked and only name, email and phone are sent', async () => {
    updateMock.mockResolvedValue({ ok: true, data: member({ isYou: true }) });
    renderAdmin([member({ isYou: true })]);
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.edit}` }));
    expect(screen.getByText(form.ownRolesNote)).toBeTruthy();
    expect(screen.getByLabelText('Main Branch').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Nurse').matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: form.save }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0]![1]).toEqual({
      name: 'Anita Rao',
      email: 'anita@example.test',
      phone: '98765',
    });
  });

  it('nobody can switch themselves off from the list', () => {
    renderAdmin([member({ isYou: true })]);
    expect(screen.queryByRole('button', { name: new RegExp(copy.actions.switchOff) })).toBeNull();
  });

  it('Switch off asks first; Cancel changes nothing; Yes switches off and shows it', async () => {
    actionMock.mockResolvedValue({ ok: true, data: member({ status: 'INACTIVE' }) });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.actions.switchOff}` }));
    expect(screen.getByText(copy.actions.confirmOff.replace('{name}', 'Anita Rao'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.actions.confirmNo }));
    expect(actionMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.actions.switchOff}` }));
    fireEvent.click(screen.getByRole('button', { name: copy.actions.confirmYes }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith('u1', 'deactivate'));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        copy.actions.switchedOff.replace('{name}', 'Anita Rao'),
      ),
    );
    const card = screen.getByText('Anita Rao').closest('li') as HTMLElement;
    expect(within(card).getByText(copy.statuses.INACTIVE!)).toBeTruthy();
    expect(
      within(card).getByRole('button', { name: `Anita Rao: ${copy.actions.switchOn}` }),
    ).toBeTruthy();
  });

  it('Switch on brings a person back', async () => {
    actionMock.mockResolvedValue({ ok: true, data: member({ status: 'ACTIVE' }) });
    renderAdmin([member({ status: 'INACTIVE' })]);
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.actions.switchOn}` }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith('u1', 'reactivate'));
    await waitFor(() =>
      expect(screen.getByText(copy.statuses.ACTIVE!, { selector: 'span' })).toBeTruthy(),
    );
  });

  it('names the reason when the API refuses (the last SuperAdmin)', async () => {
    actionMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'STAFF_CONFLICT',
      reason: 'LAST_SUPER_ADMIN',
    });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: `Anita Rao: ${copy.actions.switchOff}` }));
    fireEvent.click(screen.getByRole('button', { name: copy.actions.confirmYes }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        staffCopy.staffAdmin.errors.conflicts.LAST_SUPER_ADMIN,
      ),
    );
    const card = screen.getByText('Anita Rao').closest('li') as HTMLElement;
    expect(within(card).getByText(copy.statuses.ACTIVE!)).toBeTruthy(); // unchanged
  });

  it('Send activation email again is only for people who have not activated, and says where it went', async () => {
    actionMock.mockResolvedValue({ ok: true, data: { activationSent: true } });
    renderAdmin();
    expect(screen.getAllByRole('button', { name: new RegExp(copy.actions.resend) })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole('button', { name: `Ravi Kumar: ${copy.actions.resend}` }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith('u2', 'resend-invite'));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        copy.actions.resent.replace('{email}', 'ravi@example.test'),
      ),
    );
  });

  it('says so when the email could not be sent again', async () => {
    actionMock.mockResolvedValue({ ok: true, data: { activationSent: false } });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: `Ravi Kumar: ${copy.actions.resend}` }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.actions.resentFailed),
    );
  });
});
