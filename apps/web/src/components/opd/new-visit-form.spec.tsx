import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NewVisitForm } from '@/components/opd/new-visit-form';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { OPD_PREVIEW_API, OPD_VISITS_API } from '@/lib/opd/client';
import type { OpdDoctor, VisitPreview } from '@/lib/opd/types';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn(), refresh: jest.fn() }),
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

const copy = staffCopy.opd.newVisit;
const fetchMock = jest.fn();

const patient = { id: 'p1', name: 'Ravi Kumar', uhid: 'NHEL0001' };

const doctors: OpdDoctor[] = [
  {
    id: 'd1',
    code: 'DR001',
    name: 'Dr Meena',
    department: 'General',
    available: true,
    unavailableReason: null,
    outsideTimings: false,
    feeNewPaise: 50_000,
    feeFollowUpPaise: 30_000,
  },
  {
    id: 'd2',
    code: 'DR002',
    name: 'Dr Rao',
    department: null,
    available: false,
    unavailableReason: 'SWITCH_OFF',
    outsideTimings: false,
    feeNewPaise: 40_000,
    feeFollowUpPaise: null,
  },
  {
    id: 'd3',
    code: 'DR003',
    name: 'Dr Iyer',
    department: 'Skin',
    available: true,
    unavailableReason: null,
    outsideTimings: true,
    feeNewPaise: 80_000,
    feeFollowUpPaise: 45_000,
  },
];

