import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RegistrationFields } from '@/components/settings/registration-fields';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import type { BuiltinField, CustomField, PatientFieldsResponse } from '@/lib/settings/types';

const mocks = {
  saveBuiltinField: jest.fn(),
  createCustomField: jest.fn(),
  updateCustomField: jest.fn(),
  saveCustomOptions: jest.fn(),
  addReferenceSet: jest.fn(),
  loadPatientFields: jest.fn(),
};
jest.mock('@/lib/settings/client', () => ({
  saveBuiltinField: (...a: unknown[]) => mocks.saveBuiltinField(...a),
  createCustomField: (...a: unknown[]) => mocks.createCustomField(...a),
  updateCustomField: (...a: unknown[]) => mocks.updateCustomField(...a),
  saveCustomOptions: (...a: unknown[]) => mocks.saveCustomOptions(...a),
  addReferenceSet: (...a: unknown[]) => mocks.addReferenceSet(...a),
  loadPatientFields: (...a: unknown[]) => mocks.loadPatientFields(...a),
}));

const copy = staffCopy.settings.patientFields;
const errors = staffCopy.settings.settingsErrors;

const builtin = (key: string, label: string, over: Partial<BuiltinField> = {}): BuiltinField => ({
  key,
  label,
  section: 'PERSONAL',
  dataType: 'TEXT',
  isEnabled: true,
  isRequired: false,
  canDisable: true,
  alwaysRequired: false,
  sortOrder: 0,
  ...over,
});
const text = (over: Partial<CustomField> = {}): CustomField => ({
  id: 'f-blood',
  code: 'cf_blood',
  label: 'Blood group',
  section: 'PERSONAL',
  dataType: 'TEXT',
  isEnabled: true,
  isRequired: false,
  sortOrder: 20,
  options: [],
  ...over,
});
const dropdown = (over: Partial<CustomField> = {}): CustomField => ({
  ...text(),
  id: 'f-diet',
  code: 'cf_diet',
  label: 'Diet',
  section: 'OTHER',
  dataType: 'DROPDOWN',
  options: [
    { id: 'o1', label: 'Vegetarian', sortOrder: 0, isActive: true },
    { id: 'o2', label: 'Other', sortOrder: 1, isActive: false },
  ],
  ...over,
});
const data = (over: Partial<PatientFieldsResponse> = {}): PatientFieldsResponse => ({
  builtin: [
    builtin('name', 'Full name', { alwaysRequired: true, canDisable: false, isRequired: true }),
    builtin('gender', 'Gender'),
    builtin('phone', 'Phone', { canDisable: false, section: 'CONTACT' }),
    builtin('email', 'Email', { section: 'CONTACT' }),
  ],
  custom: [text(), dropdown()],
  limits: { maxCustomFields: 30, labelMax: 60, maxOptions: 50 },
  ...over,
});

const renderFields = (initial: PatientFieldsResponse | null = data(), canWrite = true) =>
  render(<RegistrationFields initial={initial} initialErrorCode={null} canWrite={canWrite} />);
