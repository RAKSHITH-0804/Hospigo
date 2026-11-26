import {
  defaultPresetKey,
  PAPER_SIZES_MM,
  PRESETS,
  PRINT_DOC_TYPES,
  PRINT_FIELDS,
  PRINT_LIMITS,
  defaultInput,
  pageSizeMm,
  presetInput,
  presetInputV2,
  validateTemplate as validateTemplateStrict,
  type PrintDocType,
  type PrintTemplateInput,
} from './print-template.rules';

/**
 * The rules below (paper, margins, boxes, styles) do not care about the token. Since Step 7f a
 * RECEIPT must show the token, so for those tests only a tiny token box is added when the template
 * under test was otherwise valid and has none. The token rule itself is tested with
 * `validateTemplateStrict` in its own section at the end of this file.
 */
function validateTemplate(docType: PrintDocType, raw: unknown): PrintTemplateInput {
  try {
    return validateTemplateStrict(docType, raw);
  } catch (error) {
    const response = (error as { getResponse?: () => Record<string, unknown> }).getResponse?.();
    if (docType !== 'RECEIPT' || response?.reason !== 'TOKEN_REQUIRED') {
      throw error;
    }
    const clone = JSON.parse(JSON.stringify(raw)) as {
      layout: { version?: number; elements: unknown[] };
    };
    clone.layout.elements.push(
      clone.layout.version === 3
        ? {
            id: 'tokenbox',
            type: 'RICH',
            xMm: 0,
            yMm: 0,
            widthMm: 10,
            heightMm: 5,
            content: { paragraphs: [{ runs: [{ t: 'field', field: 'token' }] }] },
          }
        : {
            id: 'tokenbox',
            type: 'FIELD',
            field: 'token',
            xMm: 0,
            yMm: 0,
            widthMm: 10,
            heightMm: 5,
          },
    );
    return validateTemplateStrict(docType, clone);
  }
}

/** A valid template to start every refusal test from. */
function valid(docType: PrintDocType = 'RECEIPT'): Record<string, unknown> {
  // Version 2 on purpose: most rules below are the rules of a field box and a text box, which an
  // older caller still sends. (Version 3 has its own section at the end.)
  const t = presetInputV2('A5_FULL', docType);
  return JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
}
/** Test bodies are edited field by field, so they are loosely typed on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
/** The values placed in the boxes of a (version 3) template, in order. */
const fieldsOf = (t: PrintTemplateInput): string[] =>
  t.layout.elements.flatMap((e) =>
    (e.content?.paragraphs ?? []).flatMap((p) =>
      p.runs.flatMap((r) => (r.t === 'field' ? [r.field] : [])),
    ),
  );
/** All the typed words of a box, one string. */
const wordsOf = (e: PrintTemplateInput['layout']['elements'][number]): string =>
  (e.content?.paragraphs ?? [])
    .map((p) => p.runs.map((r) => (r.t === 'text' ? r.text : '')).join(''))
    .join('\n');
const withChange = (docType: PrintDocType, change: (t: Record<string, Loose>) => void) => {
  const t = valid(docType);
  change(t as Record<string, Loose>);
  return t;
};
const refusal = (fn: () => unknown): { field?: string; reason?: string; code?: string } => {
  try {
    fn();
  } catch (error) {
    const response = (error as { getResponse?: () => Record<string, unknown> }).getResponse?.();
    return response ?? { code: 'OTHER' };
  }
  return { code: 'NO_ERROR' };
};
const expectRefused = (docType: PrintDocType, raw: unknown, field: string, reason: string) => {
  expect(refusal(() => validateTemplate(docType, raw))).toMatchObject({
    code: 'PRINT_TEMPLATE_INVALID',
    field,
    reason,
  });
};

