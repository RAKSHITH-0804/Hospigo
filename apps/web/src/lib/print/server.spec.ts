/**
 * @jest-environment node
 */
import { readTemplate } from './server';
import { makeTemplate } from './print-test-fixtures';

describe('readTemplate', () => {
  it('accepts a complete template', () => {
    const t = makeTemplate('PRESCRIPTION');
    expect(readTemplate({ status: 'ok', data: t })).toEqual(t);
  });

  it('says "no template" for anything that is not a usable answer', () => {
    expect(readTemplate({ status: 'forbidden' })).toBeNull();
    expect(readTemplate({ status: 'notFound' })).toBeNull();
    expect(readTemplate({ status: 'error', code: 'UNKNOWN' })).toBeNull();
    for (const junk of [null, 'text', 5, [], {}, { id: 'p1', patient: { id: 'p1' } }]) {
      expect({ junk, got: readTemplate({ status: 'ok', data: junk }) }).toEqual({
        junk,
        got: null,
      });
    }
  });

  it('refuses a template with a missing or malformed part', () => {
    const base = makeTemplate();
    base.layout.elements = [
      {
        id: 'a',
        type: 'RICH',
        xMm: 1,
        yMm: 1,
        widthMm: 10,
        heightMm: 5,
        content: { paragraphs: [{ runs: [] }] },
      },
    ];
    const cut = (mutate: (t: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(copy);
      return readTemplate({ status: 'ok', data: copy });
    };
    const layout = (t: Record<string, unknown>) => t.layout as Record<string, unknown>;
    expect(cut(() => {})).not.toBeNull();
    expect(cut((t) => delete t.layout)).toBeNull();
    expect(cut((t) => delete t.pageWidthMm)).toBeNull();
    expect(cut((t) => (t.mode = 'SIDEWAYS'))).toBeNull();
    expect(cut((t) => delete layout(t).elements)).toBeNull();
    expect(cut((t) => (layout(t).elements = {}))).toBeNull();
    expect(cut((t) => delete layout(t).offset)).toBeNull();
    expect(cut((t) => (layout(t).version = 2))).toBeNull(); // the API always answers version 3
    expect(cut((t) => (t.enabled = 'yes'))).toBeNull();
    // a box with a missing or wrong number is not a box
    expect(
      cut((t) => ((layout(t).elements as Array<Record<string, unknown>>)[0]!.xMm = '1')),
    ).toBeNull();
    expect(
      cut((t) => delete (layout(t).elements as Array<Record<string, unknown>>)[0]!.id),
    ).toBeNull();
    expect(cut((t) => (layout(t).elements = [null]))).toBeNull();
  });
});
