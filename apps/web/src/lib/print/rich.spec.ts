import {
  alignAll,
  allRuns,
  appendField,
  cleanStyle,
  commonAlign,
  commonStyle,
  dropField,
  emptyContent,
  fieldsInContent,
  fieldsOnPage,
  isEmptyContent,
  shownParagraphs,
  simpleContent,
  styleAll,
  toggleAll,
  wordsOf,
} from './rich';
import { fieldBox, textBox } from './print-test-fixtures';
import type { PrintContent, PrintItem } from './types';

const sentence: PrintContent = {
  paragraphs: [
    {
      runs: [
        { t: 'text', text: 'Patient: ', style: { bold: true } },
        { t: 'field', field: 'patientName', style: { size: 14 } },
        { t: 'text', text: ', age ' },
        { t: 'field', field: 'age' },
      ],
    },
    { align: 'CENTER', runs: [{ t: 'text', text: 'Thank you' }] },
  ],
};

const items = new Map<string, PrintItem>([
  ['patientName', { key: 'patientName', label: 'Patient', text: 'Asha' }],
  ['age', { key: 'age', label: 'Age', text: '' }],
  ['phone', { key: 'phone', label: 'Phone', text: '   ' }],
  ['medicines', { key: 'medicines', label: 'Medicines', lines: ['Para', 'Syrup'] }],
]);

describe('reading a box', () => {
  it('lists its values and its words', () => {
    expect(fieldsInContent(sentence)).toEqual(['patientName', 'age']);
    expect(wordsOf(sentence)).toBe('Patient: , age \nThank you');
    expect(allRuns(sentence)).toHaveLength(5);
    expect(fieldsInContent(undefined)).toEqual([]);
    expect(wordsOf(undefined)).toBe('');
  });

  it('knows an empty box, and the values on a whole page', () => {
    expect(isEmptyContent(emptyContent())).toBe(true);
    expect(isEmptyContent(undefined)).toBe(true);
    expect(isEmptyContent(simpleContent('x'))).toBe(false);
    expect(
      [
        ...fieldsOnPage([
          fieldBox('uhid', 'a'),
          fieldBox('total', 'b'),
          textBox('c', 'words only'),
          { id: 'l', type: 'LINE', xMm: 0, yMm: 0, widthMm: 5, heightMm: 1 },
        ]),
      ].sort(),
    ).toEqual(['total', 'uhid']);
  });

  it('builds a simple box of words and a value', () => {
    expect(simpleContent('Patient: ', 'patientName')).toEqual({
      paragraphs: [
        {
          runs: [
            { t: 'text', text: 'Patient: ' },
            { t: 'field', field: 'patientName' },
          ],
        },
      ],
    });
    expect(simpleContent('', 'uhid').paragraphs[0]!.runs).toEqual([{ t: 'field', field: 'uhid' }]);
  });
});

describe('cleanStyle', () => {
  it('keeps only settings that matter', () => {
    expect(cleanStyle(undefined)).toBeUndefined();
    expect(cleanStyle({})).toBeUndefined();
    expect(cleanStyle({ bold: false, italic: false, font: 'SANS', tone: 'BLACK' })).toBeUndefined();
    expect(cleanStyle({ size: 12, bold: true, font: 'MONO', tone: 'GREY' })).toEqual({
      size: 12,
      bold: true,
      font: 'MONO',
      tone: 'GREY',
    });
  });
});

