import type { RichElement, RichParagraph, RichRun, RichStyle } from './print-layout';
import {
  PRINT_DOC_TYPES,
  validateTemplate,
  type PrintDocType,
  type PrintTemplateInput,
} from './print-template.rules';

/**
 * Step 2.1f: designed sample templates, two to three for every document, owned by Indigo (the template
 * library). The arrangement follows the pattern of a typical Indian hospital bill and prescription:
 * a hospital header (logo, name, address, phone, e-mail, web), a title, who the patient is, the items
 * or medicines, the total, the signature and a footer line. Nothing is typed in here that belongs to
 * one hospital: the header lines are the extra print values `value.address`, `value.phone`,
 * `value.email`, `value.web` and `value.footer` of each hospital, the rest are document fields.
 * The branding of the sample hospitals is fictional.
 */

export type SampleTemplate = {
  /** Stable key (used to add a sample once only). */
  key: string;
  docType: PrintDocType;
  name: string;
  description: string;
  input: PrintTemplateInput;
};

/** The extra print values the samples read. A hospital sets them once (Settings, Print values). */
export const SAMPLE_VALUE_KEYS = {
  address: 'address',
  phone: 'phone',
  email: 'email',
  web: 'web',
  footer: 'footer',
} as const;
export const SAMPLE_VALUE_LABELS: Record<string, string> = {
  address: 'Address',
  phone: 'Phone',
  email: 'E-mail',
  web: 'Web',
  footer: 'Footer line',
};
const V = (key: string) => `value.${key}`;

const r1 = (n: number): number => Math.round(n * 10) / 10;

const t = (text: string, style?: RichStyle): RichRun =>
  style ? { t: 'text', text, style } : { t: 'text', text };
const f = (field: string, style?: RichStyle): RichRun =>
  style ? { t: 'field', field, style } : { t: 'field', field };
const para = (runs: RichRun[], align?: 'LEFT' | 'CENTER' | 'RIGHT'): RichParagraph =>
  align ? { align, runs } : { runs };
const box = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  paragraphs: RichParagraph[],
): RichElement => ({
  id,
  type: 'RICH',
  xMm: r1(x),
  yMm: r1(y),
  widthMm: r1(w),
  heightMm: r1(h),
  content: { paragraphs },
});
const rule = (id: string, x: number, y: number, w: number): RichElement => ({
  id,
  type: 'LINE',
  xMm: r1(x),
  yMm: r1(y),
  widthMm: r1(w),
  heightMm: 0.3,
  tone: 'GREY',
});
const logo = (x: number, y: number, size: number): RichElement => ({
  id: 'logo',
  type: 'IMAGE',
  xMm: r1(x),
  yMm: r1(y),
  widthMm: r1(size),
  heightMm: r1(size),
  slot: 'LOGO',
});

type Page = { w: number; h: number; m: number; paper: 'A4' | 'A5' };
const A5: Page = { w: 148, h: 210, m: 10, paper: 'A5' };
const A4: Page = { w: 210, h: 297, m: 15, paper: 'A4' };

const GREY: RichStyle = { tone: 'GREY', size: 8 };

type HeaderKind = 'CENTRE' | 'LEFT' | 'BAND';

/** The hospital header. Returns the boxes and the y (mm) where the page content can start. */
function header(page: Page, kind: HeaderKind, serif: boolean): { els: RichElement[]; y: number } {
  const { w, m } = page;
  const inner = w - 2 * m;
  const font = serif ? ('SERIF' as const) : ('SANS' as const);
  const name: RichStyle = { size: page.paper === 'A4' ? 17 : 14, bold: true, font };
  const contact = (align: 'LEFT' | 'CENTER'): RichParagraph[] => [
    para([f(V(SAMPLE_VALUE_KEYS.address), { ...GREY, font })], align),
    para(
      [
        t('Phone: ', { ...GREY, font }),
        f(V(SAMPLE_VALUE_KEYS.phone), { ...GREY, font }),
        t('   E-mail: ', { ...GREY, font }),
        f(V(SAMPLE_VALUE_KEYS.email), { ...GREY, font }),
      ],
      align,
    ),
    para([f(V(SAMPLE_VALUE_KEYS.web), { ...GREY, font })], align),
  ];
  if (kind === 'LEFT') {
    const size = page.paper === 'A4' ? 23 : 22;
    return {
      els: [
        logo(m, m, size),
        box('hname', m + size + 3, m, inner - size - 3, 8, [para([f('hospitalName', name)])]),
        box('hcontact', m + size + 3, m + 8, inner - size - 3, size - 8, contact('LEFT')),
        rule('hrule', m, m + size + 2, inner),
      ],
      y: m + size + 5,
    };
  }
  if (kind === 'BAND') {
    return {
      els: [
        logo(m, m, 14),
        box('hname', m + 17, m, inner - 17, 7, [
          para([f('hospitalName', { ...name, size: name.size! - 1 })]),
        ]),
        box('hcontact', m + 17, m + 7, inner - 17, 13, contact('LEFT')),
        rule('hrule', m, m + 21, inner),
        rule('hrule2', m, m + 21.8, inner),
      ],
      y: m + 25,
    };
  }
  return {
    els: [
      logo(m, m, 14),
      box('hname', m + 17, m, inner - 34, 8, [para([f('hospitalName', name)], 'CENTER')]),
      box('hcontact', m + 17, m + 8, inner - 34, 13, contact('CENTER')),
      rule('hrule', m, m + 22, inner),
    ],
    y: m + 25,
  };
}

