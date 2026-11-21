import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.calendar;

function Harness({
  initial = '',
  min,
  max,
  onValue,
}: {
  initial?: string;
  min?: string;
  max?: string;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DatePicker
      label="Follow-up date"
      value={value}
      min={min}
      max={max}
      weekStart={1}
      quickDays={[1, 3, 7]}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

const open = () =>
  fireEvent.click(
    screen.getByRole('button', { name: /Follow-up date|Choose a date|\d{2} \w{3} \d{4}/ }),
  );
const field = () => screen.getByLabelText('Follow-up date');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 19, 10, 0));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('DatePicker', () => {
  it('shows the placeholder, then the chosen day in words', () => {
    const first = render(<Harness />);
    expect(field().textContent).toBe(copy.placeholder);
    first.unmount();
    render(<Harness initial="2026-11-26" />);
    expect(field().textContent).toBe('26 Nov 2026');
  });

  it('opens a month calendar with the weekdays (Monday first), today marked and the chosen day pressed', () => {
    render(<Harness initial="2026-11-26" />);
    open();
    const dialog = screen.getByRole('dialog', { name: copy.dialogTitle });
    expect(within(dialog).getByText('November 2026')).toBeTruthy();
    const headers = within(dialog)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers[0]).toBe('Mon');
    expect(headers[6]).toBe('Sun');
    expect(
      within(dialog)
        .getAllByRole('button', { pressed: true })
        .map((b) => b.textContent),
    ).toEqual(['26']);
    const today = within(dialog).getByRole('button', { name: /Thursday, 19 November 2026/ });
    expect(today.className).toContain('calendar-day-today');
  });

  it('picks a day, reports it and closes', () => {
    const seen: string[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Monday, 23 November 2026/ }));
    expect(seen).toEqual(['2026-11-23']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field().textContent).toBe('23 Nov 2026');
  });

  it('moves between months, also across the year end', () => {
    render(<Harness initial="2026-12-15" />);
    open();
    expect(screen.getByText('December 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.nextMonth }));
    expect(screen.getByText('January 2027')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: copy.previousMonth }));
    fireEvent.click(screen.getByRole('button', { name: copy.previousMonth }));
    expect(screen.getByText('November 2026')).toBeTruthy();
  });

  it('quick picks count from today: tomorrow, in 3 days, in 7 days', () => {
    const seen: string[] = [];
    render(<Harness onValue={(v) => seen.push(v)} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: copy.quickTomorrow }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'In 3 days' }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'In 7 days' }));
    expect(seen).toEqual(['2026-11-20', '2026-11-22', '2026-11-26']);
  });

  it('days and quick picks outside the allowed range cannot be used', () => {
    render(<Harness min="2026-11-21" max="2026-11-25" />);
    open();
    expect(
      (screen.getByRole('button', { name: /Friday, 20 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Saturday, 21 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: /Wednesday, 25 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: /Thursday, 26 November 2026/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: copy.quickTomorrow }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'In 3 days' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'In 7 days' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Clear empties the date (and is off when there is none)', () => {
    const seen: string[] = [];
    render(<Harness initial="2026-11-26" onValue={(v) => seen.push(v)} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: copy.clear }));
    expect(seen).toEqual(['']);
    open();
    expect((screen.getByRole('button', { name: copy.clear }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('closes with Escape, with Close and with a click outside', () => {
    render(
      <div>
        <p>outside</p>
        <Harness />
      </div>,
    );
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.click(screen.getByRole('button', { name: copy.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a disabled picker does not open', () => {
    render(
      <DatePicker
        label="Follow-up date"
        value=""
        onChange={() => undefined}
        weekStart={1}
        quickDays={[1]}
        disabled
      />,
    );
    fireEvent.click(screen.getByLabelText('Follow-up date'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('DatePicker with its own quick picks and the hospital today', () => {
  function Report({ onValue }: { onValue: (v: string) => void }) {
    const [value, setValue] = useState('2026-11-10');
    return (
      <DatePicker
        label="Date"
        value={value}
        max="2026-11-20"
        todayIso="2026-11-20"
        weekStart={1}
        quickDays={[]}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Yesterday', days: -1 },
        ]}
        onChange={(v) => {
          setValue(v);
          onValue(v);
        }}
      />
    );
  }

  it('shows the given quick picks instead of the usual ones, and they count from the hospital today', () => {
    // the browser says 19 Nov (fake clock) but the hospital day is 20 Nov
    const picked = jest.fn();
    render(<Report onValue={picked} />);
    fireEvent.click(screen.getByLabelText('Date'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: copy.quickTomorrow })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yesterday' }));
    expect(picked).toHaveBeenCalledWith('2026-11-19');
    fireEvent.click(screen.getByLabelText('Date'));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(picked).toHaveBeenLastCalledWith('2026-11-20');
  });

  it('marks the hospital today in the month, not the browser one', () => {
    render(<Report onValue={() => {}} />);
    fireEvent.click(screen.getByLabelText('Date'));
    const todayCell = screen.getByRole('button', { name: /Friday, 20 November 2026/ });
    expect(todayCell.className).toContain('calendar-day-today');
  });
});