describe('print template presets and defaults', () => {
  it('every preset gives every document a template the validator accepts, made of rich text boxes holding values of that document', () => {
    for (const key of Object.keys(PRESETS)) {
      for (const docType of PRINT_DOC_TYPES) {
        const t = presetInput(key, docType);
        expect(() => validateTemplate(docType, t)).not.toThrow();
        expect(t.layout.version).toBe(3);
        const fields = fieldsOf(t);
        for (const f of fields) {
          expect(PRINT_FIELDS[docType]).toContain(f);
        }
        // one value in one box, none twice, and every id is its own
        expect(new Set(fields).size).toBe(fields.length);
        expect(new Set(t.layout.elements.map((e) => e.id)).size).toBe(t.layout.elements.length);
        expect(t.layout.elements.length).toBeLessThanOrEqual(PRINT_LIMITS.elementsMax);
        // the same template read again is the same template
        expect(validateTemplate(docType, JSON.parse(JSON.stringify(t)))).toEqual(t);
      }
    }
  });

  it('a hospital that saved nothing gets the built-in default of each document', () => {
    for (const docType of PRINT_DOC_TYPES) {
      const t = defaultInput(docType);
      expect(t.preset).toBe(defaultPresetKey(docType));
      expect(t.enabled).toBe(true);
      expect(() => validateTemplate(docType, t)).not.toThrow();
    }
    expect(defaultInput('RECEIPT')).toMatchObject({ paper: 'A5', mode: 'FULL' });
    // Step 2.1a: A5 is the default of every document but the label (a hospital setting)
    expect(defaultInput('REGISTRATION_SLIP')).toMatchObject({ paper: 'A5' });
    expect(defaultInput('PRESCRIPTION')).toMatchObject({ paper: 'A5' });
    expect(defaultInput('PATIENT_REPORT')).toMatchObject({ paper: 'A5' });
    expect(defaultInput('PATIENT_CARD')).toMatchObject({
      paper: 'LABEL',
      widthMm: 100,
      heightMm: 50,
      preset: 'CARD_LABEL',
    });
    // a hospital that chose A4 gets A4 (except the label)
    expect(defaultInput('REGISTRATION_SLIP', 'A4')).toMatchObject({ paper: 'A4' });
    expect(defaultInput('PATIENT_CARD', 'A4')).toMatchObject({ paper: 'LABEL' });
  });

  it('plain paper starts with the hospital name (bold, centred, on top); every other value has its caption as plain bold words in front', () => {
    const t = presetInput('A4_FULL', 'RECEIPT');
    const first = t.layout.elements[0]!;
    expect(first).toMatchObject({ type: 'RICH' });
    expect(first.content!.paragraphs[0]).toEqual({
      align: 'CENTER',
      runs: [{ t: 'field', field: 'hospitalName', style: { size: 15, bold: true } }],
    });
    const others = t.layout.elements.slice(1);
    expect(fieldsOf(t).slice(1)).toEqual(PRINT_FIELDS.RECEIPT.filter((k) => k !== 'hospitalName'));
    for (const e of others) {
      const [caption, value] = e.content!.paragraphs[0]!.runs;
      expect(caption).toMatchObject({ t: 'text', style: { bold: true } });
      expect((caption as { text: string }).text).toMatch(/: $/);
      expect(value!.t).toBe('field');
    }
    const patient = others.find(
      (e) => fieldsOf({ ...t, layout: { ...t.layout, elements: [e] } })[0] === 'patientName',
    )!;
    expect(wordsOf(patient)).toBe('Patient: ');
    // boxes stack downwards inside the margins
    const ys = others.map((e) => e.yMm);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.min(...others.map((e) => e.xMm))).toBeGreaterThanOrEqual(15);
  });

  it('a long document that does not fit one column is laid out in two columns, all on the page', () => {
    const t = presetInput('A5_FULL', 'PATIENT_REPORT');
    const page = pageSizeMm(t);
    const boxes = t.layout.elements.slice(1);
    expect(new Set(boxes.map((e) => e.xMm)).size).toBeGreaterThan(1);
    for (const e of t.layout.elements) {
      expect(e.xMm + e.widthMm).toBeLessThanOrEqual(page.widthMm);
      expect(e.yMm + e.heightMm).toBeLessThanOrEqual(page.heightMm);
    }
  });

  it('the label shows only a few values; the pre-printed preset holds only values, without words or letterhead', () => {
    const label = presetInput('LABEL_SLIP', 'RECEIPT');
    expect(fieldsOf(label).sort()).toEqual(
      ['billNumber', 'hospitalName', 'patientName', 'token', 'total'].sort(),
    );
    expect(label).toMatchObject({
      paper: 'LABEL',
      widthMm: 100,
      heightMm: 50,
      orientation: 'LANDSCAPE',
    });
    const pre = presetInput('PREPRINTED_BILL', 'RECEIPT');
    expect(pre.mode).toBe('PREPRINTED');
    for (const e of pre.layout.elements) {
      // nothing but a value in each box: the stationery has the words
      expect(e.type).toBe('RICH');
      expect(e.content!.paragraphs).toHaveLength(1);
      expect(e.content!.paragraphs[0]!.runs.map((r) => r.t)).toEqual(['field']);
    }
    // the stationery already has its own letterhead
    expect(fieldsOf(pre)).not.toContain('hospitalName');
    expect(() => presetInput('NOPE', 'RECEIPT')).toThrow();
  });

  it('knows the real page size, turning a standard paper on its side for landscape', () => {
    expect(
      pageSizeMm({ paper: 'A4', widthMm: null, heightMm: null, orientation: 'PORTRAIT' }),
    ).toEqual({
      widthMm: 210,
      heightMm: 297,
    });
    expect(
      pageSizeMm({ paper: 'A4', widthMm: null, heightMm: null, orientation: 'LANDSCAPE' }),
    ).toEqual({
      widthMm: 297,
      heightMm: 210,
    });
    expect(PAPER_SIZES_MM.A6).toEqual({ width: 105, height: 148 });
    // a label or custom size is the size of the page as entered (orientation does not turn it)
    expect(
      pageSizeMm({ paper: 'CUSTOM', widthMm: 240, heightMm: 140, orientation: 'PORTRAIT' }),
    ).toEqual({
      widthMm: 240,
      heightMm: 140,
    });
  });
});

describe('validateTemplate: what is accepted', () => {
  it('returns a clean template: version 3, no stray keys, a default nudge, a text box as a paragraph of words', () => {
    const raw = withChange('RECEIPT', (t) => {
      t.preset = null;
      delete t.layout.offset;
      t.layout.elements.push({
        id: 'note',
        type: 'TEXT',
        text: '  Demo Clinic  ',
        xMm: 10,
        yMm: 5,
        widthMm: 50,
        heightMm: 6,
        bold: true,
      });
    });
    const t = validateTemplate('RECEIPT', raw);
    expect(t.layout.version).toBe(3);
    expect(t.layout.elements.at(-1)).toEqual({
      id: 'note',
      type: 'RICH',
      xMm: 10,
      yMm: 5,
      widthMm: 50,
      heightMm: 6,
      content: {
        paragraphs: [{ runs: [{ t: 'text', text: 'Demo Clinic', style: { bold: true } }] }],
      },
    });
    expect(t.layout.offset).toEqual({ xMm: 0, yMm: 0 });
    expect(t.preset).toBeNull();
    expect(t.enabled).toBe(true);
  });

  it('accepts a custom paper with one-decimal sizes and a pre-printed layout with a nudge', () => {
    const raw = withChange('RECEIPT', (t) => {
      t.paper = 'CUSTOM';
      t.widthMm = 241.3;
      t.heightMm = 139.7;
      t.orientation = 'LANDSCAPE';
      t.mode = 'PREPRINTED';
      t.margins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
      t.layout.offset = { xMm: -2.5, yMm: 1.5 };
      t.layout.elements = [
        {
          id: 'a',
          type: 'FIELD',
          field: 'billNumber',
          xMm: 20.5,
          yMm: 30,
          widthMm: 60,
          heightMm: 6,
        },
        {
          id: 'b',
          type: 'FIELD',
          field: 'total',
          xMm: 180,
          yMm: 120,
          widthMm: 61.3,
          heightMm: 19.7,
        },
      ];
    });
    const t: PrintTemplateInput = validateTemplate('RECEIPT', raw);
    expect(t).toMatchObject({ widthMm: 241.3, heightMm: 139.7, mode: 'PREPRINTED' });
    expect(t.layout.offset).toEqual({ xMm: -2.5, yMm: 1.5 });
    // a field box without "caption" had its caption: it is now the words "Total: " in front of the value
    expect(t.layout.elements[1]!.content!.paragraphs[0]!.runs).toEqual([
      { t: 'text', text: 'Total: ', style: { bold: true } },
      { t: 'field', field: 'total' },
    ]);
    expect(t.layout.elements[1]).toMatchObject({ xMm: 180, widthMm: 61.3 });
  });

  it('accepts every kind of box; the style of an older box becomes the style of its words', () => {
    const raw = withChange('PRESCRIPTION', (t) => {
      t.layout.elements = [
        {
          id: 'f1',
          type: 'FIELD',
          field: 'medicines',
          caption: false,
          xMm: 10,
          yMm: 50,
          widthMm: 100,
          heightMm: 80,
          fontSizePt: 72,
          bold: true,
          italic: true,
          underline: true,
          align: 'RIGHT',
          font: 'MONO',
          tone: 'GREY',
        },
        { id: 'line-1', type: 'LINE', xMm: 10, yMm: 40, widthMm: 120, heightMm: 0.1, tone: 'GREY' },
        { id: 'logo_1', type: 'IMAGE', slot: 'LOGO', xMm: 10, yMm: 5, widthMm: 30, heightMm: 20 },
        {
          id: 't1',
          type: 'TEXT',
          text: 'Clinic\nOpen 9 to 5',
          xMm: 50,
          yMm: 5,
          widthMm: 90,
          heightMm: 12,
        },
      ];
    });
    const t = validateTemplate('PRESCRIPTION', raw);
    expect(t.layout.elements).toHaveLength(4);
    expect(t.layout.elements[0]!.content!.paragraphs[0]).toEqual({
      align: 'RIGHT',
      runs: [
        {
          t: 'field',
          field: 'medicines',
          style: {
            size: 72,
            bold: true,
            italic: true,
            underline: true,
            font: 'MONO',
            tone: 'GREY',
          },
        },
      ],
    });
    expect(t.layout.elements[1]).toMatchObject({ type: 'LINE', tone: 'GREY' });
    expect(t.layout.elements[2]).toMatchObject({ type: 'IMAGE', slot: 'LOGO' });
    // a text box of two lines is two paragraphs
    expect(
      t.layout.elements[3]!.content!.paragraphs.map((p) =>
        p.runs[0] && 'text' in p.runs[0] ? p.runs[0].text : '',
      ),
    ).toEqual(['Clinic', 'Open 9 to 5']);
  });

  it('a document can be switched off completely, and have no boxes at all', () => {
    expect(
      validateTemplate(
        'REGISTRATION_SLIP',
        withChange('REGISTRATION_SLIP', (t) => (t.enabled = false)),
      ).enabled,
    ).toBe(false);
    expect(
      validateTemplate(
        'REGISTRATION_SLIP',
        withChange('REGISTRATION_SLIP', (t) => (t.layout.elements = [])),
      ).layout.elements,
    ).toEqual([]);
  });

  it('the prescription accepts the doctor details of the doctor profile step already', () => {
    const doctorBox = (field: string) =>
      withChange('PRESCRIPTION', (t) => {
        t.layout.elements = [
          { id: 'd', type: 'FIELD', field, xMm: 10, yMm: 10, widthMm: 50, heightMm: 6 },
        ];
      });
    for (const key of [
      'doctorQualifications',
      'doctorSpeciality',
      'doctorRegistrationNo',
      'doctorSignature',
    ]) {
      expect(() => validateTemplate('PRESCRIPTION', doctorBox(key))).not.toThrow();
    }
    // but a receipt has no doctor registration number
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (r) => {
        r.layout.elements = [
          {
            id: 'd',
            type: 'FIELD',
            field: 'doctorRegistrationNo',
            xMm: 10,
            yMm: 10,
            widthMm: 50,
            heightMm: 6,
          },
        ];
      }),
      'layout.elements.0.field',
      'UNKNOWN_FIELD',
    );
  });
});