const base = (page: Page, els: RichElement[], fontSizePt: number): PrintTemplateInput => ({
  enabled: true,
  preset: null,
  paper: page.paper,
  widthMm: null,
  heightMm: null,
  orientation: 'PORTRAIT',
  margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
  mode: 'FULL',
  layout: { version: 3, fontSizePt, offset: { xMm: 0, yMm: 0 }, elements: els },
});

const footerBox = (page: Page, font: 'SANS' | 'SERIF'): RichElement[] => [
  rule('frule', page.m, page.h - page.m - 9, page.w - 2 * page.m),
  box('footer', page.m, page.h - page.m - 7, page.w - 2 * page.m, 7, [
    para([f(V(SAMPLE_VALUE_KEYS.footer), { ...GREY, font })], 'CENTER'),
  ]),
];

const signatory = (page: Page, y: number, label: string): RichElement[] => [
  rule('sigrule', page.w - page.m - 55, y, 55),
  box('sig', page.w - page.m - 55, y + 1, 55, 6, [
    para([t(label, { size: 8, bold: true })], 'CENTER'),
  ]),
];

// ----------------------------------------------------------------------------- registration slip

function slip(page: Page, kind: HeaderKind, serif: boolean, title: string): PrintTemplateInput {
  const h = header(page, kind, serif);
  const { w, m } = page;
  const inner = w - 2 * m;
  const half = inner / 2 - 2;
  let y = h.y;
  const els: RichElement[] = [...h.els];
  els.push(
    box('title', m, y, inner, 7, [
      para([t(title, { size: 12, bold: true, underline: true })], 'CENTER'),
    ]),
  );
  y += 10;
  els.push(
    box('l1', m, y, half, 14, [
      para([t('UHID: ', { bold: true }), f('uhid', { bold: true })]),
      para([t('Registered on: ', { bold: true }), f('registeredOn')]),
    ]),
    box('r1', m + half + 4, y, half, 14, [
      para([t('Age: ', { bold: true }), f('age'), t('   Gender: ', { bold: true }), f('gender')]),
      para([t('Branch: ', { bold: true }), f('branchName')]),
    ]),
  );
  y += 16;
  els.push(
    box('pn', m, y, inner, 8, [
      para([t('Patient: ', { bold: true }), f('patientName', { size: 12, bold: true })]),
    ]),
    box('rel', m, y + 8, inner, 6, [para([t('Relative: ', { bold: true }), f('relative')])]),
    box('ph', m, y + 14, inner, 6, [para([t('Phone: ', { bold: true }), f('phone')])]),
    box('ad', m, y + 20, inner, 12, [para([t('Address: ', { bold: true }), f('address')])]),
  );
  y += 36;
  els.push(...signatory(page, y + 14, `Receptionist: `));
  els.push(
    box('who', m, y + 15, 70, 6, [para([t('Registered by: ', GREY), f('receptionistName', GREY)])]),
  );
  els.push(...footerBox(page, serif ? 'SERIF' : 'SANS'));
  return base(page, els, 10);
}

// ------------------------------------------------------------------------------------- receipt