const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const show = (label: string) => box(`${label}: ${copy.columnShow}`);
const required = (label: string) => box(`${label}: ${copy.columnRequired}`);
const status = () =>
  screen
    .queryAllByRole('status')
    .map((e) => e.textContent)
    .find(Boolean);

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('standard fields', () => {
  it('lists every standard field with its switches; locked fields cannot be changed', () => {
    renderFields();
    expect(show('Full name').disabled).toBe(true);
    expect(required('Full name').disabled).toBe(true);
    expect(required('Full name').checked).toBe(true);
    expect(screen.getByText(copy.alwaysOn, { exact: false })).toBeTruthy();
    // a field that cannot be switched off can still be made optional or required where the API allows
    expect(show('Phone').disabled).toBe(true);
    expect(required('Phone').disabled).toBe(false);
    expect(show('Gender').disabled).toBe(false);
    expect(required('Gender').disabled).toBe(false);
  });

  it('making a field required saves it and shows the answer of the API', async () => {
    mocks.saveBuiltinField.mockResolvedValue({
      ok: true,
      data: builtin('gender', 'Gender', { isRequired: true }),
    });
    renderFields();
    fireEvent.click(required('Gender'));
    await waitFor(() => expect(status()).toBe(copy.saved));
    expect(mocks.saveBuiltinField).toHaveBeenCalledWith('gender', { isRequired: true });
    expect(required('Gender').checked).toBe(true);
  });

  it('switching a field off follows the answer: it can no longer be required', async () => {
    mocks.saveBuiltinField.mockResolvedValue({
      ok: true,
      data: builtin('email', 'Email', { isEnabled: false, isRequired: false, section: 'CONTACT' }),
    });
    renderFields(
      data({
        builtin: [builtin('email', 'Email', { isRequired: true, section: 'CONTACT' })],
      }),
    );
    fireEvent.click(show('Email'));
    await waitFor(() => expect(show('Email').checked).toBe(false));
    expect(mocks.saveBuiltinField).toHaveBeenCalledWith('email', { isEnabled: false });
    expect(required('Email').checked).toBe(false);
    expect(required('Email').disabled).toBe(true);
  });

  it('a refusal shows its reason and the switch stays as it was', async () => {
    mocks.saveBuiltinField.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'isEnabled',
      reason: 'LOCKED',
    });
    renderFields();
    fireEvent.click(show('Gender'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.isEnabled} ${errors.reasons.LOCKED}`,
    );
    expect(show('Gender').checked).toBe(true);
    expect(status()).toBeUndefined();
  });

  it('one change at a time: the switches wait while a change is being saved', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.saveBuiltinField.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderFields();
    fireEvent.click(required('Gender'));
    expect(required('Gender').disabled).toBe(true);
    expect(show('Gender').disabled).toBe(true);
    fireEvent.click(required('Gender'));
    expect(mocks.saveBuiltinField).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: builtin('gender', 'Gender', { isRequired: true }) });
    await waitFor(() => expect(required('Gender').disabled).toBe(false));
  });

  it('forbidden shows the usual message', async () => {
    mocks.saveBuiltinField.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
    renderFields();
    fireEvent.click(required('Gender'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden),
    );
  });
});

describe('the hospital own fields', () => {
  it('shows them with type, section and switches, and a hidden one is marked', () => {
    renderFields(data({ custom: [text(), dropdown({ isEnabled: false })] }));
    expect(screen.getByText('Blood group')).toBeTruthy();
    expect(screen.getByText(copy.hiddenTag, { exact: false })).toBeTruthy();
    expect(required('Diet').disabled).toBe(true);
  });

  it('says so when there are none', () => {
    renderFields(data({ custom: [] }));
    expect(screen.getByText(copy.customEmpty)).toBeTruthy();
  });

  it('switching on, off and required are saved through the API', async () => {
    mocks.updateCustomField.mockResolvedValue({ ok: true, data: text({ isRequired: true }) });
    renderFields();
    fireEvent.click(required('Blood group'));
    await waitFor(() => expect(required('Blood group').checked).toBe(true));
    expect(mocks.updateCustomField).toHaveBeenCalledWith('f-blood', { isRequired: true });
    mocks.updateCustomField.mockResolvedValue({
      ok: true,
      data: text({ isEnabled: false, isRequired: false }),
    });
    fireEvent.click(show('Blood group'));
    await waitFor(() => expect(show('Blood group').checked).toBe(false));
    expect(mocks.updateCustomField).toHaveBeenLastCalledWith('f-blood', { isEnabled: false });
  });

  it('Edit opens a panel to rename and move the field; the type is shown as fixed', async () => {
    mocks.updateCustomField.mockResolvedValue({
      ok: true,
      data: text({ label: 'Blood type', section: 'CONTACT' }),
    });
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: `Blood group: ${copy.edit}` }));
    expect(screen.getByText(copy.typeFixed)).toBeTruthy();
    const panel = screen.getByText(copy.typeFixed).closest('.settings-panel') as HTMLElement;
    fireEvent.change(within(panel).getByLabelText(copy.labelLabel), {
      target: { value: 'Blood type' },
    });
    fireEvent.change(within(panel).getByLabelText(copy.sectionLabel), {
      target: { value: 'CONTACT' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: copy.renameSave }));
    await waitFor(() => expect(screen.getByText('Blood type')).toBeTruthy());
    expect(mocks.updateCustomField).toHaveBeenCalledWith('f-blood', {
      label: 'Blood type',
      section: 'CONTACT',
    });
    // a text field has no list of choices
    expect(within(panel).queryByText(copy.choicesHeading)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Blood type: ${copy.done}` }));
    expect(screen.queryByText(copy.typeFixed)).toBeNull();
  });

  it('a dropdown has an editor for its choices: rename, hide, add, move, save', async () => {
    mocks.saveCustomOptions.mockResolvedValue({ ok: true, data: dropdown() });
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: `Diet: ${copy.edit}` }));
    const panel = screen.getByText(copy.choicesHeading).closest('.settings-panel') as HTMLElement;
    const choice = (n: number) =>
      within(panel).getByLabelText(copy.choiceAria.replace('{n}', String(n)));
    expect((choice(1) as HTMLInputElement).value).toBe('Vegetarian');
    expect(
      (
        within(panel).getByLabelText(
          `${copy.choiceAria.replace('{n}', '2')}: ${copy.choiceShow}`,
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.change(choice(1), { target: { value: 'Vegetarian (pure)' } });
    fireEvent.click(
      within(panel).getByLabelText(`${copy.choiceAria.replace('{n}', '2')}: ${copy.choiceShow}`),
    );
    fireEvent.click(within(panel).getByRole('button', { name: copy.addChoice }));
    fireEvent.change(choice(3), { target: { value: 'Jain' } });
    fireEvent.click(within(panel).getAllByRole('button', { name: copy.moveUp })[2]!);
    fireEvent.click(within(panel).getByRole('button', { name: copy.saveChoices }));
    await waitFor(() => expect(mocks.saveCustomOptions).toHaveBeenCalled());
    expect(mocks.saveCustomOptions).toHaveBeenCalledWith('f-diet', [
      { id: 'o1', label: 'Vegetarian (pure)', isActive: true },
      { label: 'Jain', isActive: true },
      { id: 'o2', label: 'Other', isActive: true },
    ]);
  });

  it('the ends of the list of choices cannot be moved further', () => {
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: `Diet: ${copy.edit}` }));
    const panel = screen.getByText(copy.choicesHeading).closest('.settings-panel') as HTMLElement;
    expect(
      (within(panel).getAllByRole('button', { name: copy.moveUp })[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(panel).getAllByRole('button', { name: copy.moveDown })[1] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('a refused list of choices shows the reason and names the choice', async () => {
    mocks.saveCustomOptions.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'options.0.label',
      reason: 'REQUIRED',
    });
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: `Diet: ${copy.edit}` }));
    const panel = screen.getByText(copy.choicesHeading).closest('.settings-panel') as HTMLElement;
    fireEvent.change(within(panel).getByLabelText(copy.choiceAria.replace('{n}', '1')), {
      target: { value: '' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: copy.saveChoices }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.label} (choice 1) ${errors.reasons.REQUIRED}`,
    );
  });
});

describe('adding a field', () => {
  const openAdd = () => fireEvent.click(screen.getByRole('button', { name: copy.addButton }));
  const addForm = () => screen.getByText(copy.addHeading).closest('form') as HTMLElement;

  it('adds a text field with the chosen name, section and required switch, and clears the form', async () => {
    mocks.createCustomField.mockResolvedValue({
      ok: true,
      data: text({ id: 'f-new', code: 'cf_allergies', label: 'Allergies', section: 'OTHER' }),
    });
    renderFields();
    expect(screen.queryByText(copy.addHeading)).toBeNull();
    openAdd();
    const form = within(addForm());
    fireEvent.change(form.getByLabelText(copy.labelLabel), { target: { value: 'Allergies' } });
    fireEvent.click(form.getByLabelText(copy.requiredLabel));
    fireEvent.click(form.getByRole('button', { name: copy.add }));
    await waitFor(() => expect(screen.getByText('Allergies')).toBeTruthy());
    expect(mocks.createCustomField).toHaveBeenCalledWith({
      label: 'Allergies',
      dataType: 'TEXT',
      section: 'OTHER',
      isRequired: true,
    });
    // the form closes after a successful add
    expect(screen.queryByText(copy.addHeading)).toBeNull();
    expect(status()).toBe(copy.saved);
  });

  it('a dropdown takes one choice per line; blank lines and spaces are dropped', async () => {
    mocks.createCustomField.mockResolvedValue({
      ok: true,
      data: dropdown({ id: 'f-2', label: 'Insurance' }),
    });
    renderFields();
    openAdd();
    const form = within(addForm());
    expect(form.queryByLabelText(copy.choicesLabel)).toBeNull();
    fireEvent.change(form.getByLabelText(copy.typeLabel), { target: { value: 'DROPDOWN' } });
    fireEvent.change(form.getByLabelText(copy.labelLabel), { target: { value: 'Insurance' } });
    fireEvent.change(form.getByLabelText(copy.choicesLabel), {
      target: { value: ' Yes \n\n   \nNo\n' },
    });
    fireEvent.click(form.getByRole('button', { name: copy.add }));
    await waitFor(() => expect(mocks.createCustomField).toHaveBeenCalled());
    expect(mocks.createCustomField).toHaveBeenCalledWith({
      label: 'Insurance',
      dataType: 'DROPDOWN',
      section: 'OTHER',
      isRequired: false,
      options: ['Yes', 'No'],
    });
  });

  it('a refusal keeps what was typed and shows the reason', async () => {
    mocks.createCustomField.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'label',
      reason: 'DUPLICATE',
    });
    renderFields();
    openAdd();
    const form = within(addForm());
    fireEvent.change(form.getByLabelText(copy.labelLabel), { target: { value: 'Diet' } });
    fireEvent.click(form.getByRole('button', { name: copy.add }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.label} ${errors.reasons.DUPLICATE}`,
    );
    expect((form.getByLabelText(copy.labelLabel) as HTMLInputElement).value).toBe('Diet');
  });

  it('at the limit the form is replaced by a note', () => {
    renderFields(data({ limits: { maxCustomFields: 2, labelMax: 60, maxOptions: 50 } }));
    expect(screen.queryByRole('button', { name: copy.addButton })).toBeNull();
    expect(screen.getByText(copy.limitReached.replace('{max}', '2'))).toBeTruthy();
  });
});

