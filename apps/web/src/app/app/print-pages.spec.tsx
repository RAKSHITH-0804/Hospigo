import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import PatientSlipPage from '@/app/app/patients/[id]/slip/page';
import VisitReceiptPage from '@/app/app/opd/visits/[id]/receipt/page';
import PrescriptionPrintPage from '@/app/app/opd/visits/[id]/prescription/page';
import SettingsSectionPage from '@/app/app/settings/[section]/page';
import { staffCopy } from '@/config/staff-copy';
import { makeTemplate, withFields } from '@/lib/print/print-test-fixtures';

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

  it('prints the completed prescription through the template', async () => {
    sessionMock.mockResolvedValue(session(['opd.notes.read']));
    routes.set('/opd/visits/p1/consultation', ok(completedConsult()));
    routes.set('/print-templates/PRESCRIPTION', ok(template));
    const { container } = render(await PrescriptionPrintPage(idParams));
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 210mm 297mm; margin: 0; }',
    );
    expect(screen.getByText('Fever 3 days')).toBeTruthy();
    expect(screen.getByText('Viral fever')).toBeTruthy();
    expect(screen.getByText(/1\. Paracetamol 500/)).toBeTruthy();
    expect(screen.queryByText('Rest')).toBeNull(); // advice is off in this template
    expect(screen.getByRole('button', { name: copy.print })).toBeTruthy();
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