function bill(page: Page, kind: HeaderKind, serif: boolean, title: string): PrintTemplateInput {
  const h = header(page, kind, serif);
  const { w, m } = page;
  const inner = w - 2 * m;
  const half = inner / 2 - 2;
  const els: RichElement[] = [...h.els];
  let y = h.y;
  els.push(
    box('title', m, y, inner, 7, [
      para([t(title, { size: 12, bold: true, underline: true })], 'CENTER'),
    ]),
  );
  y += 10;
  els.push(
    box('m1', m, y, half, 20, [
      para([t('Bill No: ', { bold: true }), f('billNumber', { bold: true })]),
      para([t('Reg No: ', { bold: true }), f('uhid')]),
      para([t('Token: ', { bold: true }), f('token')]),
    ]),
    box('m2', m + half + 4, y, half, 20, [
      para([t('Date: ', { bold: true }), f('visitDate')]),
      para([t('Age: ', { bold: true }), f('age'), t('   Gender: ', { bold: true }), f('gender')]),
      para([t('Doctor: ', { bold: true }), f('doctorName')]),
    ]),
  );
  y += 21;
  els.push(
    box('pn', m, y, inner, 7, [
      para([t('Patient: ', { bold: true }), f('patientName', { size: 11, bold: true })]),
    ]),
  );
  y += 9;
  els.push(
    rule('t1', m, y, inner),
    box('thead', m, y + 0.8, inner - 40, 6, [para([t('Particulars', { bold: true })])]),
    box('theadamt', m + inner - 40, y + 0.8, 40, 6, [para([t('Amount', { bold: true })], 'RIGHT')]),
    rule('t2', m, y + 7, inner),
  );
  y += 8;
  const room = page.h - page.m - 9 - y - 46;
  els.push(box('lines', m, y, inner, Math.max(room, 30), [para([f('lines')])]));
  y += Math.max(room, 30) + 1;
  els.push(
    rule('t3', m, y, inner),
    box('total', m, y + 1, inner, 7, [
      para([t('Total: ', { bold: true, size: 11 }), f('total', { bold: true, size: 11 })], 'RIGHT'),
    ]),
    box('pay', m, y + 9, inner - 58, 14, [
      para([t('Paid: ', { bold: true }), f('paid')]),
      para([t('Payment: ', { bold: true }), f('paymentModes')]),
      para([f('referenceNo', GREY)]),
    ]),
    ...signatory(page, y + 22, 'Authorised signatory'),
  );
  els.push(...footerBox(page, serif ? 'SERIF' : 'SANS'));
  return base(page, els, 10);
}

// ------------------------------------------------------------------------------- prescription

function doctorBlock(page: Page, y: number): { els: RichElement[]; y: number } {
  const { w, m } = page;
  const inner = w - 2 * m;
  const half = inner / 2 - 2;
  return {
    els: [
      box('doc', m, y, half, 14, [
        para([f('doctorName', { bold: true, size: 11 })]),
        para([f('doctorQualifications', GREY)]),
        para([f('doctorSpeciality', GREY)]),
      ]),
      box('docreg', m + half + 4, y, half, 14, [
        para([t('Reg. no: ', GREY), f('doctorRegistrationNo', GREY)], 'RIGHT'),
        para([f('doctorDepartment', GREY)], 'RIGHT'),
      ]),
    ],
    y: y + 15,
  };
}

function patientStrip(page: Page, y: number): { els: RichElement[]; y: number } {
  const { w, m } = page;
  const inner = w - 2 * m;
  return {
    els: [
      rule('p1', m, y, inner),
      box('pstrip', m, y + 1, inner, 6, [
        para([
          t('Patient: ', { bold: true }),
          f('patientName', { bold: true }),
          t('   Age: ', { bold: true }),
          f('age'),
          t('   Gender: ', { bold: true }),
          f('gender'),
          t('   UHID: ', { bold: true }),
          f('uhid'),
        ]),
      ]),
      box('pdate', m, y + 7, inner, 6, [
        para([
          t('Date: ', { bold: true }),
          f('visitDate'),
          t('   Token: ', { bold: true }),
          f('token'),
        ]),
      ]),
      rule('p2', m, y + 13.5, inner),
    ],
    y: y + 16,
  };
}

function prescription(page: Page, kind: HeaderKind, serif: boolean): PrintTemplateInput {
  const h = header(page, kind, serif);
  const d = doctorBlock(page, h.y);
  const p = patientStrip(page, d.y);
  const { w, m } = page;
  const inner = w - 2 * m;
  const els = [...h.els, ...d.els, ...p.els];
  const room = page.h - page.m - 9 - p.y - 28;
  els.push(
    box('rx', m, p.y, 12, 12, [
      para([t('Rx', { size: 20, bold: true, font: 'SERIF', italic: true })]),
    ]),
    box('medicines', m + 12, p.y + 1, inner - 12, room, [para([f('medicines')])]),
    box('mark', m, page.h - page.m - 36, inner, 6, [para([f('amendedMark', GREY)])]),
    box('docsign', w - m - 55, page.h - page.m - 28, 55, 17, [
      para([f('doctorSignature')], 'CENTER'),
    ]),
    ...signatory(page, page.h - page.m - 10.5, 'Doctor signature').slice(0, 0),
  );
  els.push(...footerBox(page, serif ? 'SERIF' : 'SANS'));
  return base(page, els, 10);
}

