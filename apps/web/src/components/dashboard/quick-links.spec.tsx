import { render, screen } from '@testing-library/react';
import { QuickLinks, quickLinksFor } from '@/components/dashboard/quick-links';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const show = (_permissions?: string[]) =>
  render(
    <QuickLinks
      displayName="Dr Meena"
      branchName="Main Branch"
      hospitalName="Demo Clinic"
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

  it('has no tiles of module names: the blocks below lead to the screens', () => {
    show(['patients.registry.read', 'opd.queue.read', 'opd.reports.read']);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
