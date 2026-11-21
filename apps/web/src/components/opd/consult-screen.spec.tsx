import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConsultScreen } from '@/components/opd/consult-screen';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { makeConsult, makeNote, makeReading, makeVisit } from '@/lib/opd/clinical-test-fixtures';
import type { ConsultationResponse, VitalsReadingView } from '@/lib/opd/clinical-types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.clinical.consult;
const fetchMock = jest.fn();
const AUTOSAVE_MS = 5000;
const settings = {
  autosaveSeconds: 5,
  minChars: 2,
  debounceMs: 300,
  limit: 10,
  calendarWeekStart: 1,
  followUpQuickDays: [1, 3, 7],
};
const url = (tail: string) => `/api/staff/opd/visits/visit-1${tail}`;

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const started = () =>
  makeVisit({ status: 'IN_CONSULTATION', consultationStartedAt: '2026-11-19T04:10:00.000Z' });
const finished = () => makeVisit({ status: 'COMPLETED', completedAt: '2026-11-19T04:30:00.000Z' });

type Handler = (body: Record<string, unknown>) => unknown;
function api(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected fetch ${key}`);
    }
    return handler(init?.body ? JSON.parse(String(init.body)) : {});
  });
}
const okNote = () => json(makeConsult({ visit: started(), consultation: makeNote() }));
const sent = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`);
const bodyOf = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));

function renderScreen(
  over: {
    initial?: ConsultationResponse;
    vitals?: VitalsReadingView[];
    canWrite?: boolean;
    canRecordVitals?: boolean;
  } = {},
) {
  return render(
    <ConsultScreen
      initial={over.initial ?? makeConsult({ visit: started(), consultation: makeNote() })}
      vitals={over.vitals ?? []}
      canWrite={over.canWrite ?? true}
      canRecordVitals={over.canRecordVitals ?? true}
      settings={settings}
      backHref="/app/opd"
    >
      <p>previous-section</p>
    </ConsultScreen>,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });

// The prescription starts with one empty line: switch it to a typed (unlisted) name and fill it.
function addFreeRow(over: { name?: string; dose?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: staffCopy.opd.clinical.rx.useFree }));
  type('Medicine 1: Medicine name', over.name ?? 'Tulsi drops');
  type('Medicine 1: Dose', over.dose ?? '5 drops');
  type('Medicine 1: Frequency', 'morning');
  type('Medicine 1: Duration', '7 days');
}

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('starting', () => {
  it('a waiting visit shows Start; clicking it opens the note for typing', async () => {
    api({ [`POST ${url('/start')}`]: () => json({ replayed: false, visit: started() }) });
    renderScreen({ initial: makeConsult() });
    expect(screen.getByText(copy.waitingNote)).toBeTruthy();
    expect(screen.queryByLabelText(copy.complaints)).toBeNull();
    await click(copy.start);
    expect(sent()).toEqual([`POST ${url('/start')}`]);
    expect(screen.getByLabelText(copy.complaints)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.start })).toBeNull();
  });

  it('two clicks on Start send one request', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderScreen({ initial: makeConsult() });
    const button = screen.getByRole('button', { name: copy.start });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(json({ replayed: false, visit: started() }));
    });
  });

  it("shows the API's refusal in plain words", async () => {
    api({ [`POST ${url('/start')}`]: () => json({ code: 'VISIT_NOT_WAITING' }, 409) });
    renderScreen({ initial: makeConsult() });
    await click(copy.start);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.VISIT_NOT_WAITING);
    expect(screen.queryByLabelText(copy.complaints)).toBeNull();
  });

  it('a user who may only read sees a note instead of the Start button', () => {
    renderScreen({ initial: makeConsult(), canWrite: false });
    expect(screen.getByText(copy.notStartedReadOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.start })).toBeNull();
  });
});