// ---------------------------------------------------------------------------- patient report

function report(page: Page, kind: HeaderKind, serif: boolean): PrintTemplateInput {
  const h = header(page, kind, serif);
  const d = doctorBlock(page, h.y);
  const p = patientStrip(page, d.y);
  const { w, m } = page;
  const inner = w - 2 * m;
  const els = [...h.els, ...d.els, ...p.els];
  const small = page.paper === 'A5';
  const body = small ? 9 : 10;
  let y = p.y;
  const section = (id: string, label: string, field: string, rows: number): void => {
    const height = rows * (body * 0.53) + 1;
    els.push(
      box(id, m, y, inner, height + 5, [
        para([t(label, { bold: true, size: body })]),
        para([f(field, { size: body })]),
      ]),
    );
    y += height + 6;
  };
  els.push(
    box('vit', m, y, inner, 6, [
      para([t('Vitals: ', { bold: true, size: body }), f('vitals', { size: body })]),
    ]),
  );
  y += small ? 12 : 9;
  section('sym', 'Symptoms', 'receptionSymptoms', small ? 1 : 2);
  section('cmp', 'Complaints', 'complaints', small ? 2 : 3);
  section('dia', 'Diagnosis', 'diagnosis', small ? 1 : 2);
  section('tst', 'Lab tests', 'tests', small ? 2 : 3);
  const room = page.h - page.m - 9 - y - 40;
  els.push(
    box('medh', m, y, inner, 5, [para([t('Medicines', { bold: true, size: body })])]),
    rule('medr', m, y + 5, inner),
    box('medicines', m, y + 6, inner, Math.max(room, 20), [para([f('medicines', { size: body })])]),
  );
  y += 6 + Math.max(room, 20);
  els.push(
    box('adv', m, y, inner - 58, 14, [
      para([t('Advice: ', { bold: true, size: body }), f('advice', { size: body })]),
      para([t('Follow-up: ', { bold: true, size: body }), f('followUpDate', { size: body })]),
    ]),
    box('docsign', w - m - 55, y, 55, 17, [para([f('doctorSignature')], 'CENTER')]),
    box('mark', m, page.h - page.m - 12, inner, 5, [para([f('amendedMark', GREY)])]),
  );
  els.push(...footerBox(page, serif ? 'SERIF' : 'SANS'));
  return base(page, els, body);
}

// ------------------------------------------------------------------------------- patient card

function card(variant: 'CLASSIC' | 'BAND'): PrintTemplateInput {
  const W = 100;
  const H = 50;
  const els: RichElement[] =
    variant === 'CLASSIC'
      ? [
          logo(3, 3, 11),
          box('h', 16, 3, 81, 7, [para([f('hospitalName', { size: 10, bold: true })])]),
          box('hv', 16, 9, 81, 5, [para([f(V(SAMPLE_VALUE_KEYS.phone), GREY)])]),
          rule('r', 3, 16, 94),
          box('n', 3, 18, 94, 8, [para([f('patientName', { size: 12, bold: true })])]),
          box('u', 3, 27, 60, 6, [
            para([t('UHID: ', { bold: true }), f('uhid', { bold: true, size: 10 })]),
          ]),
          box('ag', 3, 33, 60, 6, [para([f('age'), t(' / '), f('gender')])]),
          box('ph', 3, 39, 94, 6, [para([t('Phone: ', GREY), f('phone', GREY)])]),
        ]
      : [
          box('h', 3, 3, 94, 6, [para([f('hospitalName', { size: 9, bold: true })], 'CENTER')]),
          rule('r', 3, 10, 94),
          box('n', 3, 12, 94, 9, [para([f('patientName', { size: 13, bold: true })], 'CENTER')]),
          box('u', 3, 23, 94, 8, [
            para([t('UHID ', { bold: true }), f('uhid', { bold: true, size: 12 })], 'CENTER'),
          ]),
          box('ag', 3, 33, 94, 6, [
            para([f('age'), t(' / '), f('gender'), t('   '), f('phone')], 'CENTER'),
          ]),
          box('rg', 3, 40, 94, 6, [para([t('Relative: ', GREY), f('relative', GREY)], 'CENTER')]),
        ];
  return {
    enabled: true,
    preset: 'CARD_LABEL',
    paper: 'LABEL',
    widthMm: W,
    heightMm: H,
    orientation: 'LANDSCAPE',
    margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
    mode: 'FULL',
    layout: { version: 3, fontSizePt: 8, offset: { xMm: 0, yMm: 0 }, elements: els },
  };
}

