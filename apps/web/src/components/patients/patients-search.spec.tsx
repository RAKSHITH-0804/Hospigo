import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PatientsSearch, type PatientsSearchProps } from '@/components/patients/patients-search';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import type { PatientListResponse } from '@/lib/patients/types';

const routerMock = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/app/patients',
  useSearchParams: () => new URLSearchParams(),
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

const copy = staffCopy.patients;
const fetchMock = jest.fn();
const DEBOUNCE = 250;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    uhid: 'NREG0001',
    name: 'Mock Alpha',
    gender: 'F',
    dateOfBirth: '1990-01-15',
    ageYears: 36,
    dobIsEstimated: false,
    phone: '+919876543210',
    registeredBranchId: 'b1',
    registeredBranchName: 'Main',
    createdAt: '2026-01-15T12:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

function page(items: unknown[], extra: Record<string, unknown> = {}): PatientListResponse {
  return { items, total: items.length, page: 1, pageSize: 20, ...extra } as PatientListResponse;
}

type Initial = PatientsSearchProps['initial'];

function initialState(overrides: Partial<Initial> = {}, params = {}): Initial {
  return {
    params: { q: '', sort: 'newest', col: 'registeredOn', page: 1, ...params },
    draft: '',
    result: page([item()]),
    errorCode: null,
    hint: false,
    ...overrides,
  } as Initial;
}

function renderSearch(initial: Initial = initialState(), props: Partial<PatientsSearchProps> = {}) {
  return render(
    <PatientsSearch
      canWrite={false}
      initial={initial}
      minLength={2}
      maxLength={64}
      debounceMs={DEBOUNCE}
      pageSize={20}
      {...props}
    />,
  );
}

function box() {
  return screen.getByRole('searchbox') as HTMLInputElement;
}

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

function urlCalls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