describe('validateTemplate: what is refused, field by field', () => {
  it('anything that is not an object', () => {
    for (const bad of [null, undefined, 5, 'text', ['a']]) {
      expectRefused('RECEIPT', bad, 'template', 'NOT_AN_OBJECT');
    }
  });

  it('unknown keys at every level are errors, never ignored', () => {
    expectRefused('RECEIPT', { ...valid(), tenantId: 'x' }, 'template.tenantId', 'UNKNOWN_FIELD');
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.margins.extraMm = 1)),
      'margins.extraMm',
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.script = 'x')),
      'layout.script',
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.offset.zMm = 1)),
      'layout.offset.zMm',
      'UNKNOWN_FIELD',
    );
  });

  it('a wrong type or a value that is not in the list', () => {
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.enabled = 'yes')),
      'enabled',
      'NOT_A_BOOLEAN',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.paper = 'A3')),
      'paper',
      'UNKNOWN_PAPER',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.orientation = 'SIDEWAYS')),
      'orientation',
      'UNKNOWN_ORIENTATION',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.mode = 'FANCY')),
      'mode',
      'UNKNOWN_MODE',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.preset = 'NOT_A_PRESET')),
      'preset',
      'UNKNOWN_PRESET',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.preset = 5)),
      'preset',
      'UNKNOWN_PRESET',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.version = 4)),
      'layout.version',
      'UNKNOWN_VERSION',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.margins = 5)),
      'margins',
      'NOT_AN_OBJECT',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout = 'x')),
      'layout',
      'NOT_AN_OBJECT',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.elements = {})),
      'layout.elements',
      'NOT_A_LIST',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.elements = [5])),
      'layout.elements.0',
      'NOT_AN_OBJECT',
    );
  });

  it('numbers: not a number, too many decimals, out of range', () => {
    const margin = (v: unknown) => withChange('RECEIPT', (t) => (t.margins.topMm = v));
    expectRefused('RECEIPT', margin('5'), 'margins.topMm', 'NOT_A_NUMBER');
    expectRefused('RECEIPT', margin(Number.NaN), 'margins.topMm', 'NOT_A_NUMBER');
    expectRefused('RECEIPT', margin(Infinity), 'margins.topMm', 'NOT_A_NUMBER');
    expectRefused('RECEIPT', margin(null), 'margins.topMm', 'NOT_A_NUMBER');
    expectRefused('RECEIPT', margin(5.25), 'margins.topMm', 'TOO_MANY_DECIMALS');
    expectRefused('RECEIPT', margin(-0.5), 'margins.topMm', 'OUT_OF_RANGE');
    expectRefused('RECEIPT', margin(100.1), 'margins.topMm', 'OUT_OF_RANGE');
    expect(() => validateTemplate('RECEIPT', margin(0))).not.toThrow();
    const font = (v: unknown) => withChange('RECEIPT', (t) => (t.layout.fontSizePt = v));
    expectRefused('RECEIPT', font(10.25), 'layout.fontSizePt', 'TOO_MANY_DECIMALS');
    expectRefused('RECEIPT', font(undefined), 'layout.fontSizePt', 'NOT_A_NUMBER');
  });

  it('font size and nudge stay inside their limits', () => {
    const font = (v: number) => withChange('RECEIPT', (t) => (t.layout.fontSizePt = v));
    expectRefused('RECEIPT', font(5), 'layout.fontSizePt', 'OUT_OF_RANGE');
    expectRefused('RECEIPT', font(25), 'layout.fontSizePt', 'OUT_OF_RANGE');
    expect(() => validateTemplate('RECEIPT', font(6))).not.toThrow();
    expect(() => validateTemplate('RECEIPT', font(24))).not.toThrow();
    const nudge = (x: number) =>
      withChange('RECEIPT', (t) => (t.layout.offset = { xMm: x, yMm: 0 }));
    expectRefused('RECEIPT', nudge(20.5), 'layout.offset.xMm', 'OUT_OF_RANGE');
    expectRefused('RECEIPT', nudge(-21), 'layout.offset.xMm', 'OUT_OF_RANGE');
    expect(() => validateTemplate('RECEIPT', nudge(-20))).not.toThrow();
  });

  it('a label or custom paper needs its size (20 to 1000 mm); a standard paper must not have one', () => {
    const custom = (extra: Record<string, unknown>) =>
      withChange('RECEIPT', (t) => {
        t.paper = 'CUSTOM';
        t.margins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
        Object.assign(t, extra);
      });
    expectRefused(
      'RECEIPT',
      custom({ widthMm: undefined, heightMm: 100 }),
      'widthMm',
      'REQUIRED_FOR_THIS_PAPER',
    );
    expectRefused(
      'RECEIPT',
      custom({ widthMm: 100, heightMm: null }),
      'heightMm',
      'REQUIRED_FOR_THIS_PAPER',
    );
    expectRefused('RECEIPT', custom({ widthMm: 19.9, heightMm: 100 }), 'widthMm', 'OUT_OF_RANGE');
    expectRefused(
      'RECEIPT',
      custom({ widthMm: 100, heightMm: 1000.1 }),
      'heightMm',
      'OUT_OF_RANGE',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.widthMm = 148)),
      'widthMm',
      'NOT_ALLOWED_FOR_THIS_PAPER',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.heightMm = 210)),
      'widthMm',
      'NOT_ALLOWED_FOR_THIS_PAPER',
    );
    const label = withChange('RECEIPT', (t) => {
      t.paper = 'LABEL';
      t.widthMm = 100;
      t.heightMm = 50;
      t.margins = { topMm: 3, rightMm: 3, bottomMm: 3, leftMm: 3 };
      t.layout.elements = []; // the boxes of an A5 page would not fit a label
    });
    expect(() => validateTemplate('RECEIPT', label)).not.toThrow();
  });

  it('margins must leave room to print (20 mm each way)', () => {
    const margins = (left: number, right: number, top = 5, bottom = 5) =>
      withChange(
        'RECEIPT',
        (t) => (t.margins = { topMm: top, rightMm: right, bottomMm: bottom, leftMm: left }),
      );
    // A5 portrait is 148 x 210
    expectRefused('RECEIPT', margins(70, 60), 'margins', 'NO_ROOM_TO_PRINT_ACROSS');
    expectRefused('RECEIPT', margins(5, 5, 100, 95), 'margins', 'NO_ROOM_TO_PRINT_DOWN');
    expect(() => validateTemplate('RECEIPT', margins(64, 64))).not.toThrow(); // exactly 20 mm left
    expectRefused('RECEIPT', margins(64.5, 64), 'margins', 'NO_ROOM_TO_PRINT_ACROSS');
    // landscape changes which way is the long one
    const landscape = withChange('RECEIPT', (t) => {
      t.orientation = 'LANDSCAPE';
      t.margins = { topMm: 70, rightMm: 5, bottomMm: 58, leftMm: 5 };
    });
    expect(() => validateTemplate('RECEIPT', landscape)).not.toThrow();
    landscape.margins = { topMm: 70, rightMm: 5, bottomMm: 59, leftMm: 5 } as never;
    expectRefused('RECEIPT', landscape, 'margins', 'NO_ROOM_TO_PRINT_DOWN');
  });

  it('text boxes: text only, not empty, 300 characters at most', () => {
    const textBox = (text: unknown) =>
      withChange('RECEIPT', (t) => {
        t.layout.elements = [
          { id: 't', type: 'TEXT', text, xMm: 10, yMm: 10, widthMm: 50, heightMm: 6 },
        ];
      });
    expectRefused('RECEIPT', textBox(5), 'layout.elements.0.text', 'NOT_TEXT');
    expectRefused('RECEIPT', textBox('   '), 'layout.elements.0.text', 'REQUIRED');
    expectRefused('RECEIPT', textBox(undefined), 'layout.elements.0.text', 'REQUIRED');
    expectRefused('RECEIPT', textBox('x'.repeat(301)), 'layout.elements.0.text', 'TOO_LONG');
    expect(() => validateTemplate('RECEIPT', textBox('x'.repeat(300)))).not.toThrow();
  });

  describe('the boxes', () => {
    // A box is built like JSON: a key set to undefined is a key that is not there.
    const one = (box: Record<string, unknown>) =>
      withChange('RECEIPT', (t) => {
        const element: Record<string, unknown> = {
          id: 'a',
          type: 'FIELD',
          field: 'total',
          xMm: 10,
          yMm: 10,
          widthMm: 50,
          heightMm: 6,
          ...box,
        };
        for (const key of Object.keys(element)) {
          if (element[key] === undefined) delete element[key];
        }
        t.layout.elements = [element];
      });
    const bad = (box: Record<string, unknown>, field: string, reason: string) =>
      expectRefused('RECEIPT', one(box), `layout.elements.0.${field}`, reason);

    it('a box has a known type, a safe id and only the keys of its type', () => {
      bad({ type: 'CIRCLE' }, 'type', 'UNKNOWN_TYPE');
      bad({ type: undefined }, 'type', 'UNKNOWN_TYPE');
      bad({ id: '' }, 'id', 'BAD_ID');
      bad({ id: 'has space' }, 'id', 'BAD_ID');
      bad({ id: '<script>' }, 'id', 'BAD_ID');
      bad({ id: 'x'.repeat(41) }, 'id', 'BAD_ID');
      bad({ id: 5 }, 'id', 'BAD_ID');
      expect(() => validateTemplate('RECEIPT', one({ id: 'x'.repeat(40) }))).not.toThrow();
      // a text on a field box, a field on a text box, a slot on a line: stray keys are errors
      bad({ text: 'hello' }, 'text', 'UNKNOWN_FIELD');
      bad({ script: 'x' }, 'script', 'UNKNOWN_FIELD');
      expectRefused(
        'RECEIPT',
        one({ type: 'LINE', field: 'total', heightMm: 1 }),
        'layout.elements.0.field',
        'UNKNOWN_FIELD',
      );
      expectRefused(
        'RECEIPT',
        one({ type: 'IMAGE', field: undefined, bold: true }),
        'layout.elements.0.bold',
        'UNKNOWN_FIELD',
      );
    });

    it('two boxes can never share an id', () => {
      const t = withChange('RECEIPT', (r) => {
        r.layout.elements = [
          { id: 'a', type: 'FIELD', field: 'total', xMm: 10, yMm: 10, widthMm: 50, heightMm: 6 },
          { id: 'a', type: 'FIELD', field: 'paid', xMm: 10, yMm: 20, widthMm: 50, heightMm: 6 },
        ];
      });
      expectRefused('RECEIPT', t, 'layout.elements.1.id', 'DUPLICATE_ID');
    });

    it('a field box names a value of THIS document', () => {
      bad({ field: 'nonsense' }, 'field', 'UNKNOWN_FIELD');
      bad({ field: 'medicines' }, 'field', 'UNKNOWN_FIELD'); // a prescription value, not a receipt one
      bad({ field: undefined }, 'field', 'UNKNOWN_FIELD');
      bad({ field: 5 }, 'field', 'UNKNOWN_FIELD');
      bad({ caption: 'yes' }, 'caption', 'NOT_A_BOOLEAN');
    });

    it('position and size: numbers, one decimal, on the page', () => {
      // A5 portrait is 148 x 210
      bad({ xMm: '10' }, 'xMm', 'NOT_A_NUMBER');
      bad({ yMm: Number.NaN }, 'yMm', 'NOT_A_NUMBER');
      bad({ xMm: 10.25 }, 'xMm', 'TOO_MANY_DECIMALS');
      bad({ xMm: -0.1 }, 'xMm', 'OUT_OF_RANGE');
      bad({ yMm: 210.1 }, 'yMm', 'OUT_OF_RANGE');
      bad({ widthMm: 0.9 }, 'widthMm', 'OUT_OF_RANGE');
      bad({ heightMm: 0 }, 'heightMm', 'OUT_OF_RANGE');
      bad({ widthMm: 149 }, 'widthMm', 'OUT_OF_RANGE');
      // a box that sticks out past the edge would be cut off by the printer
      bad({ xMm: 100, widthMm: 50 }, 'widthMm', 'OUT_OF_PAGE');
      bad({ yMm: 205, heightMm: 6 }, 'heightMm', 'OUT_OF_PAGE');
      expect(() =>
        validateTemplate('RECEIPT', one({ xMm: 98, widthMm: 50, yMm: 204, heightMm: 6 })),
      ).not.toThrow(); // exactly to the edge
    });

    it('a line can be very thin; a box cannot', () => {
      expect(() =>
        validateTemplate(
          'RECEIPT',
          one({ type: 'LINE', field: undefined, widthMm: 100, heightMm: 0.1 }),
        ),
      ).not.toThrow();
      expectRefused(
        'RECEIPT',
        one({ type: 'LINE', field: undefined, widthMm: 100, heightMm: 0 }),
        'layout.elements.0.heightMm',
        'OUT_OF_RANGE',
      );
    });

    it('style: font size 6 to 72, real booleans, known alignment, font and tone', () => {
      bad({ fontSizePt: 5.9 }, 'fontSizePt', 'OUT_OF_RANGE');
      bad({ fontSizePt: 72.5 }, 'fontSizePt', 'OUT_OF_RANGE');
      bad({ fontSizePt: 10.25 }, 'fontSizePt', 'TOO_MANY_DECIMALS');
      bad({ bold: 'yes' }, 'bold', 'NOT_A_BOOLEAN');
      bad({ italic: 1 }, 'italic', 'NOT_A_BOOLEAN');
      bad({ underline: null }, 'underline', 'NOT_A_BOOLEAN');
      bad({ align: 'JUSTIFY' }, 'align', 'UNKNOWN_ALIGN');
      bad({ font: 'COMIC' }, 'font', 'UNKNOWN_FONT');
      bad({ tone: 'RED' }, 'tone', 'UNKNOWN_TONE');
      expect(() =>
        validateTemplate('RECEIPT', one({ fontSizePt: 6, tone: 'BLACK' })),
      ).not.toThrow();
    });

    it('a picture box has a known slot', () => {
      expectRefused(
        'RECEIPT',
        one({ type: 'IMAGE', field: undefined, slot: 'PHOTO' }),
        'layout.elements.0.slot',
        'UNKNOWN_SLOT',
      );
      const t = validateTemplate(
        'RECEIPT',
        one({ type: 'IMAGE', field: undefined, caption: undefined }),
      );
      expect(t.layout.elements[0]!.slot).toBe('LOGO');
    });

    it('at most 40 boxes, and the saved layout stays well under the database limit', () => {
      const boxes = (n: number, extra: Record<string, unknown> = {}) =>
        Array.from({ length: n }, (_, i) => ({
          id: `b${i}`,
          type: 'TEXT',
          text: 'x',
          xMm: 1,
          yMm: 1,
          widthMm: 20,
          heightMm: 6,
          ...extra,
        }));
      expect(() =>
        validateTemplate(
          'REGISTRATION_SLIP',
          withChange('REGISTRATION_SLIP', (t) => (t.layout.elements = boxes(40))),
        ),
      ).not.toThrow();
      expectRefused(
        'RECEIPT',
        withChange('RECEIPT', (t) => (t.layout.elements = boxes(41))),
        'layout.elements',
        'TOO_MANY',
      );
      // 40 boxes of 300 characters is about 18 000 characters: too large for the database column
      expectRefused(
        'RECEIPT',
        withChange('RECEIPT', (t) => (t.layout.elements = boxes(40, { text: 'y'.repeat(300) }))),
        'layout',
        'TOO_LARGE',
      );
    });
  });

  it('a prototype-pollution style key is just an unknown field', () => {
    const raw = JSON.parse(
      JSON.stringify(valid()).replace('"elements":[{', '"elements":[{"__proto__":true,'),
    ) as unknown;
    expect(refusal(() => validateTemplate('RECEIPT', raw))).toMatchObject({
      code: 'PRINT_TEMPLATE_INVALID',
      reason: 'UNKNOWN_FIELD',
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('older (version 1) templates are converted to boxes', () => {
  /** What the first version of the screen saved: fields on or off, positions for pre-printed stationery. */
  function legacy(docType: PrintDocType, change: (t: Record<string, Loose>) => void = () => {}) {
    const t = valid(docType);
    t.layout = {
      version: 1,
      fontSizePt: 10,
      headerText: 'Demo Clinic\nMysuru',
      footerText: 'Thank you',
      showLogo: true,
      fields: Object.fromEntries(
        PRINT_FIELDS[docType].map((k) => [
          k,
          ['hospitalName', 'billNumber', 'total', 'token'].includes(k),
        ]),
      ),
      offset: { xMm: 1.5, yMm: 0 },
      positions: {},
    };
    change(t as Record<string, Loose>);
    return t;
  }

  it('the same fields appear as boxes, the header and footer become text boxes, the nudge is kept', () => {
    const t = validateTemplate('RECEIPT', legacy('RECEIPT'));
    expect(t.layout.version).toBe(3);
    expect(t.layout.fontSizePt).toBe(10);
    expect(t.layout.offset).toEqual({ xMm: 1.5, yMm: 0 });
    expect(fieldsOf(t).sort()).toEqual(['billNumber', 'hospitalName', 'token', 'total']);
    const texts = t.layout.elements
      .filter(
        (e) =>
          e.type === 'RICH' && !fieldsOf({ ...t, layout: { ...t.layout, elements: [e] } }).length,
      )
      .map(wordsOf);
    expect(texts).toEqual(['Demo Clinic\nMysuru', 'Thank you']);
  });

  it('a field left out of an old template was shown, so it becomes a box', () => {
    const t = validateTemplate(
      'RECEIPT',
      legacy('RECEIPT', (r) => {
        r.layout.fields = {};
      }),
    );
    expect(fieldsOf(t)).toHaveLength(PRINT_FIELDS.RECEIPT.length);
  });

  it('old pre-printed positions become the places of the boxes, with only the value in each', () => {
    const t = validateTemplate(
      'RECEIPT',
      legacy('RECEIPT', (r) => {
        r.paper = 'CUSTOM';
        r.widthMm = 240;
        r.heightMm = 140;
        r.mode = 'PREPRINTED';
        r.margins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
        r.layout.positions = { billNumber: { xMm: 20.5, yMm: 30 }, total: { xMm: 200, yMm: 120 } };
      }),
    );
    const byField = Object.fromEntries(
      t.layout.elements.map((e) => [
        fieldsOf({ ...t, layout: { ...t.layout, elements: [e] } })[0],
        e,
      ]),
    );
    expect(byField.billNumber).toMatchObject({ xMm: 20.5, yMm: 30 });
    expect(byField.billNumber!.content!.paragraphs[0]!.runs.map((r) => r.t)).toEqual(['field']);
    expect(fieldsOf(t)).not.toContain('hospitalName');
    // a box near the corner is pulled back inside the page
    expect(byField.total!.xMm + byField.total!.widthMm).toBeLessThanOrEqual(240);
    expect(byField.total!.yMm + byField.total!.heightMm).toBeLessThanOrEqual(140);
  });

  it('the rules of version 1 still apply to version 1 input', () => {
    expectRefused(
      'RECEIPT',
      legacy('RECEIPT', (r) => (r.layout.fields.doctorRegistrationNo = true)),
      'layout.fields.doctorRegistrationNo',
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      legacy('RECEIPT', (r) => (r.layout.positions = { total: { xMm: 10, yMm: 10 } })),
      'layout.positions',
      'ONLY_FOR_PREPRINTED',
    );
    expectRefused(
      'RECEIPT',
      legacy('RECEIPT', (r) => (r.layout.showLogo = 'no')),
      'layout.showLogo',
      'NOT_A_BOOLEAN',
    );
    expectRefused(
      'RECEIPT',
      legacy('RECEIPT', (r) => (r.layout.footerText = 'x'.repeat(301))),
      'layout.footerText',
      'TOO_LONG',
    );
  });

  it('a layout with neither a version nor boxes is read as version 1', () => {
    const t = legacy('RECEIPT', (r) => {
      delete r.layout.version;
    });
    expect(validateTemplate('RECEIPT', t).layout.version).toBe(3);
  });
});

describe('version 3: rich text boxes', () => {
  const v3 = (docType: PrintDocType = 'RECEIPT'): Record<string, Loose> =>
    JSON.parse(JSON.stringify(presetInput('A5_FULL', docType))) as Record<string, Loose>;
  const withBox = (box: Record<string, unknown>, docType: PrintDocType = 'RECEIPT') => {
    const t = v3(docType);
    t.layout.elements = [
      { id: 'a', type: 'RICH', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20, ...box },
    ];
    return t;
  };
  const rich = (paragraphs: unknown, docType: PrintDocType = 'RECEIPT') =>
    withBox({ content: { paragraphs } }, docType);
  const runs = (...r: unknown[]) => [{ runs: r }];
  const BASE = 'layout.elements.0';
  const C0 = `${BASE}.content`;

  it('a box of typed words with values placed inside, each stretch with its own style, is kept exactly', () => {
    const t = validateTemplate(
      'PRESCRIPTION',
      rich(
        [
          {
            align: 'CENTER',
            runs: [
              { t: 'text', text: 'Dear ', style: { italic: true } },
              {
                t: 'field',
                field: 'patientName',
                style: { size: 14, bold: true, underline: true },
              },
              { t: 'text', text: ', your ', style: { font: 'SERIF', tone: 'GREY' } },
              { t: 'field', field: 'doctorName' },
            ],
          },
          { runs: [] },
          { runs: [{ t: 'text', text: ' spaces are kept ' }] },
        ],
        'PRESCRIPTION',
      ),
    );
    const paragraphs = t.layout.elements[0]!.content!.paragraphs;
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]!.align).toBe('CENTER');
    expect(paragraphs[0]!.runs).toHaveLength(4);
    expect(paragraphs[1]!.runs).toEqual([]);
    expect(paragraphs[2]!.runs[0]).toEqual({ t: 'text', text: ' spaces are kept ' });
  });

  it('a value must belong to THIS document', () => {
    expectRefused(
      'RECEIPT',
      rich(runs({ t: 'field', field: 'medicines' })),
      `${C0}.paragraphs.0.runs.0.field`,
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      rich(runs({ t: 'field' })),
      `${C0}.paragraphs.0.runs.0.field`,
      'UNKNOWN_FIELD',
    );
  });

  it('a stretch is words or a value, with only its own keys', () => {
    const at = (r: unknown, field: string, reason: string) =>
      expectRefused('RECEIPT', rich(runs(r)), `${C0}.paragraphs.0.runs.0${field}`, reason);
    at({ t: 'image' }, '.t', 'UNKNOWN_TYPE');
    at({}, '.t', 'UNKNOWN_TYPE');
    at('words', '', 'NOT_AN_OBJECT');
    at({ t: 'text', text: 5 }, '.text', 'NOT_TEXT');
    at({ t: 'text', text: '' }, '.text', 'REQUIRED');
    at({ t: 'text', text: 'a\nb' }, '.text', 'NOT_TEXT');
    at({ t: 'text', text: 'a\rb' }, '.text', 'NOT_TEXT');
    at({ t: 'text', text: 'x'.repeat(301) }, '.text', 'TOO_LONG');
    at({ t: 'text', text: 'x', field: 'uhid' }, '.field', 'UNKNOWN_FIELD');
    at({ t: 'field', field: 'uhid', text: 'x' }, '.text', 'UNKNOWN_FIELD');
    at({ t: 'text', text: 'x', html: '<b>' }, '.html', 'UNKNOWN_FIELD');
    expect(() =>
      validateTemplate('RECEIPT', rich(runs({ t: 'text', text: 'x'.repeat(300) }))),
    ).not.toThrow();
  });

  it('a style has a size from 6 to 72, real booleans and known font and colour', () => {
    const style = (st: unknown, field: string, reason: string) =>
      expectRefused(
        'RECEIPT',
        rich(runs({ t: 'text', text: 'x', style: st })),
        `${C0}.paragraphs.0.runs.0.style${field}`,
        reason,
      );
    style({ size: 5.9 }, '.size', 'OUT_OF_RANGE');
    style({ size: 72.1 }, '.size', 'OUT_OF_RANGE');
    style({ size: 10.25 }, '.size', 'TOO_MANY_DECIMALS');
    style({ size: '12' }, '.size', 'NOT_A_NUMBER');
    style({ bold: 'yes' }, '.bold', 'NOT_A_BOOLEAN');
    style({ italic: 1 }, '.italic', 'NOT_A_BOOLEAN');
    style({ underline: null }, '.underline', 'NOT_A_BOOLEAN');
    style({ font: 'COMIC' }, '.font', 'UNKNOWN_FONT');
    style({ tone: 'RED' }, '.tone', 'UNKNOWN_TONE');
    style({ color: 'red' }, '.color', 'UNKNOWN_FIELD');
    style('bold', '', 'NOT_AN_OBJECT');
    expect(() =>
      validateTemplate(
        'RECEIPT',
        rich(runs({ t: 'text', text: 'x', style: { size: 6, font: 'MONO', tone: 'BLACK' } })),
      ),
    ).not.toThrow();
    expect(() =>
      validateTemplate('RECEIPT', rich(runs({ t: 'text', text: 'x', style: { size: 72 } }))),
    ).not.toThrow();
  });

  it('a paragraph has a known alignment and only its own keys', () => {
    expectRefused(
      'RECEIPT',
      rich([{ align: 'JUSTIFY', runs: [] }]),
      `${C0}.paragraphs.0.align`,
      'UNKNOWN_ALIGN',
    );
    expectRefused(
      'RECEIPT',
      rich([{ runs: [], style: {} }]),
      `${C0}.paragraphs.0.style`,
      'UNKNOWN_FIELD',
    );
    expectRefused('RECEIPT', rich([{ align: 'LEFT' }]), `${C0}.paragraphs.0.runs`, 'NOT_A_LIST');
    expectRefused('RECEIPT', rich(['text']), `${C0}.paragraphs.0`, 'NOT_AN_OBJECT');
  });

  it('a box has at least one paragraph, at most 30, and at most 40 stretches in one', () => {
    expectRefused('RECEIPT', rich([]), `${C0}.paragraphs`, 'REQUIRED');
    expectRefused('RECEIPT', rich({}), `${C0}.paragraphs`, 'NOT_A_LIST');
    expect(() =>
      validateTemplate('RECEIPT', rich(Array.from({ length: 30 }, () => ({ runs: [] })))),
    ).not.toThrow();
    expectRefused(
      'RECEIPT',
      rich(Array.from({ length: 31 }, () => ({ runs: [] }))),
      `${C0}.paragraphs`,
      'TOO_MANY',
    );
    const many = (n: number) =>
      runs(...Array.from({ length: n }, () => ({ t: 'text', text: 'x' })));
    expect(() => validateTemplate('RECEIPT', rich(many(40)))).not.toThrow();
    expectRefused('RECEIPT', rich(many(41)), `${C0}.paragraphs.0.runs`, 'TOO_MANY');
  });

  it('a rich box needs its content, a line or a picture must not carry one', () => {
    expectRefused('RECEIPT', withBox({}), `${BASE}.content`, 'REQUIRED');
    expectRefused('RECEIPT', withBox({ content: 'x' }), C0, 'NOT_AN_OBJECT');
    expectRefused(
      'RECEIPT',
      withBox({ content: { paragraphs: [{ runs: [] }], extra: 1 } }),
      `${C0}.extra`,
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      withBox({ type: 'LINE', heightMm: 0.3, content: { paragraphs: [] } }),
      `${BASE}.content`,
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      withBox({ type: 'IMAGE', content: { paragraphs: [] } }),
      `${BASE}.content`,
      'UNKNOWN_FIELD',
    );
  });

  it('lines and pictures keep their own rules', () => {
    const line = withBox({ type: 'LINE', heightMm: 0.1, widthMm: 100, tone: 'GREY' });
    expect(validateTemplate('RECEIPT', line).layout.elements[0]).toMatchObject({
      type: 'LINE',
      tone: 'GREY',
    });
    expectRefused(
      'RECEIPT',
      withBox({ type: 'LINE', heightMm: 0 }),
      `${BASE}.heightMm`,
      'OUT_OF_RANGE',
    );
    expectRefused(
      'RECEIPT',
      withBox({ type: 'IMAGE', slot: 'PHOTO' }),
      `${BASE}.slot`,
      'UNKNOWN_SLOT',
    );
    expect(validateTemplate('RECEIPT', withBox({ type: 'IMAGE' })).layout.elements[0]!.slot).toBe(
      'LOGO',
    );
    // the old kinds of box are not version 3
    expectRefused(
      'RECEIPT',
      withBox({ type: 'FIELD', field: 'uhid' }),
      `${BASE}.type`,
      'UNKNOWN_TYPE',
    );
  });

  it('a box stays on the page, ids are safe and unique, at most 40 boxes', () => {
    expectRefused(
      'RECEIPT',
      withBox({ content: { paragraphs: [{ runs: [] }] }, xMm: 100, widthMm: 50 }),
      `${BASE}.widthMm`,
      'OUT_OF_PAGE',
    );
    expectRefused(
      'RECEIPT',
      withBox({ content: { paragraphs: [{ runs: [] }] }, id: '<x>' }),
      `${BASE}.id`,
      'BAD_ID',
    );
    const two = v3();
    const content = { paragraphs: [{ runs: [] }] };
    two.layout.elements = [
      { id: 'a', type: 'RICH', xMm: 1, yMm: 1, widthMm: 10, heightMm: 5, content },
      { id: 'a', type: 'RICH', xMm: 1, yMm: 9, widthMm: 10, heightMm: 5, content },
    ];
    expectRefused('RECEIPT', two, 'layout.elements.1.id', 'DUPLICATE_ID');
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `b${i}`,
        type: 'RICH',
        xMm: 1,
        yMm: 1,
        widthMm: 10,
        heightMm: 5,
        content,
      }));
    two.layout.elements = many(41);
    expectRefused('RECEIPT', two, 'layout.elements', 'TOO_MANY');
    // exactly 40 boxes, one of them showing the token (a receipt must)
    two.layout.elements = [
      ...many(39),
      {
        id: 'tok',
        type: 'RICH',
        xMm: 1,
        yMm: 1,
        widthMm: 10,
        heightMm: 5,
        content: { paragraphs: [{ runs: [{ t: 'field', field: 'token' }] }] },
      },
    ];
    expect(() => validateTemplateStrict('RECEIPT', two)).not.toThrow();
  });

  it('a layout too big to store is refused with TOO_LARGE, not a database error', () => {
    const t = v3();
    t.layout.elements = Array.from({ length: 40 }, (_, i) => ({
      id: `b${i}`,
      type: 'RICH',
      xMm: 1,
      yMm: 1,
      widthMm: 10,
      heightMm: 5,
      content: {
        paragraphs: [
          { runs: Array.from({ length: 4 }, () => ({ t: 'text', text: 'y'.repeat(300) })) },
        ],
      },
    }));
    expectRefused('RECEIPT', t, 'layout', 'TOO_LARGE');
  });

  it('a version 2 layout is converted: the values, ids and places carry over', () => {
    const old = JSON.parse(JSON.stringify(presetInputV2('A5_FULL', 'RECEIPT'))) as Record<
      string,
      Loose
    >;
    const before = old.layout.elements.length;
    const t = validateTemplate('RECEIPT', old);
    expect(t.layout.version).toBe(3);
    expect(t.layout.elements).toHaveLength(before);
    expect(fieldsOf(t)).toEqual(PRINT_FIELDS.RECEIPT);
    for (let i = 0; i < before; i += 1) {
      expect(t.layout.elements[i]).toMatchObject({
        id: old.layout.elements[i].id,
        xMm: old.layout.elements[i].xMm,
        yMm: old.layout.elements[i].yMm,
        widthMm: old.layout.elements[i].widthMm,
        heightMm: old.layout.elements[i].heightMm,
      });
    }
  });

  it('a version 3 template can be read again and again without changing', () => {
    for (const docType of PRINT_DOC_TYPES) {
      const once = validateTemplate(docType, presetInput('A4_FULL', docType));
      const twice = validateTemplate(docType, JSON.parse(JSON.stringify(once)));
      expect(twice).toEqual(once);
    }
  });
});

