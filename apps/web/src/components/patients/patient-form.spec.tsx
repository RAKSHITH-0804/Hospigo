import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PatientForm } from '@/components/patients/patient-form';
import { staffCopy } from '@/config/staff-copy';
import { buildPatientBody, emptyValues, valuesFromDetail } from '@/lib/patients/payload';
import type { FormConfigField, PatientDetail } from '@/lib/patients/types';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('next/link', () => {
  return function Link({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const form = staffCopy.patients.form;
const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const standard = (
  key: string,
  label: string,
  required = false,
  sortOrder = 0,
  section = 'PERSONAL',
): FormConfigField => ({
  key,
  label,
  dataType: key === 'date_of_birth' ? 'DATE' : 'TEXT',
  required,
  sortOrder,
  section,
});

const config: { fields: FormConfigField[] } = {
  fields: [
    standard('name', 'Full name', true, 0, 'PERSONAL'),
    standard('gender', 'Gender', false, 1, 'PERSONAL'),
    standard('date_of_birth', 'Date of birth', true, 2, 'PERSONAL'),
    standard('phone', 'Phone', true, 3, 'CONTACT'),
    standard('email', 'Email', false, 4, 'CONTACT'),
    standard('address_street', 'Street', false, 5, 'ADDRESS'),
    standard('address_cross', 'Cross', false, 6, 'ADDRESS'),
    standard('address_area', 'Area', false, 7, 'ADDRESS'),
    standard('address_city', 'City', false, 8, 'ADDRESS'),
    standard('address_state', 'State', false, 9, 'ADDRESS'),
    standard('address_pincode', 'PIN code', false, 10, 'ADDRESS'),
    {
      code: 'title',
      label: 'Title',
      dataType: 'DROPDOWN',
      required: false,
      sortOrder: 100,
      section: 'RELATIVE',
      options: [
        { id: 'opt-mr', label: 'Mr', sortOrder: 0 },
        { id: 'opt-ms', label: 'Ms', sortOrder: 1 },
      ],
    },
    {
      code: 'notes',
      label: 'Notes',
      dataType: 'TEXT',
      required: false,
      sortOrder: 101,
      section: 'OTHER',
    },
    {
      code: 'score',
      label: 'Score',
      dataType: 'NUMBER',
      required: false,
      sortOrder: 102,
      section: 'OTHER',
    },
    {
      code: 'since',
      label: 'Since',
      dataType: 'DATE',
      required: false,
      sortOrder: 103,
      section: 'OTHER',
    },
    {
      code: 'agree',
      label: 'Agreed',
      dataType: 'CHECKBOX',
      required: false,
      sortOrder: 104,
      section: 'OTHER',
    },
  ],
};

const detail: PatientDetail = {
  id: 'p1',
  uhid: 'NREG0001',
  name: 'Mock Alpha',
  gender: 'F',
  dateOfBirth: '1990-01-15T00:00:00.000Z',
  ageYears: 36,
  dobIsEstimated: false,
  phone: '+919876543210',
  email: 'alpha@example.test',
  addressStreet: null,
  addressCross: null,
  addressArea: null,
  addressCity: 'Mockville',
  addressState: null,
  addressPincode: null,
  registeredBranchId: 'b1',
  isActive: true,
  customFieldValues: [{ code: 'title', optionId: 'opt-ms', optionLabel: 'Ms' }],
};

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
}

/** Picks a birth date in the calendar: month, year, then the day. */
function pickDob(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  fireEvent.click(screen.getByRole('button', { name: form.dobPick }));
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: String(m! - 1) } });
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: String(y) } });
  const day = screen
    .getAllByRole('button')
    .find((b) => (b.getAttribute('aria-label') ?? '').endsWith(`${d} ${MONTHS[m! - 1]} ${y}`));
  fireEvent.click(day!);
}
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

type Handler = (init?: RequestInit) => ReturnType<typeof jsonResponse>;