function previewFor(total: number, extra: Partial<VisitPreview> = {}): VisitPreview {
  return {
    visitType: 'NEW',
    visitDate: '2026-11-18',
    doctor: { id: 'd1', code: 'DR001', name: 'Dr Meena' },
    lines: [
      {
        kind: 'CONSULTATION',
        code: 'DR001',
        description: 'Dr Meena',
        quantity: 1,
        unitPricePaise: 50_000,
        lineTotalPaise: 50_000,
        pricingNote: null,
      },
      {
        kind: 'REGISTRATION',
        code: 'REG',
        description: 'Registration',
        quantity: 1,
        unitPricePaise: total - 50_000,
        lineTotalPaise: total - 50_000,
        pricingNote: null,
      },
    ],
    totalPaise: total,
    followUpFree: false,
    repeatVisitFree: false,
    registrationIncluded: true,
    sameDayVisitWithDoctor: false,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

type Handlers = {
  preview?: (body: Record<string, unknown>, call: number) => unknown;
  create?: (body: Record<string, unknown>, call: number) => unknown;
};

function route(handlers: Handlers) {
  let previews = 0;
  let creates = 0;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === OPD_PREVIEW_API) {
      previews += 1;
      return handlers.preview?.(body, previews) ?? jsonResponse(previewFor(60_000));
    }
    if (url === OPD_VISITS_API) {
      creates += 1;
      return handlers.create?.(body, creates) ?? jsonResponse({ id: 'visit-1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const calls = (url: string) =>
  fetchMock.mock.calls
    .filter((c) => c[0] === url)
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)));

const payButton = () => screen.getByRole('button', { name: /Take cash|Create visit|Saving/ });

async function chooseDoctor(name: string) {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
  await waitFor(() => expect(screen.queryByText(copy.billLoading)).toBeNull());
}

beforeEach(() => {
  fetchMock.mockReset();
  pushMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('NewVisitForm', () => {
  it('lists the doctors with fees; an unavailable doctor is disabled and says so', () => {
    route({});
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    expect(screen.getByText(`${copy.feeCaption}: ${formatPaise(50_000)}`)).toBeTruthy();
    expect(screen.getByText(`${copy.feeCaption}: ${formatPaise(80_000)}`)).toBeTruthy();
    expect(screen.getByText(copy.doctorUnavailable)).toBeTruthy();
    expect(screen.getByText(copy.doctorOutsideTimings)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Dr Rao/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Dr Meena/ }) as HTMLInputElement).disabled).toBe(
      false,
    );
    // Nothing is chosen yet: no bill, no way to pay, no request.
    expect(screen.getByText(copy.billEmpty)).toBeTruthy();
    expect((payButton() as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the fee of the chosen visit type; a missing fee is shown as a dash, not as zero', () => {
    route({});
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    fireEvent.click(screen.getByRole('radio', { name: copy.typeFollowUp }));
    expect(screen.getByText(`${copy.feeCaption}: ${formatPaise(30_000)}`)).toBeTruthy();
    expect(screen.getByText(`${copy.feeCaption}: —`)).toBeTruthy();
  });

  it('choosing a doctor asks the server for the bill and shows its lines and total', async () => {
    route({ preview: () => jsonResponse(previewFor(60_000)) });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    fireEvent.click(screen.getByRole('radio', { name: /Dr Meena/ }));
    expect(screen.getByText(copy.billLoading)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(formatPaise(60_000))).toBeTruthy());
    expect(calls(OPD_PREVIEW_API)).toEqual([
      { patientId: 'p1', doctorProfileId: 'd1', visitType: 'NEW' },
    ]);
    expect(screen.getByText(`${copy.lineConsultation} · Dr Meena`)).toBeTruthy();
    expect(screen.getByText(copy.lineRegistration)).toBeTruthy();
    expect(payButton().textContent).toBe(copy.takeCash.replace('{amount}', formatPaise(60_000)));
    expect((payButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('changing the visit type asks again', async () => {
    route({});
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(screen.getByRole('radio', { name: copy.typeFollowUp }));
    await waitFor(() => expect(calls(OPD_PREVIEW_API)).toHaveLength(2));
    expect(calls(OPD_PREVIEW_API)[1]).toMatchObject({ visitType: 'FOLLOW_UP' });
  });

  it('TAKE CASH sends the shown total and one key, then opens the receipt', async () => {
    route({});
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/opd/visits/visit-1/receipt'));
    const [sent] = calls(OPD_VISITS_API);
    expect(sent).toMatchObject({
      patientId: 'p1',
      doctorProfileId: 'd1',
      visitType: 'NEW',
      expectedTotalPaise: 60_000,
    });
    expect(sent.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
    // No branch, amount or status field is ever sent.
    expect(Object.keys(sent).sort()).toEqual(
      ['doctorProfileId', 'expectedTotalPaise', 'idempotencyKey', 'patientId', 'visitType'].sort(),
    );
    // The screen stays locked while it moves on (no second click can bill again).
    expect((payButton() as HTMLButtonElement).disabled).toBe(true);
    expect(payButton().textContent).toBe(copy.saving);
  });

  it('a DOUBLE CLICK makes one request', async () => {
    let release!: (value: unknown) => void;
    route({ create: () => new Promise((resolve) => (release = resolve)) });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    const button = payButton();
    // Three clicks in ONE batch: the screen has not re-rendered (button not yet disabled), exactly
    // like a fast double click in a real browser. Only the in-flight guard can stop them.
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    expect(calls(OPD_VISITS_API)).toHaveLength(1);
    await act(async () => release(jsonResponse({ id: 'visit-1' })));
    expect(calls(OPD_VISITS_API)).toHaveLength(1);
  });

  it('a retry after a network failure reuses the SAME key (cannot bill twice)', async () => {
    route({
      create: (_body, call) => {
        if (call === 1) {
          throw new Error('offline');
        }
        return jsonResponse({ id: 'visit-1' });
      },
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    expect((await screen.findByRole('alert')).textContent).toBe(staffCopy.errors.unreachable);
    expect((payButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [first, second] = calls(OPD_VISITS_API);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('a different choice gets a NEW key', async () => {
    route({
      create: (_body, call) => {
        if (call === 1) {
          throw new Error('offline');
        }
        return jsonResponse({ id: 'visit-1' });
      },
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    await screen.findByRole('alert');
    await chooseDoctor('Dr Iyer');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [first, second] = calls(OPD_VISITS_API);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.doctorProfileId).toBe('d3');
  });

  it('a slow old preview never overwrites a newer one (out-of-order answers)', async () => {
    let releaseFirst!: (value: unknown) => void;
    route({
      preview: (body) =>
        body.doctorProfileId === 'd1'
          ? new Promise((resolve) => (releaseFirst = resolve))
          : jsonResponse(previewFor(95_000)),
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    fireEvent.click(screen.getByRole('radio', { name: /Dr Meena/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Dr Iyer/ }));
    await waitFor(() => expect(screen.getByText(formatPaise(95_000))).toBeTruthy());
    // The first (slow) answer arrives last, but belongs to a choice that is no longer current.
    await act(async () => releaseFirst(jsonResponse(previewFor(60_000))));
    expect(screen.getByText(formatPaise(95_000))).toBeTruthy();
    expect(screen.queryByText(formatPaise(60_000))).toBeNull();
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(calls(OPD_VISITS_API)[0]).toMatchObject({
      doctorProfileId: 'd3',
      expectedTotalPaise: 95_000,
    });
  });

  it('an expired session is renewed silently and the payment is retried with the SAME key and total', async () => {
    let creates = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === OPD_PREVIEW_API) {
        return jsonResponse(previewFor(60_000));
      }
      if (url === '/api/auth/refresh-session') {
        return jsonResponse({ ok: true });
      }
      if (url === OPD_VISITS_API) {
        creates += 1;
        return creates === 1
          ? jsonResponse({ code: 'SESSION_EXPIRED' }, 401)
          : jsonResponse({ id: 'visit-1', body: JSON.parse(String(init.body)) });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const [first, second] = calls(OPD_VISITS_API);
    expect(second).toEqual(first);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('PRICE_CHANGED: nothing is collected, the new total is shown, the next click uses a new key and the new total', async () => {
    route({
      preview: (_body, call) => jsonResponse(previewFor(call === 1 ? 60_000 : 65_000)),
      create: (_body, call) =>
        call === 1
          ? jsonResponse({ code: 'PRICE_CHANGED', totalPaise: 65_000 }, 409)
          : jsonResponse({ id: 'visit-1' }),
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    expect((await screen.findByRole('alert')).textContent).toBe(staffCopy.opd.errors.PRICE_CHANGED);
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(formatPaise(65_000))).toBeTruthy());
    expect(payButton().textContent).toBe(copy.takeCash.replace('{amount}', formatPaise(65_000)));
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [first, second] = calls(OPD_VISITS_API);
    expect(first.expectedTotalPaise).toBe(60_000);
    expect(second.expectedTotalPaise).toBe(65_000);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('shows the API refusals in plain words and keeps the screen usable', async () => {
    route({
      create: () => jsonResponse({ code: 'DOCTOR_UNAVAILABLE', reason: 'SWITCH_OFF' }, 400),
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      staffCopy.opd.errors.DOCTOR_UNAVAILABLE,
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect((payButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a stale tab (another tab switched branch) gets the branch message, never a charge', async () => {
    route({ create: () => jsonResponse({ code: 'BRANCH_CHANGED' }, 409) });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    fireEvent.click(payButton());
    expect((await screen.findByRole('alert')).textContent).toBe(staffCopy.errors.branchChanged);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a preview that fails shows why and keeps the pay button off', async () => {
    route({ preview: () => jsonResponse({ code: 'FEE_NOT_CONFIGURED' }, 409) });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    fireEvent.click(screen.getByRole('radio', { name: /Dr Meena/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      staffCopy.opd.errors.FEE_NOT_CONFIGURED,
    );
    expect((payButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(payButton());
    expect(calls(OPD_VISITS_API)).toHaveLength(0);
  });

  it('a free repeat visit says so (not "follow-up") and creates the visit with nothing to pay', async () => {
    route({
      preview: () =>
        jsonResponse(
          previewFor(0, {
            repeatVisitFree: true,
            registrationIncluded: false,
            lines: [
              {
                kind: 'CONSULTATION',
                code: 'DR001',
                description: 'Dr Meena',
                quantity: 1,
                unitPricePaise: 0,
                lineTotalPaise: 0,
                pricingNote: 'REPEAT_VISIT_FREE_WINDOW',
              },
            ],
          }),
        ),
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    expect(screen.getByText(copy.freeRepeatVisit)).toBeTruthy();
    expect(screen.queryByText(copy.freeFollowUp)).toBeNull();
    expect(payButton().textContent).toBe(copy.createFree);
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(calls(OPD_VISITS_API)[0]).toMatchObject({ expectedTotalPaise: 0, visitType: 'NEW' });
  });

  it('a free follow-up says so and creates the visit with nothing to pay (zero total is sent)', async () => {
    route({
      preview: () =>
        jsonResponse(
          previewFor(0, {
            visitType: 'FOLLOW_UP',
            followUpFree: true,
            registrationIncluded: false,
            lines: [
              {
                kind: 'CONSULTATION',
                code: 'DR001',
                description: 'Dr Meena',
                quantity: 1,
                unitPricePaise: 0,
                lineTotalPaise: 0,
                pricingNote: 'FOLLOW_UP_FREE_WINDOW',
              },
            ],
          }),
        ),
    });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    fireEvent.click(screen.getByRole('radio', { name: copy.typeFollowUp }));
    await chooseDoctor('Dr Meena');
    expect(screen.getByText(copy.freeFollowUp)).toBeTruthy();
    expect(payButton().textContent).toBe(copy.createFree);
    fireEvent.click(payButton());
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(calls(OPD_VISITS_API)[0]).toMatchObject({
      expectedTotalPaise: 0,
      visitType: 'FOLLOW_UP',
    });
  });

  it('warns when the patient already has a visit with this doctor today (but does not block)', async () => {
    route({ preview: () => jsonResponse(previewFor(60_000, { sameDayVisitWithDoctor: true })) });
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    await chooseDoctor('Dr Meena');
    expect(screen.getByText(copy.sameDayWarning)).toBeTruthy();
    expect((payButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('with no doctors it says so; Cancel returns to the patient record', () => {
    route({});
    const { unmount } = render(<NewVisitForm patient={patient} doctors={[]} />);
    expect(screen.getByText(copy.noDoctors)).toBeTruthy();
    unmount();
    render(<NewVisitForm patient={patient} doctors={doctors} />);
    expect(screen.getByRole('link', { name: copy.cancel }).getAttribute('href')).toBe(
      '/app/patients/p1',
    );
  });
});
