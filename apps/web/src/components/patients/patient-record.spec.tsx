import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PatientRecord } from '@/components/patients/patient-record';
import { PatientSlip } from '@/components/patients/patient-slip';
import { staffCopy } from '@/config/staff-copy';
import { safePaperSize, slipPageRule } from '@/lib/patients/format';
import type { PatientDetail } from '@/lib/patients/types';

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

const copy = staffCopy.patients;

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
  addressStreet: '1 Test Street',
  addressCross: null,
  addressArea: null,
  addressCity: 'Mockville',
  addressState: null,
  addressPincode: '560001',
  registeredBranchId: 'b1',
  isActive: true,
  customFieldValues: [{ code: 'title', optionId: 'opt-ms', optionLabel: 'Ms' }],
};

const labels = { title: 'Title' };

describe('PatientRecord', () => {
  it('shows the overview sections from the props (no fetch)', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<PatientRecord patient={detail} labels={labels} canWrite />);
    expect(screen.getByRole('heading', { name: 'Mock Alpha' })).toBeTruthy();
    expect(screen.getByText(copy.record.sectionDemographics)).toBeTruthy();
    expect(screen.getByText(copy.record.sectionContact)).toBeTruthy();
    expect(screen.getByText(copy.record.sectionAddress)).toBeTruthy();
    expect(screen.getByText(copy.record.sectionCustom)).toBeTruthy();
    expect(screen.getByText('Female')).toBeTruthy();
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Ms')).toBeTruthy();
    expect(screen.getByText('560001')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a real date of birth shows the date (table format) and the age', () => {
    render(<PatientRecord patient={detail} labels={labels} canWrite={false} />);
    expect(screen.getByText(copy.form.dateOfBirth)).toBeTruthy();
    expect(screen.getByText('15 Jan 1990')).toBeTruthy();
    expect(screen.getByText(`36 ${copy.record.ageYearsSuffix}`)).toBeTruthy();
    expect(screen.queryByText(/approx/)).toBeNull();
  });

  it('an estimated date of birth shows the approximate age and no date', () => {
    render(
      <PatientRecord
        patient={{ ...detail, dobIsEstimated: true, ageYears: 33 }}
        labels={labels}
        canWrite={false}
      />,
    );
    expect(screen.getByText(copy.record.ageApproximate.replace('{age}', '33'))).toBeTruthy();
    expect(screen.getByText('33 years (approx.)')).toBeTruthy();
    expect(screen.queryByText(/^Age 33/)).toBeNull();
    expect(screen.queryByText(copy.form.dateOfBirth)).toBeNull();
    expect(screen.queryByText(/1990|Jan/)).toBeNull();
  });

  it('shows the phone in the spaced format', () => {
    render(
      <PatientRecord patient={{ ...detail, phone: '+917000000039' }} labels={labels} canWrite />,
    );
    expect(screen.getByText('+91 70000 00039')).toBeTruthy();
  });

  it('section cards use the quiet heading style and the shared card padding', () => {
    render(<PatientRecord patient={detail} labels={labels} canWrite />);
    const heading = screen.getByText(copy.record.sectionDemographics);
    expect(heading.className).toContain('section-heading');
    const header = heading.closest('[data-slot="card-header"]');
    expect(header?.className).toContain('px-[var(--space-card-padding)]');
    const css = fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');
    // as many columns as the block is wide enough for, and the blocks side by side on a wide screen
    expect(css).toMatch(
      /\.record-cols[\s\S]*repeat\(auto-fit, minmax\(min\(100%, 9\.5rem\), 1fr\)\)/,
    );
    expect(css).toMatch(
      /\.patient-record-grid[\s\S]*repeat\(auto-fit, minmax\(min\(100%, 22rem\), 1fr\)\)/,
    );
  });

  it('links to edit (write only) and slip', () => {
    const { unmount } = render(<PatientRecord patient={detail} labels={labels} canWrite />);
    expect(screen.getByRole('link', { name: copy.record.editAction }).getAttribute('href')).toBe(
      '/app/patients/p1/edit',
    );
    expect(
      screen.getByRole('link', { name: copy.record.printSlipAction }).getAttribute('href'),
    ).toBe('/app/patients/p1/slip');
    unmount();
    render(<PatientRecord patient={detail} labels={labels} canWrite={false} />);
    expect(screen.queryByRole('link', { name: copy.record.editAction })).toBeNull();
  });

  it('switches tabs; without visit data (no permission) the Visits and Bills tabs say so', () => {
    render(<PatientRecord patient={detail} labels={labels} canWrite={false} />);
    fireEvent.click(screen.getByRole('tab', { name: copy.record.tabVisits }));
    expect(screen.getByText(staffCopy.opd.tabs.noAccessTitle)).toBeTruthy();
    expect(screen.queryByText(copy.record.sectionDemographics)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: copy.record.tabBills }));
    expect(screen.getByText(staffCopy.opd.tabs.noAccessTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: copy.record.tabOverview }));
    expect(screen.getByText(copy.record.sectionDemographics)).toBeTruthy();
  });
});

describe('PatientSlip', () => {
  it('renders the hospital name and patient details inside the print root', () => {
    const { container } = render(<PatientSlip patient={detail} hospitalName="Demo Hospital One" />);
    expect(screen.getByText('Demo Hospital One')).toBeTruthy();
    const slip = container.querySelector('.patient-slip');
    expect(slip).toBeTruthy();
    expect(container.querySelector('.patient-slip-print-root')?.contains(slip)).toBe(true);
    expect(slip?.textContent).toContain('NREG0001');
    expect(slip?.textContent).toContain('Mock Alpha');
    expect(slip?.textContent).toContain('+919876543210');
    expect(container.querySelector('.no-print')?.textContent).toContain(copy.slip.print);
  });

  it('prints through window.print', () => {
    const printMock = jest.fn();
    window.print = printMock;
    render(<PatientSlip patient={detail} hospitalName="Demo Hospital One" />);
    fireEvent.click(screen.getByRole('button', { name: copy.slip.print }));
    expect(printMock).toHaveBeenCalledTimes(1);
  });
});

describe('slip page rule', () => {
  it('inlines the configured paper size and rejects unsafe values', () => {
    expect(slipPageRule('A5', '0')).toBe('@page { size: A5; margin: 0; }');
    expect(slipPageRule('A5', '5mm')).toBe('@page { size: A5; margin: 5mm; }');
    expect(slipPageRule('A5')).toBe('@page { size: A5; margin: 0; }');
    expect(slipPageRule('A4', '0; } body { display:none')).toBe('@page { size: A4; margin: 0; }');
    expect(slipPageRule('80mm 200mm')).toBe('@page { size: 80mm 200mm; margin: 0; }');
    expect(safePaperSize('A4; } body { display:none', 'A4')).toBe('A4');
    expect(slipPageRule('}')).toBe('@page { size: A4; margin: 0; }');
  });
});
