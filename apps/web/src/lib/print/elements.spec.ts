import { staffCopy } from '@/config/staff-copy';
import {
  duplicateBox,
  linesHeightMm,
  moveInOrder,
  newFieldBox,
  newLineBox,
  newLogoBox,
  newTextBox,
  nextId,
  removeBox,
  removeField,
  replaceBox,
} from './elements';
import { fieldsInContent, wordsOf } from './rich';
import { fieldBox, textBox } from './print-test-fixtures';
import type { PrintElement } from './types';

const page = { widthMm: 148, heightMm: 210 };

describe('ids', () => {
  it('gives an id no other box uses', () => {
    expect(nextId([])).toBe('e1');
    expect(nextId([textBox('e1', 'x'), textBox('e2', 'x')])).toBe('e3');
    expect(nextId([textBox('e2', 'x'), textBox('e3', 'x')])).toBe('e4');
    expect(nextId([textBox('e3', 'x')])).toBe('e2');
  });
});

describe('new boxes', () => {
  it('a field box goes below everything else, on the page, with its caption as bold words in front', () => {
    const existing = [textBox('e1', 'x', { yMm: 20, heightMm: 10 })];
    const f = newFieldBox(existing, page, 'patientName', 11, true);
    expect(f).toMatchObject({ type: 'RICH', id: 'e2' });
    expect(f.yMm).toBe(32);
    expect(f.xMm + f.widthMm).toBeLessThanOrEqual(page.widthMm);
    expect(f.content!.paragraphs[0]!.runs).toEqual([
      { t: 'text', text: `${staffCopy.print.fields.patientName}: `, style: { bold: true } },
      { t: 'field', field: 'patientName' },
    ]);
  });

  it('without a caption the box holds just the value', () => {
    const f = newFieldBox([], page, 'uhid', 11, false);
    expect(f.content!.paragraphs[0]!.runs).toEqual([{ t: 'field', field: 'uhid' }]);
  });

  it('a list value starts taller than a single line', () => {
    const one = newFieldBox([], page, 'patientName', 11, true);
    const list = newFieldBox([], page, 'medicines', 11, true);
    expect(list.heightMm).toBeGreaterThan(one.heightMm);
    expect(list.heightMm).toBe(linesHeightMm(11, 4));
  });

  it('the first box starts near the top-left corner', () => {
    const f = newFieldBox([], page, 'patientName', 11, true);
    expect(f.xMm).toBeGreaterThan(0);
    expect(f.yMm).toBeGreaterThan(0);
  });

  it('a box added when the page is nearly full is pulled back onto the page', () => {
    const full = [textBox('e1', 'x', { yMm: 200, heightMm: 9 })];
    const f = newTextBox(full, page, 'Hello', 11);
    expect(f.yMm + f.heightMm).toBeLessThanOrEqual(page.heightMm);
  });

  it('makes text, line and logo boxes of their own kind', () => {
    const text = newTextBox([], page, 'Hello', 11);
    expect(text).toMatchObject({ type: 'RICH' });
    expect(wordsOf(text.content)).toBe('Hello');
    expect(newTextBox([], page, '', 11).content).toEqual({ paragraphs: [{ runs: [] }] });
    const line = newLineBox([], page);
    expect(line).toMatchObject({ type: 'LINE' });
    expect(line.heightMm).toBeLessThan(1);
    expect(newLogoBox([], page)).toMatchObject({ type: 'IMAGE', slot: 'LOGO' });
  });

  it('every size stays at one decimal', () => {
    const f = newFieldBox(
      [textBox('e1', 'x', { yMm: 12.34, heightMm: 5.67 })],
      page,
      'medicines',
      10.5,
      true,
    );
    for (const n of [f.xMm, f.yMm, f.widthMm, f.heightMm]) {
      expect(Math.round(n * 10) / 10).toBe(n);
    }
  });
});

describe('editing the list of boxes', () => {
  const list = [textBox('a', 'a'), textBox('b', 'b'), textBox('c', 'c')];

  it('duplicates a box a little further with its own id and its own copy of the text', () => {
    const source = fieldBox('uhid', 'a', { xMm: 20, yMm: 20, bold: true });
    const copy = duplicateBox(list, source, page);
    expect(copy).toMatchObject({ id: 'e4', xMm: 25, yMm: 25 });
    expect(copy.content).toEqual(source.content);
    // not the same object: changing the copy must never change the original
    copy.content!.paragraphs[0]!.runs.pop();
    expect(source.content!.paragraphs[0]!.runs.length).toBeGreaterThan(
      copy.content!.paragraphs[0]!.runs.length,
    );
    const corner = duplicateBox(
      list,
      textBox('a', 'a', { xMm: 98, yMm: 204, widthMm: 50, heightMm: 6 }),
      page,
    );
    expect(corner.xMm + corner.widthMm).toBeLessThanOrEqual(148);
    expect(corner.yMm + corner.heightMm).toBeLessThanOrEqual(210);
  });

  it('replaces and removes by id without touching the others', () => {
    expect(replaceBox(list, 'b', { xMm: 99 }).map((e) => e.xMm)).toEqual([10, 99, 10]);
    expect(removeBox(list, 'b').map((e) => e.id)).toEqual(['a', 'c']);
    expect(list).toHaveLength(3);
  });

  it('moves a box forward or backward in the drawing order, never past the ends', () => {
    expect(moveInOrder(list, 'a', 1).map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(list, 'c', -1).map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(list, 'c', 1).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(list, 'a', -1).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(list, 'zzz', 1).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('taking a value off the page', () => {
  it('removes a box that was only that value (with its caption), and keeps boxes with other things', () => {
    const boxes: PrintElement[] = [
      fieldBox('uhid', 'a'),
      fieldBox('total', 'b'),
      {
        ...textBox('c', 'x'),
        content: {
          paragraphs: [
            {
              runs: [
                { t: 'text', text: 'Patient ' },
                { t: 'field', field: 'uhid' },
                { t: 'text', text: ' paid ' },
                { t: 'field', field: 'total' },
              ],
            },
          ],
        },
      },
      { id: 'l', type: 'LINE', xMm: 0, yMm: 0, widthMm: 5, heightMm: 1 },
    ];
    const out = removeField(boxes, 'uhid');
    expect(out.map((e) => e.id)).toEqual(['b', 'c', 'l']);
    // the sentence stays, without the value
    expect(fieldsInContent(out.find((e) => e.id === 'c')!.content)).toEqual(['total']);
    expect(wordsOf(out.find((e) => e.id === 'c')!.content)).toBe('Patient  paid ');
  });

  it('leaves everything alone when the value is not there', () => {
    const boxes = [fieldBox('uhid', 'a'), textBox('b', 'words')];
    expect(removeField(boxes, 'nope')).toEqual(boxes);
  });
});