describe('automatic saving', () => {
  it('saves the note a few seconds after the last keystroke, not before', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    type(copy.complaints, 'fever for 3 days');
    await wait(AUTOSAVE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(copy.saveStatusUnsaved)).toBeTruthy();
    await wait(1);
    expect(sent()).toEqual([`PUT ${url('/consultation')}`]);
    expect(bodyOf(0)).toEqual({ complaints: 'fever for 3 days' });
    expect(screen.getByText(/Saved at/)).toBeTruthy();
  });

  it('keeps waiting while typing continues (one save, with the latest text)', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    for (const text of ['f', 'fe', 'fev', 'fever']) {
      type(copy.complaints, text);
      await wait(AUTOSAVE_MS - 500);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await wait(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toEqual({ complaints: 'fever' });
  });

  it('saves only what changed: the note alone, then the prescription alone', async () => {
    api({
      [`PUT ${url('/consultation')}`]: okNote,
      [`PUT ${url('/prescription')}`]: okNote,
    });
    renderScreen();
    type(copy.diagnosis, 'viral fever');
    await wait(AUTOSAVE_MS);
    expect(sent()).toEqual([`PUT ${url('/consultation')}`]);
    addFreeRow();
    await wait(AUTOSAVE_MS);
    expect(sent()).toEqual([`PUT ${url('/consultation')}`, `PUT ${url('/prescription')}`]);
    expect(bodyOf(1)).toEqual({
      items: [
        { medicineName: 'Tulsi drops', dose: '5 drops', frequency: 'morning', duration: '7 days' },
      ],
    });
  });

  it('an unfinished medicine row is not saved and is announced', async () => {
    api({ [`PUT ${url('/prescription')}`]: okNote });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: staffCopy.opd.clinical.rx.useFree }));
    type('Medicine 1: Medicine name', 'Tulsi drops');
    await wait(AUTOSAVE_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('1 unfinished medicine row(s) are not saved yet.')).toBeTruthy();
  });

  it('Save draft saves at once without waiting', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    type(copy.advice, 'rest');
    await click(copy.saveDraft);
    expect(sent()).toEqual([`PUT ${url('/consultation')}`]);
    expect(bodyOf(0)).toEqual({ advice: 'rest' });
  });

  it('a failed save is shown and tried again; the text stays on screen', async () => {
    let calls = 0;
    api({
      [`PUT ${url('/consultation')}`]: () => {
        calls += 1;
        return calls === 1 ? json({ code: 'UNAVAILABLE' }, 503) : okNote();
      },
    });
    renderScreen();
    type(copy.complaints, 'cough');
    await wait(AUTOSAVE_MS);
    expect(screen.getByText(copy.saveStatusError)).toBeTruthy();
    expect((screen.getByLabelText(copy.complaints) as HTMLTextAreaElement).value).toBe('cough');
    await wait(AUTOSAVE_MS);
    expect(calls).toBe(2);
    expect(screen.getByText(/Saved at/)).toBeTruthy();
  });

  it('nothing is saved for a completed, waiting or read-only consultation', async () => {
    api({});
    const { unmount } = renderScreen({
      initial: makeConsult({
        visit: finished(),
        consultation: makeNote({ status: 'COMPLETED', diagnosis: 'x' }),
      }),
    });
    await wait(AUTOSAVE_MS * 3);
    unmount();
    renderScreen({ canWrite: false });
    await wait(AUTOSAVE_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaving the screen cancels a pending save timer', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    const { unmount } = renderScreen();
    type(copy.complaints, 'cough');
    unmount();
    await wait(AUTOSAVE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns before the tab is closed while something is unsaved, and stops once saved', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(false);
    type(copy.complaints, 'cough');
    expect(closing()).toBe(true);
    await wait(AUTOSAVE_MS);
    expect(closing()).toBe(false);
  });
});