describe('the token is mandatory on a receipt (D5-4)', () => {
  const tokenBox = {
    id: 'tok',
    type: 'RICH',
    xMm: 1,
    yMm: 1,
    widthMm: 20,
    heightMm: 6,
    content: { paragraphs: [{ runs: [{ t: 'field', field: 'token' }] }] },
  };
  const otherBox = {
    id: 'bill',
    type: 'RICH',
    xMm: 1,
    yMm: 10,
    widthMm: 20,
    heightMm: 6,
    content: { paragraphs: [{ runs: [{ t: 'field', field: 'billNumber' }] }] },
  };
  const v3Receipt = (elements: unknown[]): Record<string, Loose> => {
    const t = JSON.parse(JSON.stringify(presetInput('A5_FULL', 'RECEIPT'))) as Record<
      string,
      Loose
    >;
    t.layout.elements = elements;
    return t;
  };

  it('every built-in receipt starting point has a token box', () => {
    for (const preset of ['A4_FULL', 'A5_FULL', 'LABEL_SLIP', 'PREPRINTED_BILL']) {
      expect(fieldsOf(presetInput(preset, 'RECEIPT'))).toContain('token');
      expect(() => validateTemplateStrict('RECEIPT', presetInput(preset, 'RECEIPT'))).not.toThrow();
    }
    expect(fieldsOf(defaultInput('RECEIPT'))).toContain('token');
  });

  it('a custom receipt without a token box is refused in plain terms (version 3)', () => {
    expect(refusal(() => validateTemplateStrict('RECEIPT', v3Receipt([otherBox])))).toMatchObject({
      code: 'PRINT_TEMPLATE_INVALID',
      field: 'layout.elements',
      reason: 'TOKEN_REQUIRED',
    });
    expect(refusal(() => validateTemplateStrict('RECEIPT', v3Receipt([])))).toMatchObject({
      reason: 'TOKEN_REQUIRED',
    });
    // a text that merely says "token" is not the token value
    const typed = {
      ...otherBox,
      content: { paragraphs: [{ runs: [{ t: 'text', text: 'Token' }] }] },
    };
    expect(refusal(() => validateTemplateStrict('RECEIPT', v3Receipt([typed])))).toMatchObject({
      reason: 'TOKEN_REQUIRED',
    });
    expect(() => validateTemplateStrict('RECEIPT', v3Receipt([otherBox, tokenBox]))).not.toThrow();
  });

  it('also when the token is switched off in a version 1 or version 2 template', () => {
    const v1 = JSON.parse(JSON.stringify(presetInputV2('A5_FULL', 'RECEIPT'))) as Record<
      string,
      Loose
    >;
    v1.layout = {
      version: 1,
      fontSizePt: 10,
      headerText: '',
      footerText: '',
      showLogo: true,
      fields: { token: false },
      offset: { xMm: 0, yMm: 0 },
      positions: {},
    };
    expect(refusal(() => validateTemplateStrict('RECEIPT', v1))).toMatchObject({
      reason: 'TOKEN_REQUIRED',
    });
    v1.layout.fields = { token: true };
    expect(() => validateTemplateStrict('RECEIPT', v1)).not.toThrow();
    const v2 = withChange('RECEIPT', (t) => {
      t.layout.elements = t.layout.elements.filter((e: Loose) => e.field !== 'token');
    });
    expect(refusal(() => validateTemplateStrict('RECEIPT', v2))).toMatchObject({
      reason: 'TOKEN_REQUIRED',
    });
  });

  it('a switched-off receipt template still needs its token; other documents do not', () => {
    const off = v3Receipt([otherBox]);
    off.enabled = false;
    expect(refusal(() => validateTemplateStrict('RECEIPT', off))).toMatchObject({
      reason: 'TOKEN_REQUIRED',
    });
    const slip = JSON.parse(JSON.stringify(presetInput('A5_FULL', 'REGISTRATION_SLIP'))) as Record<
      string,
      Loose
    >;
    slip.layout.elements = [];
    expect(() => validateTemplateStrict('REGISTRATION_SLIP', slip)).not.toThrow();
  });
});
