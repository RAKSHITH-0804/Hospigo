import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { PrescriptionEditor } from '@/components/opd/prescription-editor';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import { emptyRxRow, type RxDraft } from '@/lib/opd/prescription-draft';

const copy = staffCopy.opd.clinical.rx;
const fetchMock = jest.fn();
const search = { minChars: 2, debounceMs: 300, limit: 10 };

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const hit = {
  id: 'med-1',
  code: 'PARA',
  name: 'Paracetamol 500',
  composition: null,
  form: 'Tablet',
};

let latest: RxDraft[] = [];

function Harness({
  initial = [emptyRxRow(1)],
  readOnly = false,
}: {
  initial?: RxDraft[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<RxDraft[]>(initial);
  const next = useRef(100);
  latest = rows;
  return (
    <PrescriptionEditor
      rows={rows}
      onChange={setRows}
      nextId={() => next.current++}
      readOnly={readOnly}
      search={search}
    />
  );
}

const complete = (over: Partial<RxDraft> = {}): RxDraft => ({
  ...emptyRxRow(1),
  medicineId: 'med-1',
  medicineName: 'Paracetamol 500',
  dose: '1 tablet',
  frequency: 'twice a day',
  duration: '5 days',
  ...over,
});

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

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const settle = (ms = 400) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const addButton = () => screen.getByRole('button', { name: copy.add });

describe('PrescriptionEditor (one line per medicine)', () => {
  it('shows every part on one line with Add medicine right under the lines', () => {
    render(<Harness initial={[emptyRxRow(1), emptyRxRow(2)]} />);
    for (const n of [1, 2]) {
      for (const part of [
        copy.search,
        copy.dose,
        copy.frequency,
        copy.duration,
        copy.instructions,
      ]) {
        expect(screen.getByLabelText(`Medicine ${n}: ${part}`)).toBeTruthy();
      }
      expect(screen.getByRole('button', { name: `${copy.remove} ${n}` })).toBeTruthy();
    }
    const section = screen.getByRole('region', { name: copy.heading });
    const buttons = Array.from(section.querySelectorAll('button'));
    // The Add button is the last control: after every line, not up in the heading.
    expect(buttons.at(-1)).toBe(addButton());
  });

  it('Add medicine adds a line, but reuses a blank line instead of piling up empty ones', () => {
    render(<Harness initial={[complete()]} />);
    fireEvent.click(addButton());
    expect(latest).toHaveLength(2);
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    expect(latest).toHaveLength(2);
    expect(document.activeElement?.id).toBe('rx-100-medicine');
  });

  it('a mistaken line can be removed (even the only one) and Add brings one back', () => {
    render(<Harness initial={[complete(), complete({ id: 2, medicineName: 'B' })]} />);
    fireEvent.click(screen.getByRole('button', { name: `${copy.remove} 2` }));
    expect(latest.map((r) => r.id)).toEqual([1]);
    fireEvent.click(screen.getByRole('button', { name: `${copy.remove} 1` }));
    expect(latest).toEqual([]);
    expect(screen.getByText(copy.empty)).toBeTruthy();
    fireEvent.click(addButton());
    expect(latest).toHaveLength(1);
  });

  it('types an unlisted medicine (free text) and can go back to the medicine list', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: copy.useFree }));
    type('Medicine 1: Medicine name', 'Tulsi drops');
    type('Medicine 1: Dose', '5 drops');
    expect(latest[0]).toMatchObject({ mode: 'FREE', medicineName: 'Tulsi drops', dose: '5 drops' });
    expect(screen.getByText('Still needed: frequency, duration.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.useList }));
    expect(latest[0]).toMatchObject({ mode: 'LISTED', medicineId: null, medicineName: '' });
    expect(screen.getByLabelText('Medicine 1: Search medicine')).toBeTruthy();
  });

  it('searches the list after a pause (not for one letter), picks a medicine and can change it', async () => {
    fetchMock.mockResolvedValue(json({ items: [hit] }));
    render(<Harness />);
    type('Medicine 1: Search medicine', 'P');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    type('Medicine 1: Search medicine', 'Para');
    await settle(299);
    expect(fetchMock).not.toHaveBeenCalled();
    await settle(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/staff/opd/medicines?q=Para&limit=10');
    fireEvent.click(screen.getByRole('button', { name: /Paracetamol 500 · Tablet/ }));
    expect(latest[0]).toMatchObject({ medicineId: 'med-1', medicineName: 'Paracetamol 500' });
    expect(screen.getByText('Paracetamol 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `${copy.change} 1` }));
    expect(latest[0]).toMatchObject({ medicineId: null, medicineName: '' });
  });

  it('typing again cancels the earlier search (only the last text is searched)', async () => {
    fetchMock.mockResolvedValue(json({ items: [] }));
    render(<Harness />);
    type('Medicine 1: Search medicine', 'Par');
    await settle(200);
    type('Medicine 1: Search medicine', 'Paracet');
    await settle(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('q=Paracet&');
    expect(screen.getByText(copy.searchNone)).toBeTruthy();
  });

  it('says so when the search fails', async () => {
    fetchMock.mockResolvedValue(json({ code: 'UNAVAILABLE' }, 503));
    render(<Harness />);
    type('Medicine 1: Search medicine', 'Para');
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(copy.searchError);
  });

  it('a medicine that is not in the list can be used as typed: one click turns the typed text into an unlisted line', async () => {
    fetchMock.mockResolvedValue(json({ items: [] }));
    render(<Harness />);
    type('Medicine 1: Search medicine', 'Tab 1');
    await settle();
    expect(screen.getByText(copy.searchNone)).toBeTruthy();
    // the line is unfinished and says exactly why
    expect(
      screen.getByText(
        'Still needed: the medicine (pick it from the list or use it as typed), dose, frequency, duration.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use “Tab 1” as typed (unlisted)' }));
    expect(latest[0]).toMatchObject({
      mode: 'FREE',
      medicineId: null,
      medicineName: 'Tab 1',
      search: '',
    });
    expect((screen.getByLabelText('Medicine 1: Medicine name') as HTMLInputElement).value).toBe(
      'Tab 1',
    );
    type('Medicine 1: Dose', '1');
    type('Medicine 1: Frequency', '2');
    type('Medicine 1: Duration', '5');
    expect(screen.queryByText(/Still needed/)).toBeNull();
  });

  it('the text typed in the search box is kept when switching to "type the name" and back', () => {
    render(<Harness />);
    type('Medicine 1: Search medicine', 'Tab 1');
    fireEvent.click(screen.getByRole('button', { name: copy.useFree }));
    expect((screen.getByLabelText('Medicine 1: Medicine name') as HTMLInputElement).value).toBe(
      'Tab 1',
    );
    fireEvent.click(screen.getByRole('button', { name: copy.useList }));
    expect((screen.getByLabelText('Medicine 1: Search medicine') as HTMLInputElement).value).toBe(
      'Tab 1',
    );
  });

  it('the missing-parts message shrinks as the line is filled and disappears when it is finished', () => {
    render(<Harness initial={[complete({ dose: '', frequency: '', duration: '' })]} />);
    expect(screen.getByText('Still needed: dose, frequency, duration.')).toBeTruthy();
    type('Medicine 1: Dose', '1');
    expect(screen.getByText('Still needed: frequency, duration.')).toBeTruthy();
    type('Medicine 1: Frequency', '2');
    type('Medicine 1: Duration', '3');
    expect(screen.queryByText(/Still needed/)).toBeNull();
  });

  it('Enter in the last finished line starts the next line; not in an unfinished or earlier line', () => {
    render(<Harness initial={[complete(), complete({ id: 2, medicineName: 'B' })]} />);
    fireEvent.keyDown(screen.getByLabelText('Medicine 1: Instructions'), { key: 'Enter' });
    expect(latest).toHaveLength(2);
    fireEvent.keyDown(screen.getByLabelText('Medicine 2: Instructions'), { key: 'Enter' });
    expect(latest).toHaveLength(3);
    // the new last line is blank, so Enter there does nothing
    fireEvent.keyDown(screen.getByLabelText('Medicine 3: Instructions'), { key: 'Enter' });
    expect(latest).toHaveLength(3);
  });

  it('Enter in an unfinished last line does not add a line (it is not finished yet)', () => {
    render(<Harness initial={[complete({ dose: '' })]} />);
    fireEvent.keyDown(screen.getByLabelText('Medicine 1: Instructions'), { key: 'Enter' });
    expect(latest).toHaveLength(1);
  });

  it('switching the source of a line that already has a medicine clears it (a name never mixes with an id)', () => {
    render(<Harness initial={[complete()]} />);
    fireEvent.click(screen.getByRole('button', { name: copy.useFree }));
    expect(latest[0]).toMatchObject({ mode: 'FREE', medicineId: null, medicineName: '' });
    type('Medicine 1: Medicine name', 'Tulsi drops');
    fireEvent.click(screen.getByRole('button', { name: copy.useList }));
    expect(latest[0]).toMatchObject({ mode: 'LISTED', medicineId: null, medicineName: '' });
  });

  it('read-only shows only finished lines with every part named, flags unlisted ones, no inputs', () => {
    render(
      <Harness
        readOnly
        initial={[
          complete({ instructions: 'after food' }),
          { ...complete({ id: 2 }), mode: 'FREE', medicineId: null, medicineName: 'Tulsi drops' },
          emptyRxRow(3),
        ]}
      />,
    );
    expect(screen.getByText('Paracetamol 500')).toBeTruthy();
    expect(
      screen.getByText('Dose 1 tablet · Frequency twice a day · Duration 5 days · after food'),
    ).toBeTruthy();
    expect(screen.getByText(copy.unlisted)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.add })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('read-only with no medicines says so', () => {
    render(<Harness readOnly initial={[]} />);
    expect(screen.getByText(copy.readOnlyEmpty)).toBeTruthy();
  });
});
