import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { VitalsForm } from '@/components/opd/vitals-form';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { POSTURE, PULSE, makeReading, makeVisit } from '@/lib/opd/clinical-test-fixtures';
import type { VitalsReadingView } from '@/lib/opd/clinical-types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.clinical.vitals;
const fetchMock = jest.fn();
const URL_VITALS = '/api/staff/opd/visits/visit-1/vitals';

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const posted = () => JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));

function renderForm(initial: VitalsReadingView[] = [], canWrite = true) {
  return render(
    <VitalsForm
      visit={makeVisit()}
      fields={[PULSE, POSTURE]}
      initial={initial}
      canWrite={canWrite}
      backHref="/app/opd"
    />,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
  });

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('VitalsForm', () => {
  it('shows each field with its current value, the warning flag and the correction history', () => {
    const who = { id: 'u2', name: 'Nurse Two' };
    renderForm([
      makeReading({
        value: 130,
        version: 2,
        outOfRange: true,
        history: [
          ...makeReading().history,
          {
            version: 2,
            value: 130,
            correctionReason: 'wrong finger',
            recordedAt: '2026-11-19T04:30:00.000Z',
            recordedBy: who,
          },
        ],
      }),
    ]);
    expect(screen.getByText('Pulse (bpm)')).toBeTruthy();
    expect(screen.getByText(`${copy.current}: 130 bpm`)).toBeTruthy();
    expect(screen.getByText(copy.outOfRange)).toBeTruthy();
    expect(screen.getByText(`${copy.current}: ${copy.notRecorded}`)).toBeTruthy();
    expect(screen.getByText(/Version 2: 130 by Nurse Two/)).toBeTruthy();
    expect(screen.getByText(/Reason: wrong finger/)).toBeTruthy();
  });

  it('puts all the fields in one grid (no long single column)', () => {
    const { container } = renderForm();
    const grid = container.querySelector('.vitals-grid');
    expect(grid).not.toBeNull();
    expect(grid!.children).toHaveLength(2);
  });

  it('records a first reading without a reason and shows it afterwards', async () => {
    fetchMock.mockResolvedValue(
      json({
        recorded: ['pulse'],
        corrected: [],
        unchanged: [],
        visit: makeVisit(),
        fields: [makeReading({ value: 88 })],
      }),
    );
    renderForm();
    type('Pulse: New value', '88');
    expect(screen.queryByLabelText('Pulse: Reason for the change')).toBeNull();
    await save();
    expect(fetchMock.mock.calls[0]![0]).toBe(URL_VITALS);
    expect(posted()).toEqual({ readings: [{ fieldCode: 'pulse', value: 88 }] });
    expect(screen.getByText(copy.saved)).toBeTruthy();
    expect(screen.getByText(`${copy.current}: 88 bpm`)).toBeTruthy();
    expect((screen.getByLabelText('Pulse: New value') as HTMLInputElement).value).toBe('');
  });

  it('changing an existing reading asks for a reason and sends nothing without it', async () => {
    fetchMock.mockResolvedValue(
      json({
        recorded: [],
        corrected: ['pulse'],
        unchanged: [],
        visit: makeVisit(),
        fields: [makeReading({ value: 80, version: 2 })],
      }),
    );
    renderForm([makeReading()]);
    type('Pulse: New value', '80');
    expect(screen.getByLabelText('Pulse: Reason for the change')).toBeTruthy();
    await save();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(copy.needsReason)).toBeTruthy();
    type('Pulse: Reason for the change', ' wrong finger ');
    await save();
    expect(posted()).toEqual({
      readings: [{ fieldCode: 'pulse', value: 80, correctionReason: 'wrong finger' }],
    });
    expect(screen.getByText(`${copy.current}: 80 bpm`)).toBeTruthy();
  });

  it('sends nothing for the same value, a blank form, or an invalid number', async () => {
    renderForm([makeReading()]);
    await save();
    expect(screen.getByText(copy.nothingToSave)).toBeTruthy();
    type('Pulse: New value', '72');
    await save();
    expect(screen.getByText(copy.nothingToSave)).toBeTruthy();
    type('Pulse: New value', 'abc');
    await save();
    expect(screen.getByText(copy.invalidValue)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the API refusal in plain words and keeps what was typed', async () => {
    fetchMock.mockResolvedValue(json({ code: 'VITALS_VISIT_NOT_OPEN' }, 409));
    renderForm();
    type('Pulse: New value', '70');
    await save();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.VITALS_VISIT_NOT_OPEN);
    expect((screen.getByLabelText('Pulse: New value') as HTMLInputElement).value).toBe('70');
  });

  it('a double click sends one request', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderForm();
    type('Pulse: New value', '70');
    const button = screen.getByRole('button', { name: copy.save });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(
        json({ recorded: ['pulse'], corrected: [], unchanged: [], visit: makeVisit(), fields: [] }),
      );
    });
  });

  it('without write permission there are no boxes and no save button', () => {
    renderForm([makeReading()], false);
    expect(screen.getByText(copy.readOnlyNote)).toBeTruthy();
    expect(screen.queryByLabelText('Pulse: New value')).toBeNull();
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
    expect(screen.getByText(`${copy.current}: 72 bpm`)).toBeTruthy();
  });

  it('says so when the hospital has no vitals fields', () => {
    render(
      <VitalsForm visit={makeVisit()} fields={[]} initial={[]} canWrite backHref="/app/opd" />,
    );
    expect(screen.getByText(copy.noFieldsTitle)).toBeTruthy();
  });
});
