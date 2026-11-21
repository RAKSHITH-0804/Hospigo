import { render, screen } from '@testing-library/react';
import { PrintSheet, PrintStage } from '@/components/print/print-sheet';
import { fieldBox, makeTemplate, textBox, withBoxes } from '@/lib/print/print-test-fixtures';
import type { PrintContent, PrintElement, PrintItem } from '@/lib/print/types';

jest.mock('@/components/patients/print-button', () => ({
  PrintButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

const items: PrintItem[] = [
  { key: 'hospitalName', label: 'Hospital', text: 'Test Hospital' },
  { key: 'patientName', label: 'Patient', text: 'Asha Rao' },
  { key: 'uhid', label: 'UHID', text: 'HSP-0001' },
  { key: 'phone', label: 'Phone', text: '' },
  { key: 'medicines', label: 'Medicines', lines: ['Para 500 · 1 · twice', 'Cough syrup'] },
  {
    key: 'lines',
    label: 'Items',
    pairs: [
      ['Consultation', '₹600.00'],
      ['Registration', '₹100.00'],
    ],
  },
];

const boxOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-box="${id}"]`) as HTMLElement | null;

const rich = (
  id: string,
  content: PrintContent,
  over: Partial<PrintElement> = {},
): PrintElement => ({
  id,
  type: 'RICH',
  xMm: 10,
  yMm: 10,
  widthMm: 80,
  heightMm: 10,
  content,
  ...over,
});

describe('PrintSheet on plain paper', () => {
  const template = withBoxes(makeTemplate('RECEIPT'), [
    fieldBox('hospitalName', 'h', { caption: false, bold: true, align: 'CENTER', fontSizePt: 16 }),
    fieldBox('patientName', 'p', { yMm: 30 }),
    fieldBox('medicines', 'm', { yMm: 40, heightMm: 30, caption: false }),
    fieldBox('lines', 'l', { yMm: 80 }),
    textBox('t', 'Open 9 to 5\nSunday closed'),
    { id: 'rule', type: 'LINE', xMm: 10, yMm: 25, widthMm: 100, heightMm: 0.3 },
    fieldBox('phone', 'ph', { yMm: 100 }),
    fieldBox('uhid', 'u', { yMm: 110, caption: false }),
  ]);

  it('draws every box at its own place and size, in millimetres, on a page of the paper size', () => {
    const { container } = render(<PrintSheet template={template} items={items} />);
    const p = boxOf(container, 'p')!;
    expect(p.style.left).toBe('10mm');
    expect(p.style.top).toBe('30mm');
    expect(p.style.width).toBe('80mm');
    expect(p.style.height).toBe('6mm');
    const sheet = container.querySelector('.print-sheet') as HTMLElement;
    expect(sheet.style.width).toBe('148mm');
    expect(sheet.style.height).toBe('210mm');
    expect(sheet.style.fontSize).toBe('11pt');
    expect(sheet.getAttribute('data-mode')).toBe('FULL');
  });

  it('the caption is plain words in front of the value, in the same line', () => {
    const { container } = render(<PrintSheet template={template} items={items} />);
    expect(boxOf(container, 'p')!.textContent).toBe('Patient: Asha Rao');
    expect(boxOf(container, 'h')!.textContent).toBe('Test Hospital');
    expect(boxOf(container, 'u')!.textContent).toBe('HSP-0001');
    expect(container.querySelectorAll('[data-box="p"] .print-para')).toHaveLength(1);
  });

  it('writes a list one line each and a table of items as two columns', () => {
    const { container } = render(<PrintSheet template={template} items={items} />);
    expect(
      [...boxOf(container, 'm')!.querySelectorAll('.print-line')].map((n) => n.textContent),
    ).toEqual(['Para 500 · 1 · twice', 'Cough syrup']);
    const rows = [...boxOf(container, 'l')!.querySelectorAll('.print-pair')];
    expect(rows.map((r) => r.textContent)).toEqual(['Consultation₹600.00', 'Registration₹100.00']);
  });

  it('prints typed words a paragraph at a time and a rule, and leaves out a line whose value is empty', () => {
    const { container } = render(<PrintSheet template={template} items={items} />);
    expect(
      [...boxOf(container, 't')!.querySelectorAll('.print-para')].map((n) => n.textContent),
    ).toEqual(['Open 9 to 5', 'Sunday closed']);
    expect(boxOf(container, 'rule')!.querySelector('.print-rule')).toBeTruthy();
    // the phone is empty: "Phone:" alone is not printed, and the box is not there
    expect(boxOf(container, 'ph')).toBeNull();
  });

  it('applies the style of each stretch: size, bold, italic, underline, font and colour; and the paragraph alignment', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      rich('s', {
        paragraphs: [
          {
            align: 'RIGHT',
            runs: [
              {
                t: 'text',
                text: 'Big ',
                style: { size: 18, bold: true, italic: true, underline: true },
              },
              { t: 'field', field: 'patientName', style: { font: 'MONO', tone: 'GREY' } },
              { t: 'text', text: ' plain' },
            ],
          },
        ],
      }),
    ]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    const para = container.querySelector('[data-box="s"] .print-para') as HTMLElement;
    expect(para.style.textAlign).toBe('right');
    const [big, name, plain] = [...para.children].map((c) => c.firstElementChild as HTMLElement);
    expect(big!.style.fontSize).toBe('18pt');
    expect(big!.style.fontWeight).toBe('700');
    expect(big!.style.fontStyle).toBe('italic');
    expect(big!.style.textDecoration).toBe('underline');
    expect(name!.className).toContain('print-font-mono');
    expect(name!.className).toContain('print-tone-grey');
    expect(name!.textContent).toBe('Asha Rao');
    // words without a style of their own take the style of the page
    expect(plain!.style.fontSize).toBe('');
    expect(plain!.className).toBe('');
  });

  it('different styles in ONE sentence, with a value in the middle', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      rich('s', {
        paragraphs: [
          {
            runs: [
              { t: 'text', text: 'Dear ' },
              { t: 'field', field: 'patientName', style: { bold: true } },
              { t: 'text', text: ', your UHID is ' },
              { t: 'field', field: 'uhid', style: { underline: true } },
            ],
          },
        ],
      }),
    ]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    expect(boxOf(container, 's')!.textContent).toBe('Dear Asha Rao, your UHID is HSP-0001');
    expect(container.querySelector('[data-value="patientName"]')!.getAttribute('style')).toContain(
      'font-weight',
    );
    expect(container.querySelector('[data-value="uhid"]')!.getAttribute('style')).toContain(
      'underline',
    );
  });

  it('an empty paragraph keeps its line, so spaces between lines stay', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [textBox('s', 'one\n\nthree')]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    const paras = [...container.querySelectorAll('[data-box="s"] .print-para')];
    expect(paras).toHaveLength(3);
    expect(paras[1]!.querySelector('.print-empty-line')).toBeTruthy();
  });

  it('moves everything by the whole-page nudge', () => {
    const nudged = withBoxes(makeTemplate('RECEIPT'), [
      fieldBox('uhid', 'u', { xMm: 10, yMm: 10 }),
    ]);
    nudged.layout.offset = { xMm: 2.5, yMm: -1 };
    const { container } = render(<PrintSheet template={nudged} items={items} />);
    expect(boxOf(container, 'u')!.style.left).toBe('12.5mm');
    expect(boxOf(container, 'u')!.style.top).toBe('9mm');
  });

  it('prints no picture until there is one (a logo box is empty)', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
    ]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    expect(boxOf(container, 'logo')!.textContent).toBe('');
  });

  it('prints the logo and the signature pictures in their own boxes, from the picture route, with no words', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
      {
        id: 'sig',
        type: 'IMAGE',
        slot: 'SIGNATURE',
        xMm: 100,
        yMm: 200,
        widthMm: 40,
        heightMm: 15,
      },
    ]);
    const { container } = render(
      <PrintSheet template={t} items={items} images={{ LOGO: 'logo-1', SIGNATURE: 'sig-1' }} />,
    );
    const logo = boxOf(container, 'logo')!.querySelector('img')!;
    const sig = boxOf(container, 'sig')!.querySelector('img')!;
    expect(logo.getAttribute('src')).toBe('/api/staff/images/logo-1');
    expect(sig.getAttribute('src')).toBe('/api/staff/images/sig-1');
    expect(logo.className).toBe('print-image');
    expect(logo.getAttribute('alt')).toBe('');
    expect(boxOf(container, 'logo')!.textContent).toBe('');
  });

  it('a box with no picture for its slot stays empty; one slot never shows the other picture', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
      {
        id: 'sig',
        type: 'IMAGE',
        slot: 'SIGNATURE',
        xMm: 100,
        yMm: 200,
        widthMm: 40,
        heightMm: 15,
      },
    ]);
    const onlySig = render(
      <PrintSheet template={t} items={items} images={{ SIGNATURE: 'sig-1' }} />,
    );
    expect(boxOf(onlySig.container, 'logo')!.querySelector('img')).toBeNull();
    expect(boxOf(onlySig.container, 'sig')!.querySelector('img')!.getAttribute('src')).toBe(
      '/api/staff/images/sig-1',
    );
    const none = render(
      <PrintSheet template={t} items={items} images={{ LOGO: null, SIGNATURE: null }} />,
    );
    expect(none.container.querySelector('img')).toBeNull();
  });

  it('the settings preview marks a picture box that has no picture; a printout leaves it empty', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
      {
        id: 'sig',
        type: 'IMAGE',
        slot: 'SIGNATURE',
        xMm: 100,
        yMm: 200,
        widthMm: 40,
        heightMm: 15,
      },
    ]);
    const marks = { LOGO: 'Logo mark', SIGNATURE: 'Signature mark' };
    const preview = render(
      <PrintSheet
        template={t}
        items={items}
        images={{ LOGO: 'logo-1' }}
        markEmptyPictures={marks}
      />,
    );
    // the logo has a picture: no marker; the signature has none: marked
    expect(boxOf(preview.container, 'logo')!.querySelector('img')).toBeTruthy();
    expect(boxOf(preview.container, 'logo')!.textContent).toBe('');
    expect(boxOf(preview.container, 'sig')!.textContent).toBe('Signature mark');
    const printed = render(<PrintSheet template={t} items={items} images={{ LOGO: 'logo-1' }} />);
    expect(boxOf(printed.container, 'sig')!.textContent).toBe('');
  });

  it('a picture id cannot break out of its address', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
    ]);
    const { container } = render(
      <PrintSheet template={t} items={items} images={{ LOGO: '"><script>' }} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')!.getAttribute('src')).toBe(
      '/api/staff/images/%22%3E%3Cscript%3E',
    );
  });

  it('text that only looks like markup stays text', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [textBox('x', '<img src=x onerror=alert(1)>')]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    expect(container.querySelector('img')).toBeNull();
    expect(boxOf(container, 'x')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('a value the page does not know prints nothing and does not break the page', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [
      fieldBox('neverHeardOf', 'z'),
      textBox('t', 'ok'),
    ]);
    const { container } = render(<PrintSheet template={t} items={items} />);
    expect(boxOf(container, 'z')).toBeNull();
    expect(boxOf(container, 't')!.textContent).toBe('ok');
  });
});

describe('PrintSheet on pre-printed stationery', () => {
  const template = withBoxes(
    makeTemplate('RECEIPT', { mode: 'PREPRINTED', pageWidthMm: 240, pageHeightMm: 140 }),
    [
      fieldBox('patientName', 'p', { xMm: 30, yMm: 40 }),
      fieldBox('medicines', 'm', { xMm: 10, yMm: 60.5, heightMm: 30 }),
      textBox('t', 'Letterhead words'),
      { id: 'rule', type: 'LINE', xMm: 10, yMm: 25, widthMm: 100, heightMm: 0.3 },
      { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
    ],
  );

  it('prints only the values, with no words in front, and no letterhead text, rule or logo', () => {
    const { container } = render(<PrintSheet template={template} items={items} />);
    expect(boxOf(container, 'p')!.textContent).toBe('Asha Rao');
    expect(boxOf(container, 'm')!.textContent).toContain('Cough syrup');
    expect(boxOf(container, 't')).toBeNull();
    expect(boxOf(container, 'rule')).toBeNull();
    expect(boxOf(container, 'logo')).toBeNull();
  });

  it('still prints the doctor signature or stamp picture (it is not on the stationery), but never the logo', () => {
    const t = withBoxes(
      makeTemplate('RECEIPT', { mode: 'PREPRINTED', pageWidthMm: 240, pageHeightMm: 140 }),
      [
        { id: 'logo', type: 'IMAGE', slot: 'LOGO', xMm: 5, yMm: 5, widthMm: 30, heightMm: 20 },
        {
          id: 'sig',
          type: 'IMAGE',
          slot: 'SIGNATURE',
          xMm: 100,
          yMm: 100,
          widthMm: 40,
          heightMm: 15,
        },
      ],
    );
    const { container } = render(
      <PrintSheet template={t} items={items} images={{ LOGO: 'logo-1', SIGNATURE: 'sig-1' }} />,
    );
    expect(boxOf(container, 'logo')).toBeNull();
    expect(boxOf(container, 'sig')!.querySelector('img')!.getAttribute('src')).toBe(
      '/api/staff/images/sig-1',
    );
  });

  it('puts each value at its position plus the nudge, on a page of exactly the stationery size', () => {
    template.layout.offset = { xMm: 1, yMm: 2 };
    const { container } = render(<PrintSheet template={template} items={items} />);
    expect(boxOf(container, 'p')!.style.left).toBe('31mm');
    expect(boxOf(container, 'p')!.style.top).toBe('42mm');
    expect(boxOf(container, 'm')!.style.top).toBe('62.5mm');
    const sheet = container.querySelector('.print-sheet') as HTMLElement;
    expect(sheet.style.width).toBe('240mm');
    expect(sheet.style.height).toBe('140mm');
    expect(sheet.getAttribute('data-mode')).toBe('PREPRINTED');
  });

  it('a sentence with values prints only its values, a space apart, in their own style', () => {
    const t = withBoxes(
      makeTemplate('RECEIPT', { mode: 'PREPRINTED', pageWidthMm: 240, pageHeightMm: 140 }),
      [
        rich('s', {
          paragraphs: [
            {
              runs: [
                { t: 'text', text: 'Patient ' },
                { t: 'field', field: 'patientName', style: { bold: true } },
                { t: 'text', text: ' UHID ' },
                { t: 'field', field: 'uhid' },
                { t: 'field', field: 'phone' },
              ],
            },
          ],
        }),
      ],
    );
    const { container } = render(<PrintSheet template={t} items={items} />);
    expect(boxOf(container, 's')!.textContent).toBe('Asha Rao HSP-0001');
    expect(container.querySelector('[data-value="patientName"]')!.getAttribute('style')).toContain(
      'font-weight',
    );
  });
});

describe('PrintStage', () => {
  it('has the page rule of the template and a Print button', () => {
    const t = withBoxes(makeTemplate('RECEIPT'), [fieldBox('uhid', 'u', { caption: false })]);
    const { container } = render(
      <PrintStage template={t} items={items} title="Receipt" printLabel="Print now" />,
    );
    expect(container.querySelector('style')?.textContent).toBe(
      '@page { size: 148mm 210mm; margin: 0; }',
    );
    expect(screen.getByRole('button', { name: 'Print now' })).toBeTruthy();
    expect(screen.getByText('HSP-0001')).toBeTruthy();
  });
});
