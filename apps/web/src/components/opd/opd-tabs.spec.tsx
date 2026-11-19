import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import OpdLayout from '@/app/app/opd/layout';
import { OpdTabs } from '@/components/opd/opd-tabs';
import { staffCopy } from '@/config/staff-copy';

let pathname = '/app/opd';
const sessionMock = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
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
jest.mock('@/lib/auth/module-guard', () => ({
  requireModule: async () => sessionMock(),
}));

const nav = staffCopy.opd.tests.nav;
const ALL = [
  { href: '/app/opd', label: nav.queue },
  { href: '/app/opd/tests', label: nav.tests },
  { href: '/app/opd/refunds', label: nav.refunds },
];
const labels = () => screen.queryAllByRole('link').map((l) => l.textContent);

describe('OPD tabs', () => {
  it('shows the sections as links and marks the open one', () => {
    pathname = '/app/opd/tests';
    render(<OpdTabs items={ALL} />);
    expect(labels()).toEqual([nav.queue, nav.tests, nav.refunds]);
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
    ]);
  });

  it('shows on the three top-level pages (with or without a trailing slash) and nowhere deeper', () => {
    for (const path of ['/app/opd', '/app/opd/', '/app/opd/tests', '/app/opd/refunds']) {
      pathname = path;
      const r = render(<OpdTabs items={ALL} />);
      expect({ path, shown: labels().length }).toEqual({ path, shown: 3 });
      r.unmount();
    }
    for (const path of [
      '/app/opd/visits/v1/consult',
      '/app/opd/visits/v1/vitals',
      '/app/opd/visits/v1/receipt',
      '/app/opd/visits/v1/tests',
      '/app/patients',
    ]) {
      pathname = path;
      const r = render(<OpdTabs items={ALL} />);
      expect({ path, shown: labels().length }).toEqual({ path, shown: 0 });
      r.unmount();
    }
  });

  it('a single section is not shown on its own page, but is offered from another OPD page', () => {
    const only = [ALL[2]!];
    pathname = '/app/opd/refunds';
    const first = render(<OpdTabs items={only} />);
    expect(labels()).toEqual([]);
    first.unmount();
    pathname = '/app/opd'; // an Admin on the queue page, which they cannot use
    render(<OpdTabs items={only} />);
    expect(labels()).toEqual([nav.refunds]);
  });

  it('shows nothing when there is nothing to choose', () => {
    pathname = '/app/opd';
    render(<OpdTabs items={[]} />);
    expect(labels()).toEqual([]);
  });
});

describe('OPD layout', () => {
  const session = (permissions: string[]) => ({ kind: 'HOSPITAL', permissions });
  async function sectionsFor(permissions: string[]): Promise<string[]> {
    sessionMock.mockResolvedValue(session(permissions));
    pathname = '/app/opd';
    const view = render(await OpdLayout({ children: <p>page</p> }));
    const out = labels();
    expect(screen.getByText('page')).toBeTruthy();
    view.unmount();
    return out;
  }

  it('gives each role only its own sections', async () => {
    // reception: queue (read only), tests to bill (needs billing and collect), refund requests (read)
    expect(
      await sectionsFor([
        'opd.queue.read',
        'opd.investigations.bill',
        'opd.billing.collect',
        'opd.billing.read',
      ]),
    ).toEqual([nav.queue, nav.tests, nav.refunds]);
    // a doctor or nurse: the queue only, so no strip at all
    expect(await sectionsFor(['opd.queue.read', 'opd.notes.read'])).toEqual([]);
    // an Admin: refund requests, offered from the page they land on
    expect(await sectionsFor(['opd.billing.read', 'opd.refunds.approve'])).toEqual([nav.refunds]);
    // billing tests also needs the permission to take money
    expect(await sectionsFor(['opd.queue.read', 'opd.investigations.bill'])).toEqual([]);
    expect(await sectionsFor([])).toEqual([]);
  });
});
