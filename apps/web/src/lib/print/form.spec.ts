import { staffCopy } from '@/config/staff-copy';
import {
  DOC_FIELD_ORDER,
  fromPreset,
  invalidMessage,
  pageSizeMm,
  paperNeedsSize,
  previewTemplate,
  sampleItems,
  toInput,
  toPayload,
} from './form';
import { fieldBox, makeTemplate, withFields } from './print-test-fixtures';
import type { PrintPreset } from './types';

const KEYS = ['hospitalName', 'patientName', 'uhid', 'medicines', 'lines', 'followUpDate'];

describe('page size', () => {
  it('knows the standard papers and swaps them for landscape', () => {
    const a4 = toInput(makeTemplate('RECEIPT', { paper: 'A4' }));
    expect(pageSizeMm(a4)).toEqual({ width: 210, height: 297 });
    expect(pageSizeMm({ ...a4, orientation: 'LANDSCAPE' })).toEqual({ width: 297, height: 210 });
    expect(pageSizeMm({ ...a4, paper: 'A5' })).toEqual({ width: 148, height: 210 });
    expect(pageSizeMm({ ...a4, paper: 'A6' })).toEqual({ width: 105, height: 148 });
  });

  it('takes the typed size for a label or custom paper and never swaps it', () => {
    const base = toInput(makeTemplate());
    const label = { ...base, paper: 'LABEL' as const, widthMm: 100, heightMm: 50 };
    expect(pageSizeMm(label)).toEqual({ width: 100, height: 50 });
    expect(pageSizeMm({ ...label, orientation: 'LANDSCAPE' })).toEqual({ width: 100, height: 50 });
    expect(pageSizeMm({ ...label, widthMm: null })).toBeNull();
    expect(paperNeedsSize('LABEL')).toBe(true);
    expect(paperNeedsSize('CUSTOM')).toBe(true);
    expect(paperNeedsSize('A4')).toBe(false);
  });
});

describe('toInput and toPayload', () => {
  it('drops what the server adds and copies the boxes deeply', () => {
    const t = withFields(makeTemplate('PRESCRIPTION'), KEYS);
    const input = toInput(t);
    expect('docType' in input).toBe(false);
    expect('pageWidthMm' in input).toBe(false);
    expect('source' in input).toBe(false);
    input.layout.elements[0]!.xMm = 99;
    input.layout.offset.xMm = 5;
    input.margins.topMm = 99;
    expect(t.layout.elements[0]!.xMm).toBe(10);
    expect(t.layout.offset.xMm).toBe(0);
    expect(t.margins.topMm).toBe(10);
    expect(input.layout.version).toBe(3);
  });

  it('sends a size only for papers that need one', () => {
    const base = { ...toInput(makeTemplate()), widthMm: 123 };
    expect(toPayload(base).widthMm).toBeNull();
    expect(toPayload(base).heightMm).toBeNull();
    const custom = { ...base, paper: 'CUSTOM' as const, widthMm: 200, heightMm: 100 };
    expect(toPayload(custom)).toMatchObject({ widthMm: 200, heightMm: 100 });
  });
});

describe('presets and the page', () => {
  const preset: PrintPreset = {
    key: 'LABEL_SLIP',
    name: 'Small label',
    templates: {
      RECEIPT: makeTemplate('RECEIPT', { paper: 'LABEL', widthMm: 100, heightMm: 50 }),
      REGISTRATION_SLIP: makeTemplate('REGISTRATION_SLIP'),
      PRESCRIPTION: makeTemplate('PRESCRIPTION'),
    },
  };

  it('copies the preset of the document and remembers its key', () => {
    const input = fromPreset(preset, 'RECEIPT');
    expect(input.preset).toBe('LABEL_SLIP');
    expect(input.paper).toBe('LABEL');
    input.margins.topMm = 77;
    expect(preset.templates.RECEIPT.margins.topMm).toBe(10);
  });

  it('draws the page at the real size, and not while a value is missing or unreadable', () => {
    const input = toInput(withFields(makeTemplate('RECEIPT'), KEYS));
    expect(previewTemplate('RECEIPT', input)).toMatchObject({
      docType: 'RECEIPT',
      pageWidthMm: 148,
      pageHeightMm: 210,
    });
    const nan = (change: (i: typeof input) => void) => {
      const copy = toInput(withFields(makeTemplate('RECEIPT'), KEYS));
      change(copy);
      return previewTemplate('RECEIPT', copy);
    };
    expect(nan((i) => (i.margins.topMm = NaN))).toBeNull();
    expect(nan((i) => (i.layout.fontSizePt = NaN))).toBeNull();
    expect(nan((i) => (i.layout.offset.yMm = NaN))).toBeNull();
    expect(nan((i) => (i.layout.elements[0]!.widthMm = NaN))).toBeNull();
    expect(
      nan((i) => Object.assign(i, { paper: 'CUSTOM', widthMm: NaN, heightMm: 50 })),
    ).toBeNull();
    expect(
      nan((i) => Object.assign(i, { paper: 'CUSTOM', widthMm: null, heightMm: 50 })),
    ).toBeNull();
  });
});

