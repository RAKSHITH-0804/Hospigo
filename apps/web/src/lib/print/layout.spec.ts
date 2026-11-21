import {
  alignStyle,
  boxClasses,
  isEmptyItem,
  itemsByKey,
  mm,
  pageRule,
  placeStyle,
  printsBox,
  runClasses,
  runStyle,
} from './layout';
import { fieldBox, makeTemplate, textBox } from './print-test-fixtures';
import type { PrintElement } from './types';

describe('pageRule', () => {
  it('is the exact paper with margin 0', () => {
    expect(pageRule(makeTemplate())).toBe('@page { size: 148mm 210mm; margin: 0; }');
    expect(pageRule({ pageWidthMm: 297, pageHeightMm: 210 })).toBe(
      '@page { size: 297mm 210mm; margin: 0; }',
    );
    expect(pageRule({ pageWidthMm: 100.5, pageHeightMm: 50 })).toBe(
      '@page { size: 100.5mm 50mm; margin: 0; }',
    );
  });
});

describe('mm', () => {
  it('shows one decimal and no floating point noise', () => {
    expect(mm(10)).toBe('10mm');
    expect(mm(0.1 + 0.2)).toBe('0.3mm');
    expect(mm(10.04)).toBe('10mm');
  });
});

describe('items', () => {
  it('knows an empty item of each kind and finds items by key', () => {
    expect(isEmptyItem({ key: 'a', label: 'a', text: ' ' })).toBe(true);
    expect(isEmptyItem({ key: 'a', label: 'a', lines: ['', ' '] })).toBe(true);
    expect(isEmptyItem({ key: 'a', label: 'a', pairs: [] })).toBe(true);
    expect(isEmptyItem({ key: 'a', label: 'a', pairs: [['x', '1']] })).toBe(false);
    const map = itemsByKey([{ key: 'uhid', label: 'UHID', text: 'U1' }]);
    expect(map.get('uhid')).toMatchObject({ text: 'U1' });
    expect(map.get('nope')).toBeUndefined();
  });
});

describe('what prints', () => {
  const full = makeTemplate();
  const pre = makeTemplate('RECEIPT', { mode: 'PREPRINTED' });
  const line: PrintElement = {
    id: 'l',
    type: 'LINE',
    xMm: 1,
    yMm: 1,
    widthMm: 50,
    heightMm: 0.3,
  };
  const logo: PrintElement = { ...line, id: 'g', type: 'IMAGE', slot: 'LOGO', heightMm: 20 };

  it('plain paper prints every kind of box; pre-printed stationery only the text boxes (their values)', () => {
    for (const e of [fieldBox('uhid', 'a'), textBox('t', 'x'), line, logo]) {
      expect(printsBox(full, e)).toBe(true);
    }
    expect(printsBox(pre, fieldBox('uhid', 'a'))).toBe(true);
    expect(printsBox(pre, textBox('t', 'x'))).toBe(true);
    expect(printsBox(pre, line)).toBe(false);
    expect(printsBox(pre, logo)).toBe(false);
  });
});

describe('placeStyle', () => {
  it('uses the millimetres of the box, moved by the whole-page nudge', () => {
    const t = makeTemplate();
    const box = textBox('t', 'x', { xMm: 10, yMm: 20, widthMm: 50, heightMm: 6.5 });
    expect(placeStyle(t, box)).toEqual({
      left: '10mm',
      top: '20mm',
      width: '50mm',
      height: '6.5mm',
    });
    t.layout.offset = { xMm: 1.5, yMm: -2 };
    expect(placeStyle(t, box)).toMatchObject({ left: '11.5mm', top: '18mm' });
  });
});

describe('the look of a stretch of text', () => {
  it('has the size, bold, italic and underline it asks for, and nothing else when it asks for nothing', () => {
    expect(runStyle(undefined)).toEqual({
      fontSize: undefined,
      fontWeight: undefined,
      fontStyle: undefined,
      textDecoration: undefined,
    });
    expect(runStyle({ size: 18, bold: true, italic: true, underline: true })).toEqual({
      fontSize: '18pt',
      fontWeight: 700,
      fontStyle: 'italic',
      textDecoration: 'underline',
    });
    expect(runStyle({ size: 6 }).fontSize).toBe('6pt');
  });

  it('names a font and a colour by class, and none for sans and black', () => {
    expect(runClasses(undefined)).toBe('');
    expect(runClasses({ font: 'SANS', tone: 'BLACK' })).toBe('');
    expect(runClasses({ font: 'MONO', tone: 'GREY' })).toBe('print-font-mono print-tone-grey');
    expect(runClasses({ font: 'SERIF' })).toBe('print-font-serif');
  });

  it('aligns a paragraph, and leaves it alone when no alignment is set', () => {
    expect(alignStyle(undefined)).toEqual({});
    expect(alignStyle('CENTER')).toEqual({ textAlign: 'center' });
    expect(alignStyle('RIGHT')).toEqual({ textAlign: 'right' });
  });
});

describe('boxClasses', () => {
  it('names the kind of the box, and the colour of a line', () => {
    expect(boxClasses(textBox('t', 'x'))).toBe('print-box print-box-rich');
    expect(
      boxClasses({ id: 'l', type: 'LINE', xMm: 0, yMm: 0, widthMm: 5, heightMm: 1, tone: 'GREY' }),
    ).toBe('print-box print-box-line print-tone-grey');
    expect(boxClasses({ id: 'g', type: 'IMAGE', xMm: 0, yMm: 0, widthMm: 5, heightMm: 5 })).toBe(
      'print-box print-box-image',
    );
  });
});