describe('changing all of a box', () => {
  it('a style change reaches every stretch and keeps what each had besides', () => {
    const out = styleAll(sentence, { size: 20, italic: true });
    for (const run of allRuns(out)) {
      expect(run.style).toMatchObject({ size: 20, italic: true });
    }
    // the first stretch was bold and still is
    expect(allRuns(out)[0]!.style).toMatchObject({ bold: true });
    // the original is untouched
    expect(allRuns(sentence)[2]!.style).toBeUndefined();
  });

  it('choosing sans or black again takes the setting away', () => {
    const grey = styleAll(sentence, { tone: 'GREY', font: 'MONO' });
    expect(allRuns(grey)[2]!.style).toEqual({ tone: 'GREY', font: 'MONO' });
    const back = styleAll(grey, { tone: 'BLACK', font: 'SANS' });
    expect(allRuns(back)[2]!.style).toBeUndefined();
  });

  it('bold turns on for all when not all are bold, and off when all are', () => {
    const on = toggleAll(sentence, 'bold');
    expect(allRuns(on).every((r) => r.style?.bold === true)).toBe(true);
    const off = toggleAll(on, 'bold');
    expect(allRuns(off).some((r) => r.style?.bold)).toBe(false);
    // a box with nothing in it stays as it is
    expect(toggleAll(emptyContent(), 'italic')).toEqual(emptyContent());
  });

  it('knows what is true of all the stretches, and leaves a difference out', () => {
    expect(commonStyle(sentence)).toEqual({});
    const same = styleAll(sentence, { size: 12 });
    expect(commonStyle(same)).toMatchObject({ size: 12 });
    // bold differs between stretches: not reported
    expect(commonStyle(styleAll(sentence, { size: 12 })).bold).toBeUndefined();
    expect(commonStyle(toggleAll(sentence, 'bold')).bold).toBe(true);
    expect(commonStyle(undefined)).toEqual({});
    expect(commonStyle(emptyContent())).toEqual({});
  });

  it('aligns every paragraph, and left is the absence of an alignment', () => {
    const center = alignAll(sentence, 'CENTER');
    expect(center.paragraphs.map((p) => p.align)).toEqual(['CENTER', 'CENTER']);
    expect(commonAlign(center)).toBe('CENTER');
    const left = alignAll(center, 'LEFT');
    expect(left.paragraphs.every((p) => !('align' in p))).toBe(true);
    expect(commonAlign(left)).toBe('LEFT');
    // paragraphs that differ have no common alignment
    expect(commonAlign(sentence)).toBeUndefined();
    expect(commonAlign(undefined)).toBeUndefined();
  });

  it('puts a value at the end of the last paragraph in the style of the words before it, and takes one out', () => {
    const added = appendField(simpleContent('Total: ', undefined, { bold: true }), 'total');
    expect(added.paragraphs[0]!.runs.at(-1)).toEqual({
      t: 'field',
      field: 'total',
      style: { bold: true },
    });
    expect(appendField(emptyContent(), 'uhid').paragraphs[0]!.runs).toEqual([
      { t: 'field', field: 'uhid' },
    ]);
    expect(fieldsInContent(dropField(sentence, 'age'))).toEqual(['patientName']);
    expect(dropField(simpleContent('', 'uhid'), 'uhid')).toEqual(emptyContent());
  });
});

describe('what prints', () => {
  it('on plain paper every paragraph prints, but a line whose values are all empty is left out', () => {
    const content: PrintContent = {
      paragraphs: [
        {
          runs: [
            { t: 'text', text: 'Phone: ' },
            { t: 'field', field: 'phone' },
          ],
        },
        {
          runs: [
            { t: 'text', text: 'Age: ' },
            { t: 'field', field: 'age' },
          ],
        },
        {
          runs: [
            { t: 'text', text: 'Patient: ' },
            { t: 'field', field: 'patientName' },
          ],
        },
        { runs: [{ t: 'text', text: 'Always printed' }] },
        { runs: [] },
      ],
    };
    const shown = shownParagraphs(content, items, false);
    expect(shown.map((p) => wordsOf({ paragraphs: [p] }))).toEqual([
      'Patient: ',
      'Always printed',
      '',
    ]);
  });

  it('a line with one value with something and one without still prints, words and all', () => {
    const content: PrintContent = {
      paragraphs: [
        {
          runs: [
            { t: 'field', field: 'age' },
            { t: 'text', text: ' / ' },
            { t: 'field', field: 'patientName' },
          ],
        },
      ],
    };
    expect(shownParagraphs(content, items, false)).toHaveLength(1);
  });

  it('a value that is unknown to the page prints nothing', () => {
    const content = simpleContent('Hello ', 'neverHeardOf');
    expect(shownParagraphs(content, items, false)).toEqual([]);
    // words only: always
    expect(shownParagraphs(simpleContent('Hello'), items, false)).toHaveLength(1);
  });

  it('on pre-printed stationery only the values with something print, the words never', () => {
    const shown = shownParagraphs(sentence, items, true);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.runs).toEqual([{ t: 'field', field: 'patientName', style: { size: 14 } }]);
    // a list value counts as something
    const list = shownParagraphs(simpleContent('Medicines: ', 'medicines'), items, true);
    expect(list[0]!.runs).toEqual([{ t: 'field', field: 'medicines' }]);
    expect(shownParagraphs(simpleContent('words only'), items, true)).toEqual([]);
    expect(shownParagraphs(undefined, items, true)).toEqual([]);
  });

  it('keeps the alignment of a paragraph that prints', () => {
    const content: PrintContent = {
      paragraphs: [{ align: 'RIGHT', runs: [{ t: 'field', field: 'patientName' }] }],
    };
    expect(shownParagraphs(content, items, false)[0]!.align).toBe('RIGHT');
    expect(shownParagraphs(content, items, true)[0]!.align).toBe('RIGHT');
  });
});