function mockRoutes(routes: Record<string, Handler>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).split('?')[0];
    const handler = routes[`${method} ${path}`] ?? routes[`${method} ${url}`];
    if (!handler) {
      throw new Error(`unexpected fetch ${method} ${url}`);
    }
    return handler(init);
  });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

function postCalls() {
  return fetchMock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
  );
}

function chooseDobMode() {
  fireEvent.click(screen.getByRole('button', { name: form.dobModeDob }));
}

function fillRequired() {
  type(form.name, 'Mock Alpha');
  chooseDobMode();
  pickDob('1990-01-15');
  type(form.phone, '9876543210');
}

describe('PatientForm (register)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  async function renderRegister(routes: Record<string, Handler> = {}) {
    mockRoutes({
      'GET /api/staff/patients/form-config': () => jsonResponse(config),
      ...routes,
    });
    render(<PatientForm mode="register" title="Register patient" backHref="/app/patients" />);
    await screen.findByLabelText(/^Full name/);
  }

  it('builds sections from form-config; RELATIVE starts collapsed', async () => {
    await renderRegister();
    expect(screen.getByText(form.sectionPersonal)).toBeTruthy();
    expect(screen.getByText(form.sectionContact)).toBeTruthy();
    expect(screen.getByRole('button', { name: form.relativeToggleShow })).toBeTruthy();
    expect(screen.queryByLabelText(/^Title/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: form.relativeToggleShow }));
    expect(field('Title')).toBeTruthy();
  });

  it('renders required asterisks from form-config and +91 phone prefix', async () => {
    await renderRegister();
    expect(screen.getByLabelText(/^Full name/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(form.phonePrefixAria).textContent).toBe('+91');
    expect(field(form.phone).getAttribute('maxLength')).toBe('10');
    expect(field(form.phone).getAttribute('inputMode')).toBe('numeric');
  });

  it('strips non-digits from phone and pincode including paste', async () => {
    await renderRegister();
    type(form.phone, '98a76-5432x10extra');
    expect(field(form.phone).value).toBe('9876543210');
    type(form.addressPincode, '56ab0001');
    expect(field(form.addressPincode).value).toBe('560001');
  });

  it('marks all invalid fields at once with a summary count and does not post', async () => {
    await renderRegister();
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    expect(screen.getByText(/fields need attention/)).toBeTruthy();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(1);
    expect(postCalls()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(field(form.name)));
  });

  it('opens RELATIVE when a relative field has a value', async () => {
    await renderRegister();
    fireEvent.click(screen.getByRole('button', { name: form.relativeToggleShow }));
    fireEvent.change(field('Title'), { target: { value: 'opt-mr' } });
    fireEvent.click(screen.getByRole('button', { name: form.relativeToggleHide }));
    expect(screen.getByLabelText(/^Title/)).toBeTruthy();
  });

  it('posts date of birth only, addresses and custom values, then opens the record', async () => {
    await renderRegister({
      'POST /api/staff/patients': () => jsonResponse({ id: 'new1', uhid: 'NREG0009' }),
    });
    type(form.name, '  Mock Gamma ');
    fireEvent.change(field(form.gender), { target: { value: 'F' } });
    chooseDobMode();
    pickDob('1990-01-15');
    type(form.phone, '9876543210');
    type(form.addressStreet, '1 Test Street');
    type(form.addressCross, '2nd Cross');
    type(form.addressArea, 'Mock Area');
    type(form.addressCity, 'Mockville');
    type(form.addressState, 'Mockstate');
    type(form.addressPincode, '560001');
    fireEvent.click(screen.getByRole('button', { name: form.relativeToggleShow }));
    fireEvent.change(field('Title'), { target: { value: 'opt-mr' } });
    type('Score', '7');
    type('Notes', 'Walk-in');
    type('Since', '2020-02-02');
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/patients/new1'));
    const call = postCalls()[0] as unknown[];
    expect(call[0]).toBe('/api/staff/patients');
    const body = bodyOf(call);
    expect(body).toEqual({
      name: 'Mock Gamma',
      gender: 'F',
      dateOfBirth: '1990-01-15',
      phone: '9876543210',
      addressStreet: '1 Test Street',
      addressCross: '2nd Cross',
      addressArea: 'Mock Area',
      addressCity: 'Mockville',
      addressState: 'Mockstate',
      addressPincode: '560001',
      customFieldValues: [
        { code: 'title', optionId: 'opt-mr' },
        { code: 'notes', valueText: 'Walk-in' },
        { code: 'score', valueNumber: 7 },
        { code: 'since', valueDate: '2020-02-02' },
      ],
    });
    expect('ageYears' in body).toBe(false);
  });

  it('sends age only when age mode is chosen', async () => {
    await renderRegister({
      'POST /api/staff/patients': () => jsonResponse({ id: 'new2', uhid: 'NREG0010' }),
    });
    // Age is the default: one box, and no sentences about estimating
    expect(screen.getByRole('button', { name: form.dobModeAge }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByText(/estimated from this age/)).toBeNull();
    expect(screen.queryByLabelText(new RegExp(`^${form.dateOfBirth}$`))).toBeNull();
    type(form.name, 'Mock Delta');
    type(form.phone, '9876543210');
    type(form.ageYears, '42');
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = bodyOf(postCalls()[0] as unknown[]);
    expect(body.ageYears).toBe(42);
    expect('dateOfBirth' in body).toBe(false);
  });

  it('age entry is one number, in years only', async () => {
    await renderRegister({
      'POST /api/staff/patients': () => jsonResponse({ id: 'new3', uhid: 'NREG0011' }),
    });
    fireEvent.click(screen.getByRole('button', { name: form.dobModeAge }));
    expect(screen.queryByLabelText(form.ageMonths)).toBeNull();
    expect(screen.queryByLabelText(form.ageDays)).toBeNull();
    type(form.name, 'Child Test');
    type(form.phone, '9876543210');
    type(form.ageYears, '7');
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = bodyOf(postCalls()[0] as unknown[]);
    expect(body.ageYears).toBe(7);
    expect('ageMonths' in body).toBe(false);
    expect('dateOfBirth' in body).toBe(false);
  });

  it('maps API fieldErrors for built-in, custom.<code> and ageYears', async () => {
    await renderRegister({
      'POST /api/staff/patients': () =>
        jsonResponse(
          {
            code: 'UNKNOWN',
            fieldErrors: {
              phone: 'INVALID',
              'custom.title': 'REQUIRED',
              ageYears: 'AGE_AND_DOB_BOTH',
            },
          },
          400,
        ),
    });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    expect(await screen.findByText(form.fieldErrorInvalid)).toBeTruthy();
    expect(screen.getByText(form.fieldErrorAgeAndDobBoth)).toBeTruthy();
    expect(await screen.findByLabelText(/^Title/)).toBeTruthy();
    expect(screen.getByText(form.fieldErrorRequired)).toBeTruthy();
  });

  it('shows an inline duplicate panel and re-posts with confirmDuplicate', async () => {
    let attempt = 0;
    await renderRegister({
      'POST /api/staff/patients': () => {
        attempt += 1;
        return attempt === 1
          ? jsonResponse(
              {
                code: 'POSSIBLE_DUPLICATE',
                matches: [{ id: 'p1', uhid: 'NREG0001', name: 'Mock Alpha' }],
              },
              409,
            )
          : jsonResponse({ id: 'new3', uhid: 'NREG0011' });
      },
    });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));

    expect(await screen.findByText(staffCopy.patients.duplicate.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'NREG0001' }).getAttribute('href')).toBe(
      '/app/patients/p1',
    );
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: staffCopy.patients.duplicate.registerAnyway }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/patients/new3'));
    expect(bodyOf(postCalls()[1] as unknown[]).confirmDuplicate).toBe(true);
  });

  it('dismisses the duplicate panel on cancel', async () => {
    await renderRegister({
      'POST /api/staff/patients': () =>
        jsonResponse(
          {
            code: 'POSSIBLE_DUPLICATE',
            matches: [{ id: 'p1', uhid: 'NREG0001', name: 'Mock Alpha' }],
          },
          409,
        ),
    });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    await screen.findByText(staffCopy.patients.duplicate.title);
    fireEvent.click(screen.getByRole('button', { name: staffCopy.patients.duplicate.cancel }));
    expect(screen.queryByText(staffCopy.patients.duplicate.title)).toBeNull();
  });

  it('guards double submit while a request is in flight', async () => {
    let resolvePost: ((value: ReturnType<typeof jsonResponse>) => void) | undefined;
    await renderRegister({
      'POST /api/staff/patients': () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }) as unknown as ReturnType<typeof jsonResponse>,
    });
    fillRequired();
    const button = screen.getByRole('button', { name: form.submitRegister });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(postCalls().length).toBe(1));
    resolvePost?.(jsonResponse({ id: 'new4', uhid: 'NREG0012' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('on failed silent refresh keeps values and shows sign-in link', async () => {
    await renderRegister({
      'POST /api/staff/patients': () => jsonResponse({ code: 'SESSION_EXPIRED' }, 401),
      'POST /api/auth/refresh-session': () => jsonResponse({ ok: false }, 401),
    });
    fillRequired();
    type(form.name, 'Keep Me');
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    expect(await screen.findByText(form.sessionExpiredTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: form.signInAgain }).getAttribute('target')).toBe(
      '_blank',
    );
    expect(field(form.name).value).toBe('Keep Me');
  });

  it('maps other submit failures to copy in an alert', async () => {
    await renderRegister({
      'POST /api/staff/patients': () => jsonResponse({ code: 'FORBIDDEN' }, 403),
    });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: form.submitRegister }));
    expect(await screen.findByText(staffCopy.errors.forbidden)).toBeTruthy();
  });

  it('shows a load error when form-config cannot be fetched', async () => {
    mockRoutes({
      'GET /api/staff/patients/form-config': () => jsonResponse({ code: 'FORBIDDEN' }, 403),
    });
    render(<PatientForm mode="register" title="Register patient" backHref="/app/patients" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(staffCopy.errors.forbidden);
  });

  it('defaults to Age (date of birth is the second option) and keeps Register in the page header form submit', async () => {
    await renderRegister();
    expect(screen.getByRole('button', { name: form.dobModeAge }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: form.dobModeDob }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    const register = screen.getByRole('button', { name: form.submitRegister });
    expect(register.getAttribute('form')).toBe('patient-form');
    expect(document.getElementById('patient-form')).toBeTruthy();
  });

  it('shows select placeholders for gender and custom dropdowns', async () => {
    await renderRegister();
    fireEvent.click(screen.getByRole('button', { name: form.relativeToggleShow }));
    expect(screen.getByRole('option', { name: form.genderPlaceholder })).toBeTruthy();
    expect(screen.getByRole('option', { name: form.selectPlaceholder })).toBeTruthy();
  });

  it('applies config grid spans on form cells', async () => {
    await renderRegister();
    const nameCell = field(form.name).closest('.patient-form-cell');
    expect(nameCell?.getAttribute('data-span')).toBe('4');
    const genderCell = field(form.gender).closest('.patient-form-cell');
    expect(genderCell?.getAttribute('data-span')).toBe('2');
  });
});

