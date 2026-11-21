import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReportActions, ReportToolbar } from '@/components/opd/report-toolbar';
import { staffCopy } from '@/config/staff-copy';
import type { ReportQuery } from '@/lib/opd/reports';
import type { ReportFilterOptions } from '@/lib/opd/reports-types';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const copy = staffCopy.opd.reports;

const options: ReportFilterOptions = {
  branches: [
    { id: 'b-east', code: 'EAST', name: 'East Wing' },
    { id: 'b-main', code: 'MAIN', name: 'Main Branch' },
  ],
  activeBranchId: 'b-main',
  canAllBranches: true,
  doctors: [
    { code: 'DR1', name: 'Dr Asha' },
    { code: 'DR2', name: 'Dr Meena' },
  ],
  paymentModes: [
    { code: 'CASH', name: 'Cash' },
    { code: 'UPI', name: 'UPI' },
  ],
  departments: ['(none)', 'General Medicine'],
  billTypes: ['CONSULTATION', 'INVESTIGATION'],
  tests: [
    { code: 'CBC', name: 'Complete blood count' },
    { code: 'XR', name: 'Chest X-ray' },
  ],
};
const base: ReportQuery = { date: '2026-11-20', branch: null, filters: {} };

function setup(query: ReportQuery = base, opts: ReportFilterOptions = options) {
  // the page shows the actions beside the title and the filters under it
  return render(
    <>
      <ReportActions query={query} />
      <ReportToolbar query={query} options={opts} today="2026-11-20" weekStart={1} />
    </>,
  );
}
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const optionsOf = (label: string) => [...select(label).options].map((o) => o.textContent);

beforeEach(() => push.mockReset());

describe('the dropdowns are the hospital own lists, not fixed names', () => {
  it('doctor, payment mode, department, bill type and test each start on All and list real values', () => {
    setup();
    expect(optionsOf(copy.doctorLabel)).toEqual([copy.allDoctors, 'Dr Asha', 'Dr Meena']);
    expect(optionsOf(copy.modeLabel)).toEqual([copy.allModes, 'Cash', 'UPI']);
    expect(optionsOf(copy.departmentLabel)).toEqual([
      copy.allDepartments,
      copy.noDepartment,
      'General Medicine',
    ]);
    expect(optionsOf(copy.billTypeLabel)).toEqual([
      copy.allBillTypes,
      copy.billTypeConsultation,
      copy.billTypeInvestigation,
    ]);
    expect(optionsOf(copy.testLabel)).toEqual([
      copy.allTests,
      'Complete blood count',
      'Chest X-ray',
    ]);
    for (const label of [
      copy.doctorLabel,
      copy.modeLabel,
      copy.departmentLabel,
      copy.billTypeLabel,
      copy.testLabel,
    ]) {
      expect(select(label).value).toBe('');
    }
  });

  it('the branch list shows branch names with "All branches" at the end, and the working branch is chosen', () => {
    setup();
    expect(optionsOf(copy.branchLabel)).toEqual(['East Wing', 'Main Branch', copy.allBranches]);
    expect(select(copy.branchLabel).value).toBe('b-main');
  });

  it('"All branches" is offered only to someone with hospital-wide access', () => {
    setup(base, { ...options, canAllBranches: false, branches: [options.branches[1]!] });
    expect(optionsOf(copy.branchLabel)).toEqual(['Main Branch']);
  });

  it('reflects what is chosen in the address', () => {
    setup({
      date: '2026-11-20',
      branch: 'b-east',
      filters: { doctor: 'DR2', paymentMode: 'UPI' },
    });
    expect(select(copy.branchLabel).value).toBe('b-east');
    expect(select(copy.doctorLabel).value).toBe('DR2');
    expect(select(copy.modeLabel).value).toBe('UPI');
  });
});

