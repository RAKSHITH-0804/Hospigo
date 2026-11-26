import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import PatientSlipPage from '@/app/app/patients/[id]/slip/page';
import VisitReceiptPage from '@/app/app/opd/visits/[id]/receipt/page';
import PrescriptionPrintPage from '@/app/app/opd/visits/[id]/prescription/page';
import PatientReportPrintPage from '@/app/app/opd/visits/[id]/report/page';
import PatientCardPage from '@/app/app/patients/[id]/card/page';
import SettingsSectionPage from '@/app/app/settings/[section]/page';
import { staffCopy } from '@/config/staff-copy';
import { makeTemplate, withBoxes, withFields } from '@/lib/print/print-test-fixtures';

const sessionMock = jest.fn();
const routes = new Map<string, unknown>();

jest.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/app/settings/printing',
}));
jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});
jest.mock('@/lib/patients/server', () => ({
  ...jest.requireActual('@/lib/patients/server'),
  fetchStaffOnServer: async (path: string) =>
    routes.has(path) ? routes.get(path) : { status: 'notFound' },
}));
jest.mock('@/lib/auth/guards', () => ({
  requirePermission: async (code: string) => {
    const session = await sessionMock();
    if (!session.permissions?.includes(code)) {
      throw new Error('REDIRECT:/app?notice=no-permission');
    }
    return session;
  },
  redirectToRefresh: async () => {
    throw new Error('REDIRECT:/api/auth/refresh');
  },
}));
jest.mock('@/components/patients/print-button', () => ({
  PrintButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

const ok = (data: unknown) => ({ status: 'ok', data });
const idParams = { params: Promise.resolve({ id: 'p1' }) };
const session = (permissions: string[]) => ({
  id: 'u1',
  kind: 'HOSPITAL',
  hospitalName: 'Demo Hospital One',
  activeBranchName: 'Main Branch',
  permissions,
});

const visit = {
  id: 'p1',
  status: 'WAITING',
  visitType: 'NEW',
  visitDate: '2026-11-20',
  branch: { id: 'b1', name: 'Main Branch' },
  patient: { id: 'pt1', uhid: 'HSP-0001', name: 'Asha Rao' },
  doctor: { id: 'd1', code: 'DR1', name: 'Dr Meena' },
  token: { date: '2026-11-20', no: 7, label: 'T-007' },
  bill: {
    id: 'b',
    billNumber: '2627/00012',
    billType: 'CONSULTATION',
    billDate: '2026-11-20T04:00:00.000Z',
    subtotalPaise: 60_000,
    taxPaise: 0,
    totalPaise: 60_000,
    paidPaise: 60_000,
    refundedPaise: 0,
    paymentStatus: 'PAID',
    lines: [],
    payments: [],
  },
};

const patient = {
  id: 'p1',
  uhid: 'HSP-0001',
  name: 'Asha Rao',
  gender: null,
  ageYears: 34,
  phone: '9876543210',
};

function completedConsult(status: 'COMPLETED' | 'IN_CONSULTATION' = 'COMPLETED') {
  return {
    visit: {
      id: 'p1',
      status,
      visitDate: '2026-11-20',
      token: null,
      patient: { id: 'pt1', uhid: 'HSP-0001', name: 'Asha Rao', gender: null, ageYears: 34 },
      doctor: { id: 'd1', code: 'DR1', name: 'Dr Meena' },
    },
    doctorDetails: {
      name: 'Dr Meena',
      printedName: 'Dr. M. Rao',
      printName: 'Dr. M. Rao',
      department: 'Medicine',
      qualifications: 'MBBS, MD',
      speciality: 'General Medicine',
      registrationNo: 'KMC/12345',
      fromCompletedCopy: true,
    },
    consultation: {
      status,
      complaints: 'Fever 3 days',
      diagnosis: 'Viral fever',
      advice: 'Rest',
      followUpDate: null,
    },
    prescription: [
      {
        lineNo: 1,
        medicineName: 'Paracetamol 500',
        dose: '1 tab',
        frequency: 'TDS',
        duration: '3 days',
        instructions: null,
      },
    ],
    addenda: [],
  };
}

beforeEach(() => {
  routes.clear();
  sessionMock.mockReset();
});

describe('receipt page with a template', () => {
  const template = withFields(makeTemplate('RECEIPT'), [
    'hospitalName',
    'patientName',
    'billNumber',
    'total',
  ]);

  it('prints through the hospital template: its paper, its fields, its hospital name', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read', 'opd.billing.read']));
    routes.set('/opd/visits/p1', ok(visit));
    routes.set('/print-templates/RECEIPT', ok(template));
    const { container } = render(await VisitReceiptPage(idParams));
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 148mm 210mm; margin: 0; }',
    );
    expect(container.querySelector('.print-sheet')).toBeTruthy();
    expect(screen.getByText('Demo Hospital One')).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('2627/00012')).toBeTruthy();
    expect(screen.queryByText('HSP-0001')).toBeNull(); // uhid is switched off in this template
    expect(screen.getByRole('button', { name: staffCopy.opd.receipt.print })).toBeTruthy();
  });

  it('prints the hospital logo in a logo box, and still prints when the logo cannot be read', async () => {
    const logoTemplate = withBoxes(withFields(makeTemplate('RECEIPT'), ['patientName']), [
      ...withFields(makeTemplate('RECEIPT'), ['patientName']).layout.elements,
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
    ]);
    sessionMock.mockResolvedValue(session(['opd.visits.read', 'opd.billing.read']));
    routes.set('/opd/visits/p1', ok(visit));
    routes.set('/print-templates/RECEIPT', ok(logoTemplate));
    routes.set('/settings/branding', ok({ logo: { id: 'logo-9' }, canWrite: false, limits: {} }));
    const first = render(await VisitReceiptPage(idParams));
    expect(first.container.querySelector('img.print-image')!.getAttribute('src')).toBe(
      '/api/staff/images/logo-9',
    );
    first.unmount();
    routes.set('/settings/branding', { status: 'error', code: 'UNAVAILABLE' });
    const second = render(await VisitReceiptPage(idParams));
    expect(second.container.querySelector('img')).toBeNull();
    expect(screen.getByText('Asha Rao')).toBeTruthy(); // the receipt itself still prints
    second.unmount();
    routes.set('/settings/branding', ok({ logo: null, canWrite: false, limits: {} }));
    const third = render(await VisitReceiptPage(idParams));
    expect(third.container.querySelector('img')).toBeNull();
  });

  it('falls back to the older receipt when the template is switched off', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read', 'opd.billing.read']));
    routes.set('/opd/visits/p1', ok(visit));
    routes.set('/print-templates/RECEIPT', ok({ ...template, enabled: false }));
    const { container } = render(await VisitReceiptPage(idParams));
    expect(container.querySelector('.print-sheet')).toBeNull();
    expect(container.querySelector('.visit-receipt')).toBeTruthy();
    expect(container.querySelector('style')?.textContent).toBe('@page { size: A5; margin: 0; }');
  });

  it('falls back to the older receipt when the template cannot be loaded', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read', 'opd.billing.read']));
    routes.set('/opd/visits/p1', ok(visit));
    routes.set('/print-templates/RECEIPT', { status: 'error', code: 'UNAVAILABLE' });
    const { container } = render(await VisitReceiptPage(idParams));
    expect(container.querySelector('.print-sheet')).toBeNull();
    expect(container.querySelector('.visit-receipt')).toBeTruthy();
  });

  it('still needs the visit permission and shows calm messages', async () => {
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    await expect(VisitReceiptPage(idParams)).rejects.toThrow('REDIRECT:/app?notice=no-permission');
    sessionMock.mockResolvedValue(session(['opd.visits.read']));
    routes.set('/opd/visits/p1', { status: 'notFound' });
    render(await VisitReceiptPage(idParams));
    expect(screen.getByText(staffCopy.opd.receipt.notFoundTitle)).toBeTruthy();
  });
});