// -------------------------------------------------------------------------------------- the list

type Maker = {
  key: string;
  docType: PrintDocType;
  name: string;
  description: string;
  make: () => PrintTemplateInput;
};

const MAKERS: Maker[] = [
  {
    key: 'slip-classic',
    docType: 'REGISTRATION_SLIP',
    name: 'Classic slip (A5)',
    description: 'Centred header, simple lines.',
    make: () => slip(A5, 'CENTRE', false, 'PATIENT REGISTRATION'),
  },
  {
    key: 'slip-modern',
    docType: 'REGISTRATION_SLIP',
    name: 'Modern slip (A5)',
    description: 'Logo and name on the left.',
    make: () => slip(A5, 'LEFT', false, 'REGISTRATION SLIP'),
  },
  {
    key: 'slip-formal',
    docType: 'REGISTRATION_SLIP',
    name: 'Formal slip (A4, serif)',
    description: 'Serif type on A4.',
    make: () => slip(A4, 'BAND', true, 'PATIENT REGISTRATION SLIP'),
  },
  {
    key: 'bill-classic',
    docType: 'RECEIPT',
    name: 'Classic cash bill (A5)',
    description: 'OUT PATIENT CASH BILL with the item table.',
    make: () => bill(A5, 'CENTRE', false, 'OUT PATIENT CASH BILL'),
  },
  {
    key: 'bill-modern',
    docType: 'RECEIPT',
    name: 'Modern bill (A5)',
    description: 'Logo left, grey rules.',
    make: () => bill(A5, 'LEFT', false, 'OUT PATIENT CASH BILL'),
  },
  {
    key: 'bill-formal',
    docType: 'RECEIPT',
    name: 'Formal bill (A4, serif)',
    description: 'Serif type on A4.',
    make: () => bill(A4, 'BAND', true, 'OUT PATIENT CASH BILL'),
  },
  {
    key: 'rx-classic',
    docType: 'PRESCRIPTION',
    name: 'Classic prescription (A5)',
    description: 'Rx with the medicines and the signature.',
    make: () => prescription(A5, 'CENTRE', false),
  },
  {
    key: 'rx-modern',
    docType: 'PRESCRIPTION',
    name: 'Modern prescription (A5)',
    description: 'Logo left.',
    make: () => prescription(A5, 'LEFT', false),
  },
  {
    key: 'rx-formal',
    docType: 'PRESCRIPTION',
    name: 'Formal prescription (A4, serif)',
    description: 'Serif type on A4.',
    make: () => prescription(A4, 'BAND', true),
  },
  {
    key: 'report-classic',
    docType: 'PATIENT_REPORT',
    name: 'Classic patient report (A4)',
    description: 'Vitals, symptoms, diagnosis, tests, medicines.',
    make: () => report(A4, 'CENTRE', false),
  },
  {
    key: 'report-modern',
    docType: 'PATIENT_REPORT',
    name: 'Modern patient report (A4)',
    description: 'Logo left.',
    make: () => report(A4, 'LEFT', false),
  },
  {
    key: 'report-compact',
    docType: 'PATIENT_REPORT',
    name: 'Compact patient report (A5)',
    description: 'The same content on A5.',
    make: () => report(A5, 'LEFT', false),
  },
  {
    key: 'card-classic',
    docType: 'PATIENT_CARD',
    name: 'Classic card label',
    description: 'Logo, name, UHID, age, phone.',
    make: () => card('CLASSIC'),
  },
  {
    key: 'card-band',
    docType: 'PATIENT_CARD',
    name: 'Centred card label',
    description: 'Name and UHID large, centred.',
    make: () => card('BAND'),
  },
];

/** Every sample, each checked with the same rules that guard a saved template (so none can be invalid). */
export function sampleTemplates(): SampleTemplate[] {
  return MAKERS.map((m) => ({
    key: m.key,
    docType: m.docType,
    name: m.name,
    description: m.description,
    input: validateTemplate(m.docType, m.make()),
  }));
}

export const SAMPLE_DOC_TYPES = PRINT_DOC_TYPES;