describe('every choice opens the report again at once', () => {
  it('picking a doctor keeps the day and the other choices', () => {
    setup({ date: '2026-11-18', branch: 'b-east', filters: { paymentMode: 'UPI' } });
    fireEvent.change(select(copy.doctorLabel), { target: { value: 'DR1' } });
    expect(push).toHaveBeenCalledWith(
      '/app/opd/reports?date=2026-11-18&branch=b-east&doctor=DR1&paymentMode=UPI',
    );
  });

  it('choosing "All" for a filter removes it from the address', () => {
    setup({ date: '2026-11-20', branch: null, filters: { doctor: 'DR1', test: 'CBC' } });
    fireEvent.change(select(copy.doctorLabel), { target: { value: '' } });
    expect(push).toHaveBeenCalledWith('/app/opd/reports?date=2026-11-20&test=CBC');
  });

  it('choosing the working branch again means no branch in the address; All branches means ALL', () => {
    setup({ date: '2026-11-20', branch: 'b-east', filters: {} });
    fireEvent.change(select(copy.branchLabel), { target: { value: 'b-main' } });
    expect(push).toHaveBeenLastCalledWith('/app/opd/reports?date=2026-11-20');
    fireEvent.change(select(copy.branchLabel), { target: { value: 'ALL' } });
    expect(push).toHaveBeenLastCalledWith('/app/opd/reports?date=2026-11-20&branch=ALL');
  });

  it('Clear filters appears only with a filter on, and keeps the day and the branch', () => {
    const { unmount } = setup();
    expect(screen.queryByRole('button', { name: copy.clearFilters })).toBeNull();
    unmount();
    setup({ date: '2026-11-19', branch: 'ALL', filters: { doctor: 'DR1', paymentMode: 'UPI' } });
    fireEvent.click(screen.getByRole('button', { name: copy.clearFilters }));
    expect(push).toHaveBeenCalledWith('/app/opd/reports?date=2026-11-19&branch=ALL');
  });
});

describe('the calendar', () => {
  const open = () => fireEvent.click(screen.getByLabelText(copy.dateLabel));

  it('opens the calendar view, with Today and Yesterday inside it', () => {
    setup();
    open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: copy.today })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: copy.yesterday })).toBeTruthy();
    // not the old "Tomorrow" / "In 3 days" picks of the forms
    expect(
      within(dialog).queryByRole('button', { name: staffCopy.calendar.quickTomorrow }),
    ).toBeNull();
  });

  it('Yesterday picks the day before today and keeps the other choices', () => {
    setup({ date: '2026-11-20', branch: null, filters: { doctor: 'DR1' } });
    open();
    fireEvent.click(screen.getByRole('button', { name: copy.yesterday }));
    expect(push).toHaveBeenCalledWith('/app/opd/reports?date=2026-11-19&doctor=DR1');
  });

  it('Today picks today, and a day after today cannot be picked', () => {
    setup({ date: '2026-11-10', branch: null, filters: {} });
    fireEvent.click(screen.getByLabelText(copy.dateLabel));
    fireEvent.click(screen.getByRole('button', { name: copy.today }));
    expect(push).toHaveBeenCalledWith('/app/opd/reports?date=2026-11-20');
    push.mockReset();
    fireEvent.click(screen.getByLabelText(copy.dateLabel));
    const tomorrow = screen.getByRole('button', { name: /Saturday, 21 November 2026/ });
    expect((tomorrow as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('one Print menu', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: copy.printMenu }));

  it('holds Print, Save as PDF, Download CSV and Download Excel, and nothing else is a separate button', () => {
    setup();
    expect(screen.queryByRole('link', { name: copy.menuCsv })).toBeNull();
    openMenu();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      copy.menuPrint,
      copy.menuPdf,
      copy.menuCsv,
      copy.menuExcel,
    ]);
  });

  it('the downloads are of the day, the branch and the filters that are on screen', () => {
    setup({ date: '2026-11-19', branch: 'ALL', filters: { doctor: 'DR2', test: 'CBC' } });
    openMenu();
    expect(screen.getByRole('menuitem', { name: copy.menuCsv }).getAttribute('href')).toBe(
      '/api/staff/opd/reports/daily-collection.csv?date=2026-11-19&branch=ALL&doctor=DR2&test=CBC',
    );
    expect(screen.getByRole('menuitem', { name: copy.menuExcel }).getAttribute('href')).toBe(
      '/api/staff/opd/reports/daily-collection.xlsx?date=2026-11-19&branch=ALL&doctor=DR2&test=CBC',
    );
  });

  it('Print and Save as PDF both open the print window', () => {
    const print = jest.fn();
    window.print = print;
    setup();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: copy.menuPrint }));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: copy.menuPdf }));
    expect(print).toHaveBeenCalledTimes(2);
  });
});