describe('registration slip page with a template', () => {
  const template = withFields(makeTemplate('REGISTRATION_SLIP'), [
    'uhid',
    'patientName',
    'branchName',
  ]);

  it('prints through the slip template with the active branch name', async () => {
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    routes.set('/patients/p1', ok(patient));
    routes.set('/print-templates/REGISTRATION_SLIP', ok(template));
    const { container } = render(await PatientSlipPage(idParams));
    expect(container.querySelector('.print-sheet')).toBeTruthy();
    expect(screen.getByText('HSP-0001')).toBeTruthy();
    expect(screen.getByText('Main Branch')).toBeTruthy();
    expect(screen.queryByText('9876543210')).toBeNull(); // phone is off
  });

  it('prints the logo on the registration slip', async () => {
    const base2 = withFields(makeTemplate('REGISTRATION_SLIP'), ['patientName']);
    const t = withBoxes(base2, [
      ...base2.layout.elements,
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
    ]);
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    routes.set('/patients/p1', ok(patient));
    routes.set('/print-templates/REGISTRATION_SLIP', ok(t));
    routes.set('/settings/branding', ok({ logo: { id: 'logo-5' }, canWrite: false, limits: {} }));
    const { container } = render(await PatientSlipPage(idParams));
    expect(container.querySelector('img.print-image')!.getAttribute('src')).toBe(
      '/api/staff/images/logo-5',
    );
  });

  it('falls back to the older slip without a usable template', async () => {
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    routes.set('/patients/p1', ok(patient));
    const { container } = render(await PatientSlipPage(idParams));
    expect(container.querySelector('.print-sheet')).toBeNull();
    expect(container.querySelector('.patient-slip')).toBeTruthy();
  });
});