describe('PatientsSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    window.history.replaceState(null, '', '/app/patients');
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the server-fetched rows without calling the API on load', () => {
    renderSearch();
    expect(screen.getByText('NREG0001')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured minimum length and delay', () => {
    expect(patientsWebConfig.searchMinLength).toBe(2);
    expect(patientsWebConfig.searchDebounceMs).toBe(DEBOUNCE);
  });

  it('has one toolbar row: search box with icon and a Search button; no Clear, no Register', () => {
    renderSearch(initialState(), { canWrite: true });
    const row = screen.getByTestId('patients-search-row');
    expect(row.contains(box())).toBe(true);
    expect(row.contains(screen.getByRole('button', { name: copy.search.submit }))).toBe(true);
    expect(row.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(row.contains(screen.queryByRole('link', { name: copy.registerAction }))).toBe(false);
  });

  it('uses a plain text input (no native clear icon) with role searchbox', () => {
    renderSearch();
    expect(box().getAttribute('type')).toBe('text');
    expect(box().getAttribute('role')).toBe('searchbox');
  });

  it('shows the blue X only when the box has text', () => {
    renderSearch();
    expect(screen.queryByRole('button', { name: copy.search.clearInputAria })).toBeNull();
    type('an');
    expect(screen.getByRole('button', { name: copy.search.clearInputAria })).toBeTruthy();
  });

  it('searches after the delay with q, sort and page 1, and keeps the URL without navigating', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item({ name: 'Anita' })])));
    renderSearch();
    type('ani');
    await advance(DEBOUNCE - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = urlCalls()[0]!;
    expect(url).toContain('/api/staff/patients?');
    expect(url).toContain('q=ani');
    expect(url).toContain('sort=newest');
    expect(url).toContain('page=1');
    expect(await screen.findByText('Anita')).toBeTruthy();
    expect(window.location.search).toContain('q=ani');
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it('only the last text is searched when typing quickly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item()])));
    renderSearch();
    type('an');
    await advance(100);
    type('ani');
    await advance(100);
    type('anit');
    await advance(DEBOUNCE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlCalls()[0]).toContain('q=anit');
  });

  it('shows the minimum-length hint, does not call the API and keeps the list', async () => {
    renderSearch();
    type('a');
    await advance(DEBOUNCE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('patients-search-hint').textContent).toBe(
      copy.search.minLengthHint.replace('{min}', '2'),
    );
    expect(screen.getByText('NREG0001')).toBeTruthy();
  });

  it('treats an API 400 with fieldErrors.q as the hint and keeps the rows', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'UNKNOWN', fieldErrors: { q: 'INVALID' } }, 400),
    );
    renderSearch();
    type('+9');
    await advance(DEBOUNCE);
    expect(screen.getByTestId('patients-search-hint')).toBeTruthy();
    expect(screen.getByText('NREG0001')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter and the Search button search immediately, without waiting for the delay', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item()])));
    renderSearch();
    type('anita');
    fireEvent.submit(screen.getByTestId('patients-search-row'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlCalls()[0]).toContain('q=anita');

    type('mohan');
    fireEvent.click(screen.getByRole('button', { name: copy.search.submit }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlCalls()[1]).toContain('q=mohan');
    await advance(DEBOUNCE * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the previous request and ignores an out-of-order response', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: Array<(value: unknown) => void> = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise((resolve) => resolvers.push(resolve));
    });
    renderSearch();
    type('ani');
    await advance(DEBOUNCE);
    type('anit');
    await advance(DEBOUNCE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    // The newer request answers first, then the older one arrives late.
    await act(async () => {
      resolvers[1]!(jsonResponse(page([item({ id: 'p2', uhid: 'NEW0002', name: 'Anitha' })])));
    });
    await flush();
    await act(async () => {
      resolvers[0]!(jsonResponse(page([item({ id: 'p3', uhid: 'OLD0003', name: 'Anil' })])));
    });
    await flush();
    expect(screen.getByText('NEW0002')).toBeTruthy();
    expect(screen.queryByText('OLD0003')).toBeNull();
  });

  it('keeps the old rows visible and marks the list busy while loading', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderSearch();
    type('ani');
    await advance(DEBOUNCE);
    const list = screen.getByText('NREG0001').closest('[aria-busy]');
    expect(list?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('NREG0001')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      resolve(jsonResponse(page([item({ uhid: 'ANI0009' })])));
    });
    await flush();
    expect(screen.getByText('ANI0009').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe(
      'false',
    );
  });

  it('shows a plain count line (not a chip) under the toolbar', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item(), item({ id: 'p2', uhid: 'N2' })])));
    renderSearch();
    type('mock');
    await advance(DEBOUNCE);
    const line = await screen.findByTestId('patients-search-count');
    expect(line.textContent).toBe(
      copy.search.countLine.replace('{total}', '2').replace('{query}', 'mock'),
    );
    expect(screen.queryByTestId('patients-search-chip')).toBeNull();
  });

  it('shows the empty state from copy when nothing matches', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([])));
    renderSearch();
    type('zzz');
    await advance(DEBOUNCE);
    expect(await screen.findByText(copy.search.noResultTitle)).toBeTruthy();
  });

  it('the blue X empties the box and shows the full list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page([item({ uhid: 'ANI0009' })])))
      .mockResolvedValueOnce(jsonResponse(page([item()])));
    renderSearch();
    type('ani');
    await advance(DEBOUNCE);
    expect(await screen.findByText('ANI0009')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: copy.search.clearInputAria }));
    expect(box().value).toBe('');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlCalls()[1]).not.toContain('q=');
    expect(await screen.findByText('NREG0001')).toBeTruthy();
    expect(window.location.search).not.toContain('q=');
    await advance(DEBOUNCE * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts from the server state for ?q= without calling the API again', () => {
    renderSearch(
      initialState({ draft: 'anita', result: page([item({ name: 'Anita' })]) }, { q: 'anita' }),
    );
    expect(box().value).toBe('anita');
    expect(screen.getByTestId('patients-search-count')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the minimum hint on first paint when the URL text was too short', () => {
    renderSearch(initialState({ draft: 'a', hint: true }));
    expect(box().value).toBe('a');
    expect(screen.getByTestId('patients-search-hint')).toBeTruthy();
  });

  it('renders columns including branch; name is a link; unknown gender raw', () => {
    renderSearch(initialState({ result: page([item({ gender: 'X' })]) }));
    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mock Alpha' }).getAttribute('href')).toBe(
      '/app/patients/p1',
    );
    expect(screen.getByText('X')).toBeTruthy();
  });

  it('empty hospital with write permission offers register; read-only does not', () => {
    const { unmount } = renderSearch(initialState({ result: page([]) }), { canWrite: true });
    expect(screen.getByText(copy.search.emptyTitle)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: copy.registerAction }).length).toBeGreaterThan(0);
    unmount();
    renderSearch(initialState({ result: page([]) }), { canWrite: false });
    expect(screen.queryByRole('link', { name: copy.registerAction })).toBeNull();
  });

  it('opens quick view with branch name and spaced phone', () => {
    renderSearch(initialState({ result: page([item({ phone: '+917000000039' })]) }));
    fireEvent.click(screen.getByText('NREG0001'));
    expect(screen.getByText(copy.search.quickView.title)).toBeTruthy();
    expect(screen.getAllByText('+91 70000 00039').length).toBe(2);
  });

  it('header sort fetches page 1 with the new sort and updates the URL without navigating', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item()])));
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name|Sort Name/i }));
    await flush();
    expect(urlCalls()[0]).toMatch(/sort=name_/);
    expect(window.location.search).toContain('col=name');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('UHID header sorts uhid_desc first, then uhid_asc, and keeps col in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item()])));
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: /Sort by UHID|Sort UHID/i }));
    await flush();
    expect(urlCalls()[0]).toContain('sort=uhid_desc');
    expect(window.location.search).toContain('col=uhid');
    expect(window.location.search).toContain('sort=uhid_desc');
    fireEvent.click(screen.getByRole('button', { name: /Sort UHID/i }));
    await flush();
    expect(urlCalls()[1]).toContain('sort=uhid_asc');
  });

  it('Registered on header still sorts newest / oldest', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page([item()])));
    renderSearch(initialState({}, { sort: 'uhid_desc', col: 'uhid' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Sort by Registered on|Sort Registered on/i }),
    );
    await flush();
    expect(urlCalls()[0]).toContain('sort=newest');
    expect(window.location.search).toContain('col=registered');
  });
});

describe('PatientsSearch quick view link', () => {
  it('the name link in the quick view looks like the table name links', () => {
    renderSearch(initialState({ result: page([item()]) }));
    const tableLink = screen.getByRole('link', { name: 'Mock Alpha' });
    fireEvent.click(screen.getByText('NREG0001'));
    const links = screen.getAllByRole('link', { name: 'Mock Alpha' });
    expect(links).toHaveLength(2);
    const quickLink = links.find((link) => link !== tableLink)!;
    expect(quickLink.className).toBe(tableLink.className);
  });
});
