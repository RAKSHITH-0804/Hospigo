import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CodeFormatCard } from '@/components/staff/code-format-card';
import { RolesManager } from '@/components/staff/roles-manager';
import { staffCopy } from '@/config/staff-copy';
import type {
  CatalogPermission,
  RoleTemplate,
  RoleView,
  RolesListResponse,
  StaffCodeFormat,
} from '@/lib/staff/types';

const createMock = jest.fn();
const updateMock = jest.fn();
const actionMock = jest.fn();
const formatMock = jest.fn();
jest.mock('@/lib/staff/client', () => ({
  createRole: (...args: unknown[]) => createMock(...args),
  updateRole: (...args: unknown[]) => updateMock(...args),
  roleAction: (...args: unknown[]) => actionMock(...args),
  saveCodeFormat: (...args: unknown[]) => formatMock(...args),
}));

const copy = staffCopy.staffAdmin.roles;
const role = (over: Partial<RoleView> = {}): RoleView => ({
  id: 'r1',
  code: 'LAB',
  name: 'Lab clerk',
  description: 'Sees patients',
  isSystem: false,
  isActive: true,
  permissionCodes: ['patients.registry.read'],
  assignedCount: 0,
  ...over,
});
const system = role({
  id: 'rs',
  code: 'SUPER_ADMIN',
  name: 'Super admin',
  isSystem: true,
  assignedCount: 1,
  permissionCodes: ['user.read', 'user.write'],
});
const list = (items: RoleView[], canWrite = true): RolesListResponse => ({ items, canWrite });
const catalog: CatalogPermission[] = [
  { code: 'opd.visits.read', description: 'View visits', group: 'opd' },
  { code: 'patients.registry.read', description: 'View patients', group: 'patients' },
  { code: 'patients.registry.write', description: 'Register patients', group: 'patients' },
  { code: 'zzz.thing', description: 'Unknown group thing', group: 'zzz' },
];
const templates: RoleTemplate[] = [
  {
    key: 'NURSE',
    name: 'Nurse',
    description: 'Records vitals',
    permissionCodes: ['opd.visits.read', 'patients.registry.read'],
  },
];
const renderRoles = (items: RoleView[] = [system, role()], canWrite = true) =>
  render(
    <RolesManager
      initial={list(items, canWrite)}
      catalog={catalog}
      templates={templates}
      initialErrorCode={null}
    />,
  );
const refused = (over: Record<string, unknown>) => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  ...over,
});

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  actionMock.mockReset();
  formatMock.mockReset();
});