describe('prescription print page', () => {
  const template = withFields(
    makeTemplate('PRESCRIPTION', { paper: 'A4', pageWidthMm: 210, pageHeightMm: 297 }),
    ['patientName', 'complaints', 'diagnosis', 'medicines'],
  );
  const copy = staffCopy.print.prescription;

  it('needs opd.notes.read', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read']));
    await expect(PrescriptionPrintPage(idParams)).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('prints the slim prescription: the medicines and the patient, nothing of the patient report', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set(
      '/print-templates/PRESCRIPTION',
      ok(
        withFields(
          makeTemplate('PRESCRIPTION', { paper: 'A5', pageWidthMm: 148, pageHeightMm: 210 }),
          ['patientName', 'medicines'],
        ),
      ),
    );
    const { container } = render(await PrescriptionPrintPage(idParams));
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 148mm 210mm; margin: 0; }',
    );
    expect(screen.getByText(/1\. Paracetamol 500/)).toBeTruthy();
    expect(screen.queryByText('Fever 3 days')).toBeNull();
    expect(screen.queryByText('Viral fever')).toBeNull();
    expect(screen.getByRole('button', { name: copy.print })).toBeTruthy();
  });

  it('prints the doctor details of the consultation: printed name, qualifications and registration number', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set(
      '/print-templates/PRESCRIPTION',
      ok(
        withFields(
          makeTemplate('PRESCRIPTION', { paper: 'A4', pageWidthMm: 210, pageHeightMm: 297 }),
          ['doctorName', 'doctorQualifications', 'doctorSpeciality', 'doctorRegistrationNo'],
        ),
      ),
    );
    render(await PrescriptionPrintPage(idParams));
    expect(screen.getByText(/Dr\. M\. Rao/)).toBeTruthy();
    expect(screen.queryByText(/Dr Meena/)).toBeNull(); // the login name is not printed
    expect(screen.getByText(/MBBS, MD/)).toBeTruthy();
    expect(screen.getByText(/General Medicine/)).toBeTruthy();
    expect(screen.getByText(/KMC\/12345/)).toBeTruthy();
  });

  it('prints the logo, and the signature the note was completed with (never a newer one)', async () => {
    const base2 = withFields(
      makeTemplate('PRESCRIPTION', { paper: 'A4', pageWidthMm: 210, pageHeightMm: 297 }),
      ['patientName'],
    );
    const withPictures = withBoxes(base2, [
      ...base2.layout.elements,
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
      {
        id: 'sig',
        type: 'IMAGE',
        slot: 'SIGNATURE',
        xMm: 130,
        yMm: 250,
        widthMm: 50,
        heightMm: 20,
      },
    ]);
    const consult = completedConsult() as { doctorDetails: Record<string, unknown> };
    consult.doctorDetails = { ...consult.doctorDetails, signatureImageId: 'sig-old' };
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(consult));
    routes.set('/print-templates/PRESCRIPTION', ok(withPictures));
    routes.set('/settings/branding', ok({ logo: { id: 'logo-3' }, canWrite: false, limits: {} }));
    const { container } = render(await PrescriptionPrintPage(idParams));
    const srcs = [...container.querySelectorAll('img.print-image')].map((i) =>
      i.getAttribute('src'),
    );
    expect(srcs).toEqual(['/api/staff/images/logo-3', '/api/staff/images/sig-old']);
  });

  it('a note completed before signatures existed prints no signature picture', async () => {
    const base2 = withFields(makeTemplate('PRESCRIPTION'), ['patientName']);
    const withSig = withBoxes(base2, [
      ...base2.layout.elements,
      {
        id: 'sig',
        type: 'IMAGE',
        slot: 'SIGNATURE',
        xMm: 130,
        yMm: 250,
        widthMm: 50,
        heightMm: 20,
      },
    ]);
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set('/print-templates/PRESCRIPTION', ok(withSig));
    routes.delete('/settings/branding');
    const { container } = render(await PrescriptionPrintPage(idParams));
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not print a consultation that is not completed', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult('IN_CONSULTATION')));
    routes.set('/print-templates/PRESCRIPTION', ok(template));
    const { container } = render(await PrescriptionPrintPage(idParams));
    expect(screen.getByText(copy.notReadyTitle)).toBeTruthy();
    expect(container.querySelector('.print-sheet')).toBeNull();
  });

  it('says so when printing prescriptions is switched off, and shows an error without a template', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set('/print-templates/PRESCRIPTION', ok({ ...template, enabled: false }));
    const off = render(await PrescriptionPrintPage(idParams));
    expect(screen.getByText(copy.switchedOffTitle)).toBeTruthy();
    off.unmount();
    routes.set('/print-templates/PRESCRIPTION', { status: 'error', code: 'UNAVAILABLE' });
    render(await PrescriptionPrintPage(idParams));
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });

  it('shows calm messages for a missing visit', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    render(await PrescriptionPrintPage(idParams));
    expect(screen.getByText(copy.notFoundTitle)).toBeTruthy();
  });
});

