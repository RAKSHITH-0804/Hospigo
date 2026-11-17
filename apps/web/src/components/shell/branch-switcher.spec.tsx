import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { BranchSwitcher } from '@/components/shell/branch-switcher';
import { BranchSync } from '@/components/shell/branch-sync';
import { branchSwitchConfig } from '@/config/branch-switch';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, getClientActiveBranch } from '@/lib/auth/client-session';

jest.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
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

const reloadMock = jest.fn();
jest.mock('@/lib/auth/navigate', () => ({ reloadPage: () => reloadMock() }));

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const BRANCHES = [
  { id: 'b-main', name: 'Main Branch', isMain: true, isCurrent: true },
  { id: 'b-east', name: 'East Wing', isMain: false, isCurrent: false },
];

function routeFetch(handlers: {
  branches?: () => unknown;
  switchBranch?: () => unknown;
  activeBranch?: () => unknown;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === branchSwitchConfig.endpoints.branches) {
      return handlers.branches?.() ?? jsonResponse(BRANCHES);
    }
    if (url === branchSwitchConfig.endpoints.switchBranch) {
      return handlers.switchBranch?.() ?? jsonResponse({ ok: true });
    }
    if (url === branchSwitchConfig.endpoints.activeBranch) {
      return handlers.activeBranch?.() ?? jsonResponse({ activeBranchId: 'b-main' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  reloadMock.mockReset();
  clearClientRefreshLatchForTests();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('BranchSwitcher', () => {
  const trigger = () => screen.getByRole('button', { name: staffCopy.shell.branchSwitcherAria });

  it('shows the active branch and loads the list only when opened (skeleton first)', async () => {
    let release!: (value: unknown) => void;
    routeFetch({ branches: () => new Promise((resolve) => (release = resolve)) });
    render(<BranchSwitcher activeBranchName="Main Branch" />);
    expect(trigger().textContent).toContain('Main Branch');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(trigger());
    const skeleton = await screen.findByRole('status', {
      name: staffCopy.shell.branchSwitcherLoading,
    });
    expect(skeleton.getAttribute('aria-busy')).toBe('true');

    await act(async () => release(jsonResponse(BRANCHES)));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(
      screen.queryByRole('status', { name: staffCopy.shell.branchSwitcherLoading }),
    ).toBeNull();
  });

  it('marks the current branch (checked, disabled) and leaves the others clickable', async () => {
    routeFetch({});
    render(<BranchSwitcher activeBranchName="Main Branch" />);
    fireEvent.click(trigger());
    const main = await screen.findByRole('menuitemradio', { name: /Main Branch/ });
    const east = screen.getByRole('menuitemradio', { name: /East Wing/ });
    expect(main.getAttribute('aria-checked')).toBe('true');
    expect((main as HTMLButtonElement).disabled).toBe(true);
    expect(east.getAttribute('aria-checked')).toBe('false');
    expect((east as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches: posts only the branch id, shows the switching state, then reloads the page', async () => {
    let finish!: (value: unknown) => void;
    routeFetch({ switchBranch: () => new Promise((resolve) => (finish = resolve)) });
    render(<BranchSwitcher activeBranchName="Main Branch" />);
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /East Wing/ }));

    expect(await screen.findByText(staffCopy.shell.branchSwitcherSwitching)).toBeTruthy();
    // While switching every item is locked (no double clicks, no second target).
    for (const item of screen.getAllByRole('menuitemradio')) {
      expect((item as HTMLButtonElement).disabled).toBe(true);
    }
    expect(reloadMock).not.toHaveBeenCalled();

    await act(async () => finish(jsonResponse({ ok: true })));
    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));

    const switchCall = fetchMock.mock.calls.find(
      (c) => c[0] === branchSwitchConfig.endpoints.switchBranch,
    )!;
    expect(JSON.parse(String((switchCall[1] as RequestInit).body))).toEqual({ branchId: 'b-east' });
  });

  it.each([
    ['BRANCH_NOT_AVAILABLE', 404, staffCopy.errors.branchNotAvailable],
    ['FORBIDDEN', 403, staffCopy.errors.forbidden],
    ['SWITCH_IN_PROGRESS', 409, staffCopy.errors.branchSwitchBusy],
    ['SESSION_EXPIRED', 401, staffCopy.errors.sessionExpired],
    ['UNAVAILABLE', 503, staffCopy.errors.unreachable],
  ])(
    'a %s answer shows its message, keeps the page, and does not reload',
    async (code, status, message) => {
      routeFetch({ switchBranch: () => jsonResponse({ ok: false, code }, status) });
      render(<BranchSwitcher activeBranchName="Main Branch" />);
      fireEvent.click(trigger());
      fireEvent.click(await screen.findByRole('menuitemradio', { name: /East Wing/ }));
      expect((await screen.findByRole('alert')).textContent).toContain(message);
      expect(reloadMock).not.toHaveBeenCalled();
      // The user can try again: the items are enabled again.
      expect(
        (screen.getByRole('menuitemradio', { name: /East Wing/ }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  it('shows an error (not a list) when the branch list cannot be loaded', async () => {
    routeFetch({ branches: () => jsonResponse({ code: 'FORBIDDEN' }, 403) });
    render(<BranchSwitcher activeBranchName="Main Branch" />);
    fireEvent.click(trigger());
    expect((await screen.findByRole('alert')).textContent).toContain(staffCopy.errors.forbidden);
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });

  it('with the session gone, the open dropdown says the session expired (not "something went wrong")', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === branchSwitchConfig.endpoints.branches) {
        return jsonResponse({ code: 'UNAUTHORIZED' }, 401);
      }
      return jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401);
    });
    render(<BranchSwitcher activeBranchName="Main Branch" />);
    fireEvent.click(trigger());
    expect((await screen.findByRole('alert')).textContent).toContain(
      staffCopy.errors.sessionExpired,
    );
  });

  it('closes on Escape and on an outside click, and supports arrow keys', async () => {
    routeFetch({});
    render(
      <div>
        <BranchSwitcher activeBranchName="Main Branch" />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(trigger());
    await screen.findAllByRole('menuitemradio');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /East Wing/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger());
    await screen.findByRole('menu');
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('top bar: switcher only for hospital-wide users', () => {
  function shell(props: { canSwitchBranch?: boolean }) {
    return render(
      <AppShell
        title="Demo Hospital"
        items={[]}
        branchName="Main Branch"
        activeBranchId="b-main"
        userDisplayName="Pat"
        userEmail="pat@example.test"
        roleCodes={[]}
        {...props}
      >
        <p>content</p>
      </AppShell>,
    );
  }

  it('canSwitchBranch=true renders the dropdown trigger', () => {
    routeFetch({});
    shell({ canSwitchBranch: true });
    expect(screen.getByRole('button', { name: staffCopy.shell.branchSwitcherAria })).toBeTruthy();
  });

  it.each([[false], [undefined]])(
    'canSwitchBranch=%s renders the read-only label and NO control',
    (flag) => {
      routeFetch({});
      shell({ canSwitchBranch: flag });
      expect(screen.getByLabelText(staffCopy.shell.branchChipAria).textContent).toContain(
        'Main Branch',
      );
      expect(screen.queryByRole('button', { name: staffCopy.shell.branchSwitcherAria })).toBeNull();
    },
  );

  it('remembers the page branch for the stale-tab guard header', () => {
    routeFetch({});
    shell({ canSwitchBranch: false });
    expect(getClientActiveBranch()).toBe('b-main');
  });
});

describe('BranchSync: focus re-check', () => {
  let now = 1_000_000;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function focusWindow() {
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
  }

  it('reloads when another tab switched the branch', async () => {
    routeFetch({ activeBranch: () => jsonResponse({ activeBranchId: 'b-east' }) });
    render(<BranchSync activeBranchId="b-main" />);
    await focusWindow();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the branch is unchanged', async () => {
    routeFetch({});
    render(<BranchSync activeBranchId="b-main" />);
    await focusWindow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown branch (expired cookie)', () => jsonResponse({ activeBranchId: null })],
    ['a server error', () => jsonResponse({}, 500)],
    [
      'a network failure',
      () => {
        throw new Error('offline');
      },
    ],
  ])('never reloads on %s', async (_n, activeBranch) => {
    routeFetch({ activeBranch });
    render(<BranchSync activeBranchId="b-main" />);
    await focusWindow();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('also checks when the tab becomes visible, but not while it is hidden', async () => {
    routeFetch({ activeBranch: () => jsonResponse({ activeBranchId: 'b-east' }) });
    render(<BranchSync activeBranchId="b-main" />);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('throttles focus bursts to one check per interval', async () => {
    routeFetch({});
    render(<BranchSync activeBranchId="b-main" />);
    await focusWindow();
    await focusWindow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += branchSwitchConfig.recheckMinIntervalMs + 1;
    await focusWindow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops listening after unmount', async () => {
    routeFetch({ activeBranch: () => jsonResponse({ activeBranchId: 'b-east' }) });
    const view = render(<BranchSync activeBranchId="b-main" />);
    view.unmount();
    await focusWindow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
