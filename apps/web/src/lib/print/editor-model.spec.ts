import { contentToTip, RUN_TEXT_MAX, tipToContent, type TipNode } from './editor-model';
import type { PrintContent } from './types';

const sample: PrintContent = {
  paragraphs: [
    {
      align: 'CENTER',
      runs: [
        { t: 'text', text: 'Dear ', style: { italic: true } },
        {
          t: 'field',
          field: 'patientName',
          style: { size: 14, bold: true, underline: true, font: 'SERIF', tone: 'GREY' },
        },
        { t: 'text', text: ', welcome' },
      ],
    },
    { runs: [] },
    { align: 'RIGHT', runs: [{ t: 'text', text: 'Right side' }] },
  ],
};

const paragraph = (...children: TipNode[]): TipNode => ({ type: 'paragraph', content: children });
const doc = (...paragraphs: TipNode[]): TipNode => ({ type: 'doc', content: paragraphs });

describe('the editor document of a box', () => {
  it('turns words, values, styles and alignment into editor nodes', () => {
    const tip = contentToTip(sample);
    expect(tip.type).toBe('doc');
    const [first, empty, third] = tip.content!;
    expect(first!.attrs).toEqual({ textAlign: 'center' });
    expect(first!.content![0]).toEqual({
      type: 'text',
      text: 'Dear ',
      marks: [{ type: 'italic' }],
    });
    expect(first!.content![1]).toEqual({
      type: 'fieldToken',
      attrs: { field: 'patientName' },
      marks: [
        { type: 'bold' },
        { type: 'underline' },
        { type: 'textStyle', attrs: { printSize: 14, printFont: 'SERIF', printTone: 'GREY' } },
      ],
    });
    expect(first!.content![2]).toEqual({ type: 'text', text: ', welcome' });
    // an empty paragraph has no content, and no alignment attribute when left
    expect(empty).toEqual({ type: 'paragraph' });
    expect(third!.attrs).toEqual({ textAlign: 'right' });
  });

  it('coming back gives exactly what went in', () => {
    expect(tipToContent(contentToTip(sample))).toEqual(sample);
    const plain: PrintContent = { paragraphs: [{ runs: [{ t: 'text', text: 'x' }] }] };
    expect(tipToContent(contentToTip(plain))).toEqual(plain);
    expect(tipToContent(contentToTip({ paragraphs: [{ runs: [] }] }))).toEqual({
      paragraphs: [{ runs: [] }],
    });
  });
});

describe('what comes back from the editor is a whitelist', () => {
  it('keeps paragraphs, words with the known styles and value tokens, and nothing else', () => {
    const out = tipToContent(
      doc(
        paragraph(
          { type: 'text', text: 'Hello', marks: [{ type: 'bold' }, { type: 'strike' }] },
          { type: 'image', attrs: { src: 'http://evil/x.png' } } as TipNode,
          {
            type: 'text',
            text: ' world',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ),
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'ignored' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'ignored' }] },
        { type: 'bulletList', content: [] },
      ),
    );
    expect(out).toEqual({
      paragraphs: [
        {
          runs: [
            { t: 'text', text: 'Hello', style: { bold: true } },
            { t: 'text', text: ' world' },
          ],
        },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/evil|javascript|strike|link/);
  });

  it('ignores unknown or unsafe style values', () => {
    const out = tipToContent(
      doc(
        paragraph({
          type: 'text',
          text: 'x',
          marks: [
            {
              type: 'textStyle',
              attrs: {
                printSize: 'huge',
                printFont: 'COMIC',
                printTone: 'RED',
                color: 'red',
                fontFamily: 'x',
              },
            },
          ],
        }),
      ),
    );
    expect(out.paragraphs[0]!.runs).toEqual([{ t: 'text', text: 'x' }]);
    const sized = tipToContent(
      doc(
        paragraph({
          type: 'text',
          text: 'x',
          marks: [
            {
              type: 'textStyle',
              attrs: { printSize: 12.26, printFont: 'MONO', printTone: 'GREY' },
            },
          ],
        }),
      ),
    );
    expect(sized.paragraphs[0]!.runs[0]).toEqual({
      t: 'text',
      text: 'x',
      style: { size: 12.3, font: 'MONO', tone: 'GREY' },
    });
  });

  it('a value token needs a field name; a token without one is dropped', () => {
    const out = tipToContent(
      doc(
        paragraph(
          { type: 'fieldToken', attrs: { field: '' } },
          { type: 'fieldToken', attrs: {} },
          { type: 'fieldToken', attrs: { field: 'uhid' } },
        ),
      ),
    );
    expect(out.paragraphs[0]!.runs).toEqual([{ t: 'field', field: 'uhid' }]);
  });

  it('line breaks inside words become spaces; neighbouring words of one style join', () => {
    const out = tipToContent(
      doc(
        paragraph(
          { type: 'text', text: 'one\ntwo' },
          { type: 'text', text: ' three\r\nfour' },
          { type: 'text', text: ' five', marks: [{ type: 'bold' }] },
        ),
      ),
    );
    expect(out.paragraphs[0]!.runs).toEqual([
      { t: 'text', text: 'one two three four' },
      { t: 'text', text: ' five', style: { bold: true } },
    ]);
  });

  it('very long words are cut into stretches the API accepts', () => {
    const out = tipToContent(
      doc(paragraph({ type: 'text', text: 'x'.repeat(RUN_TEXT_MAX * 2 + 5) })),
    );
    const lengths = out.paragraphs[0]!.runs.map((r) => (r.t === 'text' ? r.text.length : 0));
    expect(lengths).toEqual([RUN_TEXT_MAX, RUN_TEXT_MAX, 5]);
  });

  it('alignment: only center and right are kept (left is the absence of one)', () => {
    const at = (textAlign: unknown): TipNode => ({
      type: 'paragraph',
      attrs: { textAlign },
      content: [{ type: 'text', text: 'x' }],
    });
    const out = tipToContent(doc(at('center'), at('right'), at('left'), at('justify'), at(null)));
    expect(out.paragraphs.map((p) => p.align)).toEqual([
      'CENTER',
      'RIGHT',
      undefined,
      undefined,
      undefined,
    ]);
    expect(out.paragraphs.every((p) => !('align' in p) || p.align)).toBe(true);
  });

  it('junk in gives one empty paragraph out, never a crash', () => {
    for (const junk of [
      null,
      undefined,
      5,
      'x',
      [],
      {},
      { type: 'doc' },
      { type: 'doc', content: [] },
    ]) {
      expect({ junk, got: tipToContent(junk) }).toEqual({
        junk,
        got: { paragraphs: [{ runs: [] }] },
      });
    }
  });

  it('an empty document is one empty paragraph', () => {
    expect(tipToContent(doc(paragraph()))).toEqual({ paragraphs: [{ runs: [] }] });
  });
});