describe('RolesManager', () => {
  it('lists the roles with power counts and who holds them; the ready-made ones are fixed', () => {
    renderRoles();
    const sys = screen.getByText('Super admin').closest('li') as HTMLElement;
    expect(within(sys).getByText(copy.readyMade)).toBeTruthy();
    expect(within(sys).getByText(copy.fixedNote)).toBeTruthy();
    expect(within(sys).queryByRole('button')).toBeNull();
    expect(within(sys).getByText(/2 powers · 1 people hold it/)).toBeTruthy();
    const mine = screen.getByText('Lab clerk').closest('li') as HTMLElement;
    expect(within(mine).getByText(/1 powers · Nobody holds it/)).toBeTruthy();
    expect(within(mine).getByRole('button', { name: `Lab clerk: ${copy.edit}` })).toBeTruthy();
  });

  it('a person who may not change roles sees them without any button', () => {
    renderRoles(undefined, false);
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.add })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(copy.edit) })).toBeNull();
  });

  it('shows an error instead of a blank page when the roles could not be read', () => {
    render(
      <RolesManager initial={null} catalog={null} templates={[]} initialErrorCode="FORBIDDEN" />,
    );
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
  });

  it('Add role: the powers are grouped by area with the plain descriptions', () => {
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    expect(screen.getByText(copy.groupNames.opd!)).toBeTruthy();
    expect(screen.getByText(copy.groupNames.patients!)).toBeTruthy();
    expect(screen.getByText('zzz')).toBeTruthy(); // an area without a name shows as it is
    expect(screen.getByLabelText('View patients')).toBeTruthy();
    expect(screen.getByText('(0 ticked)')).toBeTruthy();
  });

  it('a ready-made role fills the powers and the empty name; the person can still change them', () => {
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.template), { target: { value: 'NURSE' } });
    expect((screen.getByLabelText(copy.form.name) as HTMLInputElement).value).toBe('Nurse');
    expect((screen.getByLabelText('View visits') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Register patients') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('(2 ticked)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Register patients'));
    expect(screen.getByText('(3 ticked)')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      copy.form.templateApplied.replace('{name}', 'Nurse'),
    );
  });

  it('a name already typed is not replaced by the template', () => {
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'My own name' } });
    fireEvent.change(screen.getByLabelText(copy.form.template), { target: { value: 'NURSE' } });
    expect((screen.getByLabelText(copy.form.name) as HTMLInputElement).value).toBe('My own name');
  });

  it('needs at least one power before anything is sent', () => {
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'Empty' } });
    fireEvent.click(screen.getByRole('button', { name: copy.form.save }));
    expect(screen.getByRole('alert').textContent).toBe(copy.form.powersNone);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('saves a new role with the ticked codes and shows it in the list', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: role({ id: 'r9', name: 'Fresh role', permissionCodes: ['opd.visits.read'] }),
    });
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'Fresh role' } });
    fireEvent.click(screen.getByLabelText('View visits'));
    fireEvent.click(screen.getByRole('button', { name: copy.form.save }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith({
      name: 'Fresh role',
      description: '',
      permissionCodes: ['opd.visits.read'],
    });
    await waitFor(() => expect(screen.getByText('Fresh role')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(copy.form.created);
  });

  it('Edit starts from the current powers and saves the change', async () => {
    updateMock.mockResolvedValue({
      ok: true,
      data: role({
        name: 'Lab clerk 2',
        permissionCodes: ['patients.registry.read', 'opd.visits.read'],
      }),
    });
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: `Lab clerk: ${copy.edit}` }));
    expect((screen.getByLabelText('View patients') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('View visits') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText('View visits'));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'Lab clerk 2' } });
    fireEvent.click(screen.getByRole('button', { name: copy.form.save }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0]![0]).toBe('r1');
    expect(new Set(updateMock.mock.calls[0]![1].permissionCodes)).toEqual(
      new Set(['patients.registry.read', 'opd.visits.read']),
    );
    await waitFor(() => expect(screen.getByText('Lab clerk 2')).toBeTruthy());
  });

  it('names the problem when the API refuses (a name already used)', async () => {
    createMock.mockResolvedValue(refused({ field: 'name', reason: 'DUPLICATE' }));
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'Lab clerk' } });
    fireEvent.click(screen.getByLabelText('View visits'));
    fireEvent.click(screen.getByRole('button', { name: copy.form.save }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain(
      staffCopy.settings.settingsErrors.reasons.DUPLICATE,
    );
  });

  it('Add and Edit open in a pop-up; Cancel and Close hide it; a refusal shows inside it', async () => {
    createMock.mockResolvedValue(refused({ field: 'name', reason: 'DUPLICATE' }));
    renderRoles();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    const dialog = screen.getByRole('dialog', { name: copy.form.addTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: copy.form.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.add }));
    fireEvent.change(screen.getByLabelText(copy.form.name), { target: { value: 'Lab clerk' } });
    fireEvent.click(screen.getByLabelText('View visits'));
    fireEvent.click(screen.getByRole('button', { name: copy.form.save }));
    const inside = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(inside.textContent).toContain(staffCopy.settings.settingsErrors.reasons.DUPLICATE);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: staffCopy.modal.close }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Lab clerk: ${copy.edit}` }));
    expect(
      screen.getByRole('dialog', { name: copy.form.editTitle.replace('{name}', 'Lab clerk') }),
    ).toBeTruthy();
  });

  it('a role that people hold says why it cannot be deactivated', () => {
    renderRoles([role({ id: 'r2', name: 'In use', assignedCount: 3 })]);
    expect(screen.getByText(copy.cannotDeactivate)).toBeTruthy();
  });

  it('Switch off only for a role nobody holds; a role in use has no such button', () => {
    renderRoles([role(), role({ id: 'r2', name: 'In use', assignedCount: 3 })]);
    expect(
      screen.getByRole('button', { name: `Lab clerk: ${copy.actions.switchOff}` }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: `In use: ${copy.actions.switchOff}` })).toBeNull();
  });

  it('Switch off and Switch on call the API and show the new state', async () => {
    actionMock.mockResolvedValueOnce({ ok: true, data: role({ isActive: false }) });
    renderRoles([role()]);
    fireEvent.click(screen.getByRole('button', { name: `Lab clerk: ${copy.actions.switchOff}` }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith('r1', 'deactivate'));
    await waitFor(() => expect(screen.getByText(copy.switchedOff)).toBeTruthy());
    actionMock.mockResolvedValueOnce({ ok: true, data: role({ isActive: true }) });
    fireEvent.click(screen.getByRole('button', { name: `Lab clerk: ${copy.actions.switchOn}` }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith('r1', 'reactivate'));
    await waitFor(() => expect(screen.queryByText(copy.switchedOff)).toBeNull());
  });

  it('says why a role cannot be switched off when the API refuses', async () => {
    actionMock.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'STAFF_CONFLICT',
      reason: 'ROLE_IN_USE',
    });
    renderRoles([role()]);
    fireEvent.click(screen.getByRole('button', { name: `Lab clerk: ${copy.actions.switchOff}` }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        staffCopy.staffAdmin.errors.conflicts.ROLE_IN_USE,
      ),
    );
  });
});

describe('CodeFormatCard', () => {
  const format: StaffCodeFormat = {
    prefix: 'STF',
    minWidth: 3,
    next: 'STF002',
    limits: { prefixMax: 6, minWidthMin: 1, minWidthMax: 8 },
  };
  const cc = staffCopy.staffAdmin.codeFormat;

  it('shows the next code and, for a hospital-wide Admin, the form', () => {
    render(<CodeFormatCard initial={format} initialErrorCode={null} canWrite />);
    expect(screen.getByText('STF002')).toBeTruthy();
    expect((screen.getByLabelText(new RegExp(cc.prefix)) as HTMLInputElement).value).toBe('STF');
    expect(screen.getByRole('button', { name: cc.save })).toBeTruthy();
  });

  it('others see the format but no form', () => {
    render(<CodeFormatCard initial={format} initialErrorCode={null} canWrite={false} />);
    expect(screen.getByText('STF002')).toBeTruthy();
    expect(screen.queryByRole('button', { name: cc.save })).toBeNull();
  });

  it('saves the typed prefix and digits and shows the new next code', async () => {
    formatMock.mockResolvedValue({
      ok: true,
      data: { ...format, prefix: 'EMP', minWidth: 4, next: 'EMP0002' },
    });
    render(<CodeFormatCard initial={format} initialErrorCode={null} canWrite />);
    fireEvent.change(screen.getByLabelText(new RegExp(cc.prefix)), { target: { value: 'EMP' } });
    fireEvent.change(screen.getByLabelText(new RegExp(cc.minWidth)), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: cc.save }));
    await waitFor(() => expect(formatMock).toHaveBeenCalledWith({ prefix: 'EMP', minWidth: 4 }));
    await waitFor(() => expect(screen.getByText('EMP0002')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(cc.saved);
  });

  it('shows the refusal and keeps the old format', async () => {
    formatMock.mockResolvedValue(refused({ field: 'prefix', reason: 'INVALID' }));
    render(<CodeFormatCard initial={format} initialErrorCode={null} canWrite />);
    fireEvent.change(screen.getByLabelText(new RegExp(cc.prefix)), { target: { value: '!!' } });
    fireEvent.click(screen.getByRole('button', { name: cc.save }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('STF002')).toBeTruthy();
  });

  it('shows a calm error when the format could not be read', () => {
    render(<CodeFormatCard initial={null} initialErrorCode="UNAVAILABLE" canWrite />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });
});
