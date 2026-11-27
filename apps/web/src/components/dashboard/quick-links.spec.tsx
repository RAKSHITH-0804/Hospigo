import { render, screen } from '@testing-library/react';
import { QuickLinks, quickLinksFor } from '@/components/dashboard/quick-links';
import { staffCopy } from '@/config/staff-copy';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const copy = staffCopy.dashboard;
const show = (permissions: string[] | undefined) =>
  render(
    <QuickLinks
      displayName="Dr Meena"
      branchName="Main Branch"
      hospitalName="Demo Clinic"
      permissions={permissions}
    />,
  );

describe('quickLinksFor', () => {
  it('gives only the links whose permission the person holds, in a fixed order', () => {
    expect(
      quickLinksFor(['hospital.settings.read', 'patients.registry.read']).map((l) => l.id),
    ).toEqual(['patients', 'settings']);
    expect(quickLinksFor([])).toEqual([]);
    expect(quickLinksFor(undefined)).toEqual([]);
    expect(quickLinksFor(['unknown.permission'])).toEqual([]);
  });
});

describe('QuickLinks', () => {
  it('welcomes the person with the branch and the hospital', () => {
    show(['patients.registry.read']);
    expect(screen.getByText(/Good (morning|afternoon|evening), Dr Meena/)).toBeTruthy();
    expect(screen.getByText(/Main Branch/)).toBeTruthy();
    expect(screen.getByText(/Demo Clinic/)).toBeTruthy();
  });

  it('a receptionist sees register, find and queue; an Admin sees reports and settings too', () => {
    const first = show(['patients.registry.read', 'patients.registry.write', 'opd.queue.read']);
    expect(
      screen
        .getByRole('link', { name: new RegExp(copy.links.register.title) })
        .getAttribute('href'),
    ).toBe('/app/patients/new');
    expect(
      screen.getByRole('link', { name: new RegExp(copy.links.queue.title) }).getAttribute('href'),
    ).toBe('/app/opd');
    expect(screen.queryByRole('link', { name: new RegExp(copy.links.report.title) })).toBeNull();
    first.unmount();
    show(['opd.reports.read', 'hospital.settings.read', 'opd.refunds.approve']);
    expect(
      screen.getByRole('link', { name: new RegExp(copy.links.report.title) }).getAttribute('href'),
    ).toBe('/app/opd/reports');
    expect(
      screen
        .getByRole('link', { name: new RegExp(copy.links.settings.title) })
        .getAttribute('href'),
    ).toBe('/app/settings');
    expect(
      screen.getByRole('link', { name: new RegExp(copy.links.refunds.title) }).getAttribute('href'),
    ).toBe('/app/opd/refunds');
  });

  it('a doctor sees My profile', () => {
    show(['opd.doctors.own', 'opd.queue.read']);
    expect(
      screen.getByRole('link', { name: new RegExp(copy.links.profile.title) }).getAttribute('href'),
    ).toBe('/app/profile');
  });

  it('says so when there is nothing to start from, and shows no fake numbers', () => {
    const { container } = show([]);
    expect(screen.getByText(copy.nothingYet)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).not.toMatch(/\d{2,}/);
  });
});