describe('printing settings section', () => {
  const section = { params: Promise.resolve({ section: 'printing' }) };
  const list = {
    items: [template('REGISTRATION_SLIP'), template('RECEIPT'), template('PRESCRIPTION')],
  };
  const presets = { items: [{ key: 'A4_FULL', name: 'A4, full letterhead', templates: {} }] };

  function template(docType: 'REGISTRATION_SLIP' | 'RECEIPT' | 'PRESCRIPTION') {
    return withFields(makeTemplate(docType), ['patientName']);
  }

  it('needs hospital.settings.read', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read']));
    await expect(SettingsSectionPage(section)).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('shows the screen with the templates and presets from the API; writing needs opd.settings.write', async () => {
    routes.set('/print-templates', ok(list));
    routes.set('/print-templates/presets', ok(presets));
    sessionMock.mockResolvedValue(session(['hospital.settings.read']));
    const view = render(await SettingsSectionPage(section));
    const copy = staffCopy.settings.printing;
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'A4, full letterhead' })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.save }).matches(':disabled')).toBe(true);
    view.unmount();
    sessionMock.mockResolvedValue(session(['hospital.settings.read', 'opd.settings.write']));
    render(await SettingsSectionPage(section));
    expect(screen.queryByText(copy.readOnly)).toBeNull();
    expect(screen.getByRole('button', { name: copy.save }).matches(':disabled')).toBe(false);
  });

  it('reads the current logo for the preview, and a failed read just means no logo', async () => {
    routes.set('/print-templates', ok(list));
    routes.set('/print-templates/presets', ok(presets));
    sessionMock.mockResolvedValue(session(['hospital.settings.read']));
    routes.set('/settings/branding', ok({ logo: { id: 'logo-7' }, canWrite: true, limits: {} }));
    const first = render(await SettingsSectionPage(section));
    expect(screen.getByRole('option', { name: 'A4, full letterhead' })).toBeTruthy();
    first.unmount();
    routes.set('/settings/branding', { status: 'error', code: 'UNAVAILABLE' });
    render(await SettingsSectionPage(section));
    expect(screen.getByRole('option', { name: 'A4, full letterhead' })).toBeTruthy();
  });

  it('shows a calm error when the templates or the presets cannot be loaded', async () => {
    sessionMock.mockResolvedValue(session(['hospital.settings.read']));
    routes.set('/print-templates', { status: 'error', code: 'UNAVAILABLE' });
    routes.set('/print-templates/presets', ok(presets));
    const first = render(await SettingsSectionPage(section));
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    first.unmount();
    routes.set('/print-templates', ok(list));
    routes.set('/print-templates/presets', { status: 'forbidden' });
    render(await SettingsSectionPage(section));
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
  });
});

