import {
  emptyRxRow,
  rxFromView,
  rxMissing,
  rxRowState,
  toRxPayload,
  type RxDraft,
} from './prescription-draft';

const listed = (over: Partial<RxDraft> = {}): RxDraft => ({
  ...emptyRxRow(1),
  medicineId: 'med-1',
  medicineName: 'Paracetamol 500',
  dose: '1 tablet',
  frequency: 'twice a day',
  duration: '5 days',
  ...over,
});

describe('rxRowState', () => {
  it('blank when nothing is typed, incomplete when something is missing, complete when ready', () => {
    expect(rxRowState(emptyRxRow(1))).toBe('blank');
    expect(rxRowState(listed({ dose: '' }))).toBe('incomplete');
    expect(rxRowState(listed({ medicineId: null, medicineName: '' }))).toBe('incomplete');
    expect(rxRowState(listed())).toBe('complete');
  });

  it('free text needs a name; a name alone is not enough', () => {
    const free = (over: Partial<RxDraft>): RxDraft => ({
      ...listed(),
      mode: 'FREE',
      medicineId: null,
      medicineName: 'Tulsi drops',
      ...over,
    });
    expect(rxRowState(free({}))).toBe('complete');
    expect(rxRowState(free({ medicineName: '  ' }))).toBe('incomplete');
    expect(rxRowState(free({ duration: ' ' }))).toBe('incomplete');
  });
});

describe('toRxPayload', () => {
  it('sends listed rows by id, free rows by name, trimmed, instructions only when typed', () => {
    const { items, incomplete } = toRxPayload([
      listed({ instructions: ' after food ' }),
      {
        ...listed({ id: 2 }),
        mode: 'FREE',
        medicineId: null,
        medicineName: ' Tulsi drops ',
        dose: ' 5 drops ',
      },
    ]);
    expect(incomplete).toBe(0);
    expect(items).toEqual([
      {
        medicineId: 'med-1',
        dose: '1 tablet',
        frequency: 'twice a day',
        duration: '5 days',
        instructions: 'after food',
      },
      {
        medicineName: 'Tulsi drops',
        dose: '5 drops',
        frequency: 'twice a day',
        duration: '5 days',
      },
    ]);
  });

  it('leaves unfinished rows out and counts them; blank rows are ignored', () => {
    const { items, incomplete } = toRxPayload([
      listed(),
      listed({ id: 2, dose: '' }),
      emptyRxRow(3),
    ]);
    expect(items).toHaveLength(1);
    expect(incomplete).toBe(1);
  });
});

describe('rxFromView', () => {
  it('turns saved rows into editable ones (unlisted becomes free text)', () => {
    const rows = rxFromView(
      [
        {
          lineNo: 1,
          medicineId: 'm1',
          medicineName: 'A',
          isUnlisted: false,
          dose: '1',
          frequency: '1',
          duration: '1',
          instructions: null,
        },
        {
          lineNo: 2,
          medicineId: null,
          medicineName: 'B',
          isUnlisted: true,
          dose: '2',
          frequency: '2',
          duration: '2',
          instructions: 'x',
        },
      ],
      10,
    );
    expect(rows.map((r) => [r.id, r.mode, r.medicineId, r.instructions])).toEqual([
      [10, 'LISTED', 'm1', ''],
      [11, 'FREE', null, 'x'],
    ]);
  });
});

describe('typed search text and what is missing', () => {
  it('text typed only in the search box makes the line unfinished (never silently ignored)', () => {
    expect(rxRowState({ ...emptyRxRow(1), search: 'Tab 1' })).toBe('incomplete');
    expect(rxRowState({ ...emptyRxRow(1), search: '   ' })).toBe('blank');
    expect(toRxPayload([{ ...emptyRxRow(1), search: 'Tab 1' }])).toEqual({
      items: [],
      incomplete: 1,
    });
  });

  it('lists exactly what a line still lacks, in the order it is filled', () => {
    expect(rxMissing(emptyRxRow(1))).toEqual(['medicineListed', 'dose', 'frequency', 'duration']);
    expect(rxMissing({ ...emptyRxRow(1), mode: 'FREE' })).toEqual([
      'medicineFree',
      'dose',
      'frequency',
      'duration',
    ]);
    expect(rxMissing(listed({ frequency: ' ' }))).toEqual(['frequency']);
    expect(rxMissing(listed())).toEqual([]);
  });
});