describe('the values of each document', () => {
  // The values each document can show, in the API's order (PRINT_FIELDS of print-template.rules.ts).
  it('are pinned to the API lists, the hospital name first', () => {
    expect(DOC_FIELD_ORDER.RECEIPT[0]).toBe('hospitalName');
    expect(DOC_FIELD_ORDER.REGISTRATION_SLIP).toHaveLength(9);
    expect(DOC_FIELD_ORDER.RECEIPT).toHaveLength(15);
    expect(DOC_FIELD_ORDER.PRESCRIPTION).toHaveLength(20);
    for (const keys of Object.values(DOC_FIELD_ORDER)) {
      for (const key of keys) {
        expect({ key, caption: staffCopy.print.fields[key] }).toEqual({
          key,
          caption: expect.any(String),
        });
      }
    }
  });
});

describe('sampleItems', () => {
  it('makes one clearly-sample item for every key, of the right kind, with the real hospital name', () => {
    const items = sampleItems(KEYS, 'Demo Clinic');
    expect(items.map((i) => i.key)).toEqual(KEYS);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.hospitalName).toMatchObject({ text: 'Demo Clinic' });
    expect('text' in byKey.patientName!).toBe(true);
    expect('lines' in byKey.medicines!).toBe(true);
    expect('pairs' in byKey.lines!).toBe(true);
    expect(JSON.stringify(items)).toContain(staffCopy.print.sample.patientName);
    expect(JSON.stringify(items)).toContain(staffCopy.print.sample.uhid);
  });

  it('gives a box for a field the document has even when no special sample exists', () => {
    expect(sampleItems(['phone'], 'H')[0]).toMatchObject({
      key: 'phone',
      text: staffCopy.print.sample.text,
    });
  });
});

describe('invalidMessage', () => {
  const copy = staffCopy.settings.printing;

  it('says which field and why in plain words', () => {
    expect(invalidMessage({ field: 'margins', reason: 'NO_ROOM_TO_PRINT_DOWN' })).toBe(
      `Cannot save: ${copy.fieldNames.margins} ${copy.reasons.NO_ROOM_TO_PRINT_DOWN}`,
    );
    expect(invalidMessage({ field: 'margins.topMm', reason: 'OUT_OF_RANGE' })).toContain(
      copy.fieldNames.topMm,
    );
    expect(invalidMessage({ field: 'layout.elements', reason: 'TOO_MANY' })).toContain(
      copy.fieldNames.elements,
    );
  });

  it('names a box by its number on the page and by what it shows', () => {
    expect(invalidMessage({ field: 'layout.elements.2.widthMm', reason: 'OUT_OF_PAGE' })).toBe(
      `Cannot save: box 3 (${copy.fieldNames.widthMm}) ${copy.reasons.OUT_OF_PAGE}`,
    );
    expect(invalidMessage({ field: 'layout.elements.0.text', reason: 'REQUIRED' })).toContain(
      'box 1',
    );
  });

  it('never shows an unknown code or the upstream text', () => {
    expect(invalidMessage({ field: 'margins', reason: 'SOMETHING_NEW' })).toBe(
      copy.invalidFallback,
    );
    expect(invalidMessage({})).toBe(copy.invalidFallback);
    expect(invalidMessage({ field: 'margins' })).toBe(copy.invalidFallback);
    expect(fieldBox('uhid', 'a').id).toBe('a');
  });
});
