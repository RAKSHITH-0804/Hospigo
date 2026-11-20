import {
  DEFAULT_PRESET_BY_DOC,
  PAPER_SIZES_MM,
  PRESETS,
  PRINT_DOC_TYPES,
  PRINT_FIELDS,
  defaultInput,
  pageSizeMm,
  presetInput,
  validateTemplate,
  type PrintDocType,
  type PrintTemplateInput,
} from './print-template.rules';

/** A valid template to start every refusal test from. */
function valid(docType: PrintDocType = 'RECEIPT'): Record<string, unknown> {
  const t = presetInput('A5_FULL', docType);
  return JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
}
/** Test bodies are edited field by field, so they are loosely typed on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
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
  it('every preset gives every document a template the validator accepts', () => {
    for (const key of Object.keys(PRESETS)) {
      for (const docType of PRINT_DOC_TYPES) {
        const t = presetInput(key, docType);
        expect(() => validateTemplate(docType, t)).not.toThrow();
        expect(Object.keys(t.layout.fields).sort()).toEqual([...PRINT_FIELDS[docType]].sort());
      }
    }
  });

  it('a hospital that saved nothing gets the built-in default of each document', () => {
    for (const docType of PRINT_DOC_TYPES) {
      const t = defaultInput(docType);
      expect(t.preset).toBe(DEFAULT_PRESET_BY_DOC[docType]);
      expect(t.enabled).toBe(true);
      expect(() => validateTemplate(docType, t)).not.toThrow();
    }
    expect(defaultInput('RECEIPT')).toMatchObject({ paper: 'A5', mode: 'FULL' });
    expect(defaultInput('REGISTRATION_SLIP')).toMatchObject({ paper: 'A4' });
    expect(defaultInput('PRESCRIPTION')).toMatchObject({ paper: 'A4' });
  });

  it('the label shows only a few fields; the pre-printed preset has a position for each visible field', () => {
    const label = presetInput('LABEL_SLIP', 'RECEIPT');
    expect(
      Object.entries(label.layout.fields)
        .filter(([, on]) => on)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['billNumber', 'patientName', 'token', 'total'].sort());
    expect(label).toMatchObject({
      paper: 'LABEL',
      widthMm: 100,
      heightMm: 50,
      orientation: 'LANDSCAPE',
    });
    const pre = presetInput('PREPRINTED_BILL', 'RECEIPT');
    expect(pre.mode).toBe('PREPRINTED');
    const visible = Object.entries(pre.layout.fields)
      .filter(([, on]) => on)
      .map(([k]) => k);
    expect(Object.keys(pre.layout.positions).sort()).toEqual(visible.sort());
    expect(pre.layout.showLogo).toBe(false); // the stationery already has its own letterhead
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
  it('returns a clean template: trimmed text, every field of the document present', () => {
    const raw = withChange('PRESCRIPTION', (t) => {
      t.layout.headerText = '  Demo Clinic  ';
      delete t.layout.fields.advice; // a field left out is shown
      delete t.layout.positions;
      delete t.layout.offset;
      t.preset = null;
    });
    const t = validateTemplate('PRESCRIPTION', raw);
    expect(t.layout.headerText).toBe('Demo Clinic');
    expect(t.layout.fields.advice).toBe(true);
    expect(t.layout.offset).toEqual({ xMm: 0, yMm: 0 });
    expect(t.layout.positions).toEqual({});
    expect(t.preset).toBeNull();
    expect(t.enabled).toBe(true);
  });

  it('accepts a custom paper with one-decimal sizes and a pre-printed layout with positions and a nudge', () => {
    const raw = withChange('RECEIPT', (t) => {
      t.paper = 'CUSTOM';
      t.widthMm = 241.3;
      t.heightMm = 139.7;
      t.orientation = 'LANDSCAPE';
      t.mode = 'PREPRINTED';
      t.margins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
      t.layout.offset = { xMm: -2.5, yMm: 1.5 };
      t.layout.positions = { billNumber: { xMm: 20.5, yMm: 30 }, total: { xMm: 200, yMm: 120 } };
    });
    const t: PrintTemplateInput = validateTemplate('RECEIPT', raw);
    expect(t).toMatchObject({ widthMm: 241.3, heightMm: 139.7, mode: 'PREPRINTED' });
    expect(t.layout.offset).toEqual({ xMm: -2.5, yMm: 1.5 });
    expect(t.layout.positions.total).toEqual({ xMm: 200, yMm: 120 });
  });

  it('a document can be switched off completely', () => {
    expect(
      validateTemplate(
        'REGISTRATION_SLIP',
        withChange('REGISTRATION_SLIP', (t) => (t.enabled = false)),
      ).enabled,
    ).toBe(false);
  });

  it('the prescription accepts the doctor details of the doctor profile step already', () => {
    const t = validateTemplate('PRESCRIPTION', valid('PRESCRIPTION'));
    for (const key of [
      'doctorQualifications',
      'doctorSpeciality',
      'doctorRegistrationNo',
      'doctorSignature',
    ]) {
      expect(t.layout.fields[key]).toBe(true);
    }
    // but a receipt has no doctor registration number
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (r) => (r.layout.fields.doctorRegistrationNo = true)),
      'layout.fields.doctorRegistrationNo',
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
      withChange('RECEIPT', (t) => (t.layout.showLogo = 'no')),
      'layout.showLogo',
      'NOT_A_BOOLEAN',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.version = 2)),
      'layout.version',
      'UNKNOWN_VERSION',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.fields.total = 'yes')),
      'layout.fields.total',
      'NOT_A_BOOLEAN',
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
      withChange('RECEIPT', (t) => (t.layout.fields = [])),
      'layout.fields',
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

  it('header and footer text: text only, 300 characters at most', () => {
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.headerText = 5)),
      'layout.headerText',
      'NOT_TEXT',
    );
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.footerText = 'x'.repeat(301))),
      'layout.footerText',
      'TOO_LONG',
    );
    expect(() =>
      validateTemplate(
        'RECEIPT',
        withChange('RECEIPT', (t) => (t.layout.footerText = 'x'.repeat(300))),
      ),
    ).not.toThrow();
  });

  it('positions: only on pre-printed stationery, only for real fields, only on the page', () => {
    expectRefused(
      'RECEIPT',
      withChange('RECEIPT', (t) => (t.layout.positions = { total: { xMm: 10, yMm: 10 } })),
      'layout.positions',
      'ONLY_FOR_PREPRINTED',
    );
    const pre = (positions: unknown) =>
      withChange('RECEIPT', (t) => {
        t.paper = 'CUSTOM';
        t.widthMm = 240;
        t.heightMm = 140;
        t.mode = 'PREPRINTED';
        t.margins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
        t.layout.positions = positions;
      });
    expectRefused(
      'RECEIPT',
      pre({ nonsense: { xMm: 1, yMm: 1 } }),
      'layout.positions.nonsense',
      'UNKNOWN_FIELD',
    );
    expectRefused(
      'RECEIPT',
      pre({ total: { xMm: 241, yMm: 1 } }),
      'layout.positions.total.xMm',
      'OUT_OF_RANGE',
    );
    expectRefused(
      'RECEIPT',
      pre({ total: { xMm: 1, yMm: 141 } }),
      'layout.positions.total.yMm',
      'OUT_OF_RANGE',
    );
    expectRefused(
      'RECEIPT',
      pre({ total: { xMm: -1, yMm: 1 } }),
      'layout.positions.total.xMm',
      'OUT_OF_RANGE',
    );
    expectRefused(
      'RECEIPT',
      pre({ total: { xMm: 1 } }),
      'layout.positions.total.yMm',
      'NOT_A_NUMBER',
    );
    expectRefused('RECEIPT', pre({ total: 'here' }), 'layout.positions.total', 'NOT_AN_OBJECT');
    expectRefused(
      'RECEIPT',
      pre({ total: { xMm: 1, yMm: 1, zMm: 1 } }),
      'layout.positions.total.zMm',
      'UNKNOWN_FIELD',
    );
    expectRefused('RECEIPT', pre([]), 'layout.positions', 'NOT_AN_OBJECT');
    expect(() => validateTemplate('RECEIPT', pre({ total: { xMm: 240, yMm: 140 } }))).not.toThrow();
  });

  it('a prototype-pollution style key is just an unknown field', () => {
    const raw = JSON.parse(
      JSON.stringify(valid()).replace('"fields":{', '"fields":{"__proto__":true,'),
    ) as unknown;
    expect(refusal(() => validateTemplate('RECEIPT', raw))).toMatchObject({
      code: 'PRINT_TEMPLATE_INVALID',
      reason: 'UNKNOWN_FIELD',
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