describe('the look of the screen', () => {
  it('both tables have the same header, so the two checkbox columns line up', () => {
    renderFields();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    // two tables, each: field, ask on form, must be filled, (empty action column)
    expect(heads.filter((t) => t === copy.columnShow)).toHaveLength(2);
    expect(heads.filter((t) => t === copy.columnRequired)).toHaveLength(2);
    expect(screen.getAllByRole('row').every((r) => r.className.includes('settings-row'))).toBe(
      true,
    );
  });

  it('shows the section and type of an own field under its name, not in extra columns', () => {
    renderFields();
    const row = screen.getByText('Diet').closest('[role="row"]') as HTMLElement;
    expect(row.textContent).toContain(`${copy.sections.OTHER} · ${copy.types.DROPDOWN}`);
  });

  it('a field that is not asked cannot be made compulsory, and says why', () => {
    renderFields(data({ custom: [dropdown({ isEnabled: false })] }));
    const cell = required('Diet').closest('label') as HTMLElement;
    expect(required('Diet').disabled).toBe(true);
    expect(cell.getAttribute('title')).toBe(copy.requiredOffHint);
  });

  it('the add form opens from a button and Cancel closes it without sending anything', () => {
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: copy.addButton }));
    expect(screen.getByText(copy.addHeading)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
    expect(screen.queryByText(copy.addHeading)).toBeNull();
    expect(mocks.createCustomField).not.toHaveBeenCalled();
  });

  describe('the confirmation fades by itself, an error does not', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('Saved. disappears after a few seconds', async () => {
      mocks.saveBuiltinField.mockResolvedValue({
        ok: true,
        data: builtin('gender', 'Gender', { isRequired: true }),
      });
      renderFields();
      fireEvent.click(required('Gender'));
      await act(async () => {});
      expect(status()).toBe(copy.saved);
      act(() => {
        jest.advanceTimersByTime(settingsScreenConfig.savedMessageMs + 10);
      });
      expect(status()).toBeUndefined();
    });

    it('an error stays until the next action', async () => {
      mocks.saveBuiltinField.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
      renderFields();
      fireEvent.click(required('Gender'));
      await act(async () => {});
      act(() => {
        jest.advanceTimersByTime(settingsScreenConfig.savedMessageMs * 5);
      });
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    });
  });
});