describe('PatientForm (edit)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  async function renderEdit(routes: Record<string, Handler> = {}) {
    mockRoutes({
      'GET /api/staff/patients/form-config': () => jsonResponse(config),
      'GET /api/staff/patients/p1': () => jsonResponse(detail),
      ...routes,
    });
    render(
      <PatientForm mode="edit" patientId="p1" title="Edit patient" backHref="/app/patients/p1" />,
    );
    await screen.findByLabelText(form.uhidReadOnly);
  }

  it('prefills national phone digits, UHID read-only, patches only changed fields', async () => {
    await renderEdit({ 'PATCH /api/staff/patients/p1': () => jsonResponse({ id: 'p1' }) });
    const uhid = screen.getByLabelText(form.uhidReadOnly) as HTMLInputElement;
    expect(uhid.value).toBe('NREG0001');
    expect(uhid.readOnly).toBe(true);
    expect(field(form.name).value).toBe('Mock Alpha');
    expect(field(form.phone).value).toBe('9876543210');
    expect(screen.getByRole('button', { name: form.dobPick }).textContent).toContain('1990');

    type(form.name, 'Mock Alpha Updated');
    fireEvent.click(screen.getByRole('button', { name: form.submitSave }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/patients/p1'));
    const patch = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    ) as unknown[];
    expect(bodyOf(patch)).toEqual({ name: 'Mock Alpha Updated' });
  });

  it('skips the request when nothing changed', async () => {
    await renderEdit();
    fireEvent.click(screen.getByRole('button', { name: form.submitSave }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/patients/p1'));
    expect(
      fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('shows the not-found state for an unknown patient', async () => {
    mockRoutes({
      'GET /api/staff/patients/form-config': () => jsonResponse(config),
      'GET /api/staff/patients/p1': () => jsonResponse({ code: 'UNKNOWN' }, 404),
    });
    render(
      <PatientForm mode="edit" patientId="p1" title="Edit patient" backHref="/app/patients/p1" />,
    );
    expect(await screen.findByText(staffCopy.patients.record.notFoundTitle)).toBeTruthy();
  });
});

describe('buildPatientBody', () => {
  const customFields = config.fields.filter((f) => f.code);

  it('never sends age and date of birth together', () => {
    const values = {
      ...emptyValues(),
      name: 'A',
      dobMode: 'age' as const,
      ageYears: '30',
      dateOfBirth: '1990-01-01',
    };
    const body = buildPatientBody(values, customFields);
    expect(body.ageYears).toBe(30);
    expect(body.dateOfBirth).toBeUndefined();
  });

  it('keeps estimated-age patients in age mode and omits unchanged values on edit', () => {
    const initial = valuesFromDetail({ ...detail, dobIsEstimated: true, ageYears: 40 });
    expect(initial.dobMode).toBe('age');
    expect(initial.ageYears).toBe('40');
    expect(buildPatientBody(initial, customFields, initial)).toEqual({});
  });
});

describe('PatientForm server boot data and visual rules', () => {
  it('renders from boot data without any client fetch (register)', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(
      <PatientForm
        mode="register"
        title="Register patient"
        backHref="/app/patients"
        boot={{ fields: config.fields }}
      />,
    );
    expect(screen.getByLabelText(/^Full name/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefills edit from boot data and shows not-found / error failures', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { unmount } = render(
      <PatientForm
        mode="edit"
        patientId="p1"
        title="Edit patient"
        backHref="/app/patients/p1"
        boot={{ fields: config.fields, detail }}
      />,
    );
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe('Mock Alpha');
    unmount();
    const missing = render(
      <PatientForm
        mode="edit"
        patientId="p1"
        title="Edit patient"
        backHref="/app/patients/p1"
        boot={{ failure: 'notFound' }}
      />,
    );
    expect(screen.getByText(staffCopy.patients.record.notFoundTitle)).toBeTruthy();
    missing.unmount();
    render(
      <PatientForm
        mode="register"
        title="Register patient"
        backHref="/app/patients"
        boot={{ failure: { code: 'FORBIDDEN' } }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the age input has the control radius on its free corner', () => {
    render(
      <PatientForm
        mode="register"
        title="Register patient"
        backHref="/app/patients"
        boot={{ fields: config.fields }}
      />,
    );
    // one rounded box (Age is the default entry)
    expect(screen.getByLabelText(form.ageYears).className).toContain(
      'rounded-[var(--radius-control)]',
    );
  });
});