describe('patient report print page', () => {
  const template = withFields(
    makeTemplate('PATIENT_REPORT', { paper: 'A4', pageWidthMm: 210, pageHeightMm: 297 }),
    ['patientName', 'complaints', 'diagnosis', 'medicines'],
  );
  const copy = staffCopy.print.patientReport;

  it('needs opd.notes.read', async () => {
    sessionMock.mockResolvedValue(session(['opd.visits.read']));
    await expect(PatientReportPrintPage(idParams)).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('prints the completed consultation with everything through the patient report template', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set('/print-templates/PATIENT_REPORT', ok(template));
    const { container } = render(await PatientReportPrintPage(idParams));
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 210mm 297mm; margin: 0; }',
    );
    expect(screen.getByText('Fever 3 days')).toBeTruthy();
    expect(screen.getByText('Viral fever')).toBeTruthy();
    expect(screen.getByText(/1\. Paracetamol 500/)).toBeTruthy();
    expect(screen.queryByText('Rest')).toBeNull(); // advice is off in this template
    expect(screen.getByRole('button', { name: copy.print })).toBeTruthy();
  });
});

describe('patient card page', () => {
  const copy = staffCopy.print.patientCard;
  const patientDetail = {
    id: 'p1',
    uhid: 'HSP-0001',
    name: 'Praveen S',
    gender: 'M',
    dateOfBirth: '1990-01-01',
    ageYears: 36,
    age: { years: 36, months: 10, days: 25 },
    dobIsEstimated: false,
    createdByName: 'Receptionist One',
    phone: '+919876543210',
    email: null,
    addressStreet: 'Main Road',
    addressCross: null,
    addressArea: null,
    addressCity: 'Hubli',
    addressState: null,
    addressPincode: null,
    registeredBranchId: 'b1',
    isActive: true,
    customFieldValues: [],
  };
  const cardTemplate = withFields(
    makeTemplate('PATIENT_CARD', {
      paper: 'LABEL',
      widthMm: 100,
      heightMm: 50,
      pageWidthMm: 100,
      pageHeightMm: 50,
    }),
    ['uhid', 'patientName', 'age', 'address', 'phone', 'receptionistName'],
  );

  it('prints the label with the patient and the receptionist at the label page size', async () => {
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    routes.set('/patients/p1', ok(patientDetail));
    routes.set('/print-templates/PATIENT_CARD', ok(cardTemplate));
    const { container } = render(
      await PatientCardPage({ ...idParams, searchParams: Promise.resolve({}) }),
    );
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 100mm 50mm; margin: 0; }',
    );
    expect(screen.getAllByText(/Praveen S/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Receptionist One/)).toBeTruthy();
    expect(screen.getByText(/36 y/)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.print })).toBeTruthy();
  });

  it('says so when the hospital has switched the card off', async () => {
    sessionMock.mockResolvedValue(session(['patients.registry.read']));
    routes.set('/patients/p1', ok(patientDetail));
    routes.set('/print-templates/PATIENT_CARD', ok({ ...cardTemplate, enabled: false }));
    render(await PatientCardPage({ ...idParams, searchParams: Promise.resolve({}) }));
    expect(screen.getByText(copy.switchedOffTitle)).toBeTruthy();
  });
});