describe('load failure and permission', () => {
  it('shows the usual message when the fields could not be read', () => {
    render(<RegistrationFields initial={null} initialErrorCode="FORBIDDEN" canWrite />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
  });

  it('without the write permission everything is for looking only', () => {
    renderFields(data(), false);
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('button', { name: copy.add })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(copy.edit) })).toBeNull();
  });
});

describe('the ready-made reference fields', () => {
  const referred = text({
    id: 'f-ref',
    code: 'cf_referred_by',
    label: 'Referred by',
    section: 'OTHER',
  });

  it('one click adds them, reads the form again and says what was added', async () => {
    mocks.addReferenceSet.mockResolvedValue({
      ok: true,
      data: { created: ['Referred by', 'Category'], kept: ['Organisation'], skipped: [] },
    });
    mocks.loadPatientFields.mockResolvedValue({
      ok: true,
      data: data({ custom: [text(), dropdown(), referred] }),
    });
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: copy.referenceButton }));
    await waitFor(() => expect(mocks.addReferenceSet).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Referred by')).toBeTruthy();
    expect(status()).toBe(copy.referenceAdded.replace('{names}', 'Referred by, Category'));
  });

  it('says so when nothing was new, and which fields were left out because of the limit', async () => {
    mocks.addReferenceSet.mockResolvedValue({
      ok: true,
      data: { created: [], kept: ['Referred by'], skipped: ['Category', 'Staff number'] },
    });
    mocks.loadPatientFields.mockResolvedValue({ ok: true, data: data() });
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: copy.referenceButton }));
    await waitFor(() => expect(status()).toContain(copy.referenceNothingNew));
    expect(status()).toContain(copy.referenceSkipped.replace('{names}', 'Category, Staff number'));
  });

  it('a refusal shows its reason and changes nothing; the button waits while it works', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.addReferenceSet.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderFields();
    const button = screen.getByRole('button', { name: copy.referenceButton }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.addReferenceSet).toHaveBeenCalledTimes(1);
    finish({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toBeTruthy();
    expect(mocks.loadPatientFields).not.toHaveBeenCalled();
  });

  it('is not offered to a person who may only look', () => {
    renderFields(data(), false);
    expect(screen.queryByRole('button', { name: copy.referenceButton })).toBeNull();
  });
});