describe('the note boxes and the calendar', () => {
  it('the follow-up date is chosen on the calendar (quick pick) and saved with the note', async () => {
    jest.setSystemTime(new Date(2026, 10, 19, 10, 0));
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    expect(screen.getByLabelText(copy.followUpDate).textContent).toBe(
      staffCopy.calendar.placeholder,
    );
    fireEvent.click(screen.getByLabelText(copy.followUpDate));
    fireEvent.click(screen.getByRole('button', { name: 'In 3 days' }));
    expect(screen.getByLabelText(copy.followUpDate).textContent).toBe('22 Nov 2026');
    await wait(AUTOSAVE_MS);
    expect(bodyOf(0)).toEqual({ followUpDate: '2026-11-22' });
  });

  it('days before the visit day cannot be chosen as the follow-up date', () => {
    jest.setSystemTime(new Date(2026, 10, 19, 10, 0));
    renderScreen();
    fireEvent.click(screen.getByLabelText(copy.followUpDate));
    expect(
      (screen.getByRole('button', { name: /Wednesday, 18 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Thursday, 19 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('the prescription starts with one empty line ready for typing, and an empty line is never saved', async () => {
    api({});
    renderScreen();
    expect(screen.getByLabelText('Medicine 1: Search medicine')).toBeTruthy();
    expect(screen.getByLabelText('Medicine 1: Dose')).toBeTruthy();
    await wait(AUTOSAVE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('completing', () => {
  it('refuses without complaints or diagnosis and sends nothing', async () => {
    api({});
    renderScreen();
    await click(copy.complete);
    expect(screen.getByRole('alert').textContent).toBe(copy.needsText);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses while a medicine row is unfinished (nothing is dropped silently)', async () => {
    api({ [`PUT ${url('/consultation')}`]: okNote });
    renderScreen();
    type(copy.diagnosis, 'cold');
    fireEvent.click(screen.getByRole('button', { name: staffCopy.opd.clinical.rx.useFree }));
    type('Medicine 1: Medicine name', 'Tulsi drops');
    await click(copy.complete);
    expect(screen.getByRole('alert').textContent).toBe(copy.incompleteRows);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the latest text FIRST, then completes, and the screen becomes read-only', async () => {
    api({
      [`PUT ${url('/consultation')}`]: okNote,
      [`PUT ${url('/prescription')}`]: okNote,
      [`POST ${url('/complete')}`]: () =>
        json({
          replayed: false,
          visit: finished(),
          consultation: makeNote({
            status: 'COMPLETED',
            diagnosis: 'viral fever',
            completedAt: '2026-11-19T04:30:00.000Z',
          }),
          prescription: [
            {
              lineNo: 1,
              medicineId: null,
              medicineName: 'Tulsi drops',
              isUnlisted: true,
              dose: '5 drops',
              frequency: 'morning',
              duration: '7 days',
              instructions: null,
            },
          ],
          addenda: [],
        }),
    });
    renderScreen();
    type(copy.diagnosis, 'viral fever');
    addFreeRow();
    // Complete clicked long before the 5 seconds are over.
    await click(copy.complete);
    expect(sent()).toEqual([
      `PUT ${url('/consultation')}`,
      `PUT ${url('/prescription')}`,
      `POST ${url('/complete')}`,
    ]);
    expect(bodyOf(0)).toEqual({ diagnosis: 'viral fever' });
    expect(screen.getByText(copy.completedBanner)).toBeTruthy();
    expect(screen.queryByLabelText(copy.complaints)).toBeNull();
    expect(screen.getByText('viral fever')).toBeTruthy();
    expect(screen.getByText('Tulsi drops')).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.complete })).toBeNull();
    expect(screen.getByText(staffCopy.opd.clinical.addenda.heading)).toBeTruthy();
  });

  it('does not complete when the save before it fails', async () => {
    api({ [`PUT ${url('/consultation')}`]: () => json({ code: 'UNAVAILABLE' }, 503) });
    renderScreen();
    type(copy.diagnosis, 'cold');
    await click(copy.complete);
    expect(screen.getByRole('alert').textContent).toBe(copy.saveStatusError);
    expect(sent()).toEqual([`PUT ${url('/consultation')}`]);
    expect((screen.getByLabelText(copy.diagnosis) as HTMLTextAreaElement).value).toBe('cold');
  });

  it("shows the API's refusal when completing is refused", async () => {
    api({
      [`PUT ${url('/consultation')}`]: okNote,
      [`POST ${url('/complete')}`]: () => json({ code: 'NOTE_EMPTY' }, 400),
    });
    renderScreen();
    type(copy.diagnosis, 'cold');
    await click(copy.complete);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.NOTE_EMPTY);
    expect(screen.getByLabelText(copy.diagnosis)).toBeTruthy();
  });

  it('two clicks on Complete send one complete request', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
      if (init.method === 'POST') {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return okNote();
    });
    renderScreen();
    type(copy.diagnosis, 'cold');
    const button = screen.getByRole('button', { name: copy.complete });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(sent().filter((s) => s.startsWith('POST'))).toHaveLength(1);
    await act(async () => {
      release(
        json({
          replayed: false,
          visit: finished(),
          consultation: makeNote({ status: 'COMPLETED', diagnosis: 'cold' }),
          prescription: [],
          addenda: [],
        }),
      );
    });
  });
});

describe('after completion', () => {
  const completedConsult = () =>
    makeConsult({
      visit: finished(),
      consultation: makeNote({
        status: 'COMPLETED',
        complaints: 'fever',
        diagnosis: 'viral fever',
        completedAt: '2026-11-19T04:30:00.000Z',
      }),
      addenda: [
        {
          id: 'a1',
          text: 'Allergy to penicillin',
          reason: 'missed earlier',
          addedBy: { id: 'u1', name: 'Dr Meena' },
          createdAt: '2026-11-19T05:00:00.000Z',
        },
      ],
    });

  it('shows the note as plain text and the addenda with who and why', () => {
    renderScreen({ initial: completedConsult() });
    expect(screen.getByText(copy.completedBanner)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: copy.complaints })).toBeNull();
    expect(screen.getByText('viral fever')).toBeTruthy();
    expect(screen.getByText('Allergy to penicillin')).toBeTruthy();
    expect(screen.getByText(/Reason: missed earlier/)).toBeTruthy();
    expect(screen.getByText(/Dr Meena on/)).toBeTruthy();
  });

  it('offers to print the prescription of a completed consultation, and not before', () => {
    const done = renderScreen({ initial: completedConsult() });
    const link = screen.getByRole('link', { name: staffCopy.print.prescription.print });
    expect(link.getAttribute('href')).toMatch(/^\/app\/opd\/visits\/[^/]+\/prescription$/);
    done.unmount();
    renderScreen();
    expect(screen.queryByRole('link', { name: staffCopy.print.prescription.print })).toBeNull();
  });

  it('the doctor can add an addendum; it needs both text and reason', async () => {
    api({
      [`POST ${url('/consultation/addenda')}`]: (body) =>
        json({
          ...completedConsult(),
          addenda: [
            ...completedConsult().addenda,
            {
              id: 'a2',
              text: String(body.text),
              reason: String(body.reason),
              addedBy: { id: 'u1', name: 'Dr Meena' },
              createdAt: '2026-11-19T06:00:00.000Z',
            },
          ],
        }),
    });
    renderScreen({ initial: completedConsult() });
    const add = () =>
      screen.getByRole('button', { name: staffCopy.opd.clinical.addenda.add }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    type(staffCopy.opd.clinical.addenda.text, 'Also diabetic');
    expect(add().disabled).toBe(true);
    type(staffCopy.opd.clinical.addenda.reason, 'history updated');
    await act(async () => {
      fireEvent.click(add());
    });
    expect(bodyOf(0)).toEqual({ text: 'Also diabetic', reason: 'history updated' });
    expect(screen.getByText('Also diabetic')).toBeTruthy();
    expect(
      (screen.getByLabelText(staffCopy.opd.clinical.addenda.text) as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('a reader (no write permission) sees the addenda but no form', () => {
    renderScreen({ initial: completedConsult(), canWrite: false });
    expect(screen.getByText('Allergy to penicillin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: staffCopy.opd.clinical.addenda.add })).toBeNull();
  });
});

describe('a reader during the consultation (nurse)', () => {
  it('sees the note read-only with no save or complete buttons', () => {
    renderScreen({
      initial: makeConsult({ visit: started(), consultation: makeNote({ complaints: 'fever' }) }),
      canWrite: false,
    });
    expect(screen.getByText(copy.readOnlyNote)).toBeTruthy();
    expect(screen.queryByLabelText(copy.complaints)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.complete })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.saveDraft })).toBeNull();
    expect(screen.getByText('fever')).toBeTruthy();
  });
});

describe('vitals and the rest of the page', () => {
  it('lists the vitals with the warning flag and links to editing only for those who may', () => {
    const { unmount } = renderScreen({
      vitals: [makeReading({ value: 130, outOfRange: true })],
    });
    expect(screen.getByText('130 bpm')).toBeTruthy();
    expect(screen.getByText(staffCopy.opd.clinical.vitals.outOfRange)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.vitalsEdit }).getAttribute('href')).toBe(
      '/app/opd/visits/visit-1/vitals',
    );
    unmount();
    renderScreen({ vitals: [], canRecordVitals: false });
    expect(screen.getByText(copy.vitalsEmpty)).toBeTruthy();
    expect(screen.queryByRole('link', { name: copy.vitalsEdit })).toBeNull();
  });

  it('shows the patient header, the previous visits section and a way back', () => {
    renderScreen();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('T7')).toBeTruthy();
    expect(screen.getByText('previous-section')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: copy.backToQueue }).length).toBeGreaterThan(0);
  });
});
