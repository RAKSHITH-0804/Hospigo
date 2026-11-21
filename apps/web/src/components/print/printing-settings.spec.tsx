import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PrintingSettings } from '@/components/print/printing-settings';
import { printDesignerConfig as C } from '@/config/print';
import { staffCopy } from '@/config/staff-copy';
import { fieldBox, makeTemplate, textBox, withBoxes } from '@/lib/print/print-test-fixtures';
import type { PrintElement, PrintPreset, PrintTemplate } from '@/lib/print/types';

// jsdom has no PointerEvent: this one carries the mouse position like the real one.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
(window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;

const saveMock = jest.fn();
const resetMock = jest.fn();
jest.mock('@/lib/print/client', () => ({
  savePrintTemplate: (...args: unknown[]) => saveMock(...args),
  resetPrintTemplate: (...args: unknown[]) => resetMock(...args),
}));
jest.mock('@/components/patients/print-button', () => ({
  PrintButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

// The real editor (TipTap) needs a browser; here it is a stand-in with the same doors: it is given
// the text of the box, tells the page every change, and can be asked to stop. The ribbon commands
// that would drive the real editor are recorded, so what the ribbon ASKS for can be checked.
const mockCommands = {
  styleAtCursor: jest.fn(),
  setRunStyle: jest.fn(),
  toggleRunMark: jest.fn(),
  setParagraphAlign: jest.fn(),
  insertValue: jest.fn(),
};
const mockFakeEditor = { on: jest.fn(), off: jest.fn() };
jest.mock('@/components/print/rich-editor', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    RichEditor: ({
      content,
      onReady,
      onChange,
      onExit,
    }: {
      content: { paragraphs: Array<{ runs: Array<{ t: string; text?: string; field?: string }> }> };
      onReady: (e: unknown) => void;
      onChange: (c: unknown) => void;
      onExit: () => void;
    }) => {
      React.useEffect(() => {
        onReady(mockFakeEditor);
        return () => onReady(null);
      }, []);
      const words = content.paragraphs
        .map((p) => p.runs.map((r) => (r.t === 'text' ? r.text : `{${r.field}}`)).join(''))
        .join('\n');
      return (
        <div data-testid="stub-editor">
          <textarea
            aria-label="stub editor"
            defaultValue={words}
            onChange={(event) =>
              onChange({
                paragraphs: event.target.value
                  .split('\n')
                  .map((line) => ({ runs: line ? [{ t: 'text', text: line }] : [] })),
              })
            }
          />
          <button type="button" onClick={onExit}>
            stub exit
          </button>
        </div>
      );
    },
    styleAtCursor: (...a: unknown[]) => mockCommands.styleAtCursor(...a),
    setRunStyle: (...a: unknown[]) => mockCommands.setRunStyle(...a),
    toggleRunMark: (...a: unknown[]) => mockCommands.toggleRunMark(...a),
    setParagraphAlign: (...a: unknown[]) => mockCommands.setParagraphAlign(...a),
    insertValue: (...a: unknown[]) => mockCommands.insertValue(...a),
  };
});

const copy = staffCopy.settings.printing;
const fields = staffCopy.print.fields as Record<string, string>;
const MM = C.pxPerMm; // pixels in a millimetre at 100%

function receipt(overrides: Partial<PrintTemplate> = {}): PrintTemplate {
  return withBoxes(makeTemplate('RECEIPT', overrides), [
    fieldBox('hospitalName', 'b1', { caption: false, bold: true, align: 'CENTER', yMm: 10 }),
    fieldBox('patientName', 'b2', { xMm: 20, yMm: 40, widthMm: 60, heightMm: 8 }),
    fieldBox('total', 'b3', { xMm: 20, yMm: 60 }),
    textBox('b4', 'Open 9 to 5', { xMm: 10, yMm: 100, widthMm: 60, heightMm: 6 }),
  ]);
}

const templates = (): PrintTemplate[] => [
  withBoxes(makeTemplate('REGISTRATION_SLIP'), [fieldBox('uhid', 'b1', { yMm: 20 })]),
  receipt(),
  withBoxes(makeTemplate('PRESCRIPTION'), [fieldBox('medicines', 'b1')]),
];

const labelPreset: PrintPreset = {
  key: 'LABEL_SLIP',
  name: 'Small label',
  templates: {
    REGISTRATION_SLIP: makeTemplate('REGISTRATION_SLIP'),
    RECEIPT: withBoxes(
      makeTemplate('RECEIPT', {
        paper: 'LABEL',
        widthMm: 100,
        heightMm: 50,
        pageWidthMm: 100,
        pageHeightMm: 50,
      }),
      [fieldBox('billNumber', 'e1', { widthMm: 60 }), fieldBox('total', 'e2', { yMm: 20 })],
    ),
    PRESCRIPTION: makeTemplate('PRESCRIPTION'),
  },
};
const prePreset: PrintPreset = {
  key: 'PREPRINTED_BILL',
  name: 'Pre-printed',
  templates: {
    REGISTRATION_SLIP: makeTemplate('REGISTRATION_SLIP'),
    RECEIPT: withBoxes(
      makeTemplate('RECEIPT', {
        paper: 'CUSTOM',
        widthMm: 240,
        heightMm: 140,
        pageWidthMm: 240,
        pageHeightMm: 140,
        mode: 'PREPRINTED',
      }),
      [
        fieldBox('billNumber', 'e1', { caption: false }),
        fieldBox('patientName', 'e2', { yMm: 30, caption: false }),
      ],
    ),
    PRESCRIPTION: makeTemplate('PRESCRIPTION'),
  },
};

function renderScreen(canWrite = true, items = templates()) {
  return render(
    <PrintingSettings
      templates={items}
      presets={[labelPreset, prePreset]}
      canWrite={canWrite}
      hospitalName="Demo Hospital"
    />,
  );
}

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const box = (id: string) =>
  document.querySelector(`.print-canvas [data-box="${id}"]`) as HTMLElement;
const boxes = () => [...document.querySelectorAll('.print-canvas [data-box]')] as HTMLElement[];
const pick = (id: string) => fireEvent.pointerDown(box(id), { clientX: 0, clientY: 0, button: 0 });
const goReceipt = () => click(staffCopy.print.docs.RECEIPT!);
const valueOf = (id: string, field: string) =>
  box(id).querySelector(`[data-value="${field}"]`) as HTMLElement | null;
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.querySelector('.print-canvas') as HTMLElement, { key, ...init });
const edit = (id: string) => fireEvent.doubleClick(box(id));
const stub = () => screen.queryByTestId('stub-editor');
const isDisabled = (name: string) => screen.getByRole('button', { name }).matches(':disabled');

function drag(id: string, dxMm: number, dyMm: number, handle?: string) {
  const target = handle
    ? (box(id).querySelector(`[data-handle="${handle}"]`) as HTMLElement)
    : box(id);
  fireEvent.pointerDown(target, { clientX: 500, clientY: 500, button: 0, pointerId: 1 });
  fireEvent.pointerMove(target, {
    clientX: 500 + dxMm * MM,
    clientY: 500 + dyMm * MM,
    pointerId: 1,
  });
  return {
    up: () =>
      fireEvent.pointerUp(target, {
        clientX: 500 + dxMm * MM,
        clientY: 500 + dyMm * MM,
        pointerId: 1,
      }),
  };
}

beforeEach(() => {
  saveMock.mockReset();
  resetMock.mockReset();
  for (const fn of Object.values(mockCommands)) fn.mockReset();
  mockCommands.styleAtCursor.mockReturnValue({ align: 'LEFT' });
});

describe('the page', () => {
  it('shows one document at a time as a page with its boxes at real size', () => {
    renderScreen();
    expect(screen.getAllByRole('button', { pressed: true })[0]!.textContent).toBe(
      staffCopy.print.docs.REGISTRATION_SLIP,
    );
    expect(boxes()).toHaveLength(1);
    goReceipt();
    expect(boxes().map((b) => b.dataset.box)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(box('b2').style.left).toBe('20mm');
    expect(box('b2').style.top).toBe('40mm');
    expect(box('b2').style.width).toBe('60mm');
    const sheet = document.querySelector('.print-canvas-sheet') as HTMLElement;
    expect(sheet.style.width).toBe('148mm');
    expect(sheet.style.height).toBe('210mm');
  });

  it('draws sample values and the real hospital name, with the words in front', () => {
    renderScreen();
    goReceipt();
    expect(box('b1').textContent).toBe('Demo Hospital');
    expect(box('b2').textContent).toBe(`Patient: ${staffCopy.print.sample.patientName}`);
    expect(box('b4').textContent).toBe('Open 9 to 5');
  });

  it('tells whether the built-in default or a saved template is in use', () => {
    renderScreen();
    expect(screen.getByText(copy.sourceDefault)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.reset })).toBeNull();
  });

  it('has rulers and a margin guide on plain paper only', () => {
    const { container } = renderScreen();
    goReceipt();
    expect(container.querySelectorAll('.print-ruler')).toHaveLength(2);
    expect(container.querySelector('.print-margin-guide')).toBeTruthy();
    fireEvent.change(select(copy.presetLabel), { target: { value: 'PREPRINTED_BILL' } });
    expect(container.querySelector('.print-margin-guide')).toBeNull();
  });
});

describe('selecting a box', () => {
  it('a click selects a box; clicking the page empty selects nothing', () => {
    renderScreen();
    goReceipt();
    expect(screen.getByText(copy.noSelection)).toBeTruthy();
    pick('b2');
    expect(box('b2').getAttribute('aria-pressed')).toBe('true');
    pick('b4');
    expect(box('b4').getAttribute('aria-pressed')).toBe('true');
    expect(box('b2').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(copy.noSelection)).toBeNull();
    fireEvent.pointerDown(document.querySelector('.print-canvas') as HTMLElement);
    expect(screen.getByText(copy.noSelection)).toBeTruthy();
  });

  it('the ribbon follows the selection', () => {
    renderScreen();
    goReceipt();
    pick('b1');
    expect(screen.getByRole('button', { name: copy.bold }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      screen.getByRole('button', { name: copy.alignCenter }).getAttribute('aria-pressed'),
    ).toBe('true');
    pick('b3');
    expect(screen.getByRole('button', { name: copy.bold }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(input(copy.leftLabel).value).toBe('20');
  });
});

describe('the ribbon on a box that is not being typed in (it changes ALL its text)', () => {
  it('bold, italic and underline: on for all, and off again when all have it', () => {
    renderScreen();
    goReceipt();
    pick('b3');
    click(copy.italic);
    click(copy.underline);
    expect(valueOf('b3', 'total')!.style.fontStyle).toBe('italic');
    expect(valueOf('b3', 'total')!.style.textDecoration).toBe('underline');
    click(copy.bold);
    expect(valueOf('b3', 'total')!.style.fontWeight).toBe('700');
    click(copy.bold);
    expect(valueOf('b3', 'total')!.style.fontWeight).toBe('');
    click(copy.italic);
    expect(valueOf('b3', 'total')!.style.fontStyle).toBe('');
  });

  it('text size, font and colour apply to the whole selected box only', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    type(copy.sizeLabel, '18');
    expect(valueOf('b2', 'patientName')!.style.fontSize).toBe('18pt');
    expect(valueOf('b3', 'total')!.style.fontSize).toBe('');
    fireEvent.change(select(copy.fontFamilyLabel), { target: { value: 'MONO' } });
    fireEvent.change(select(copy.toneLabel), { target: { value: 'GREY' } });
    expect(valueOf('b2', 'patientName')!.className).toContain('print-font-mono');
    expect(valueOf('b2', 'patientName')!.className).toContain('print-tone-grey');
    fireEvent.change(select(copy.fontFamilyLabel), { target: { value: 'SANS' } });
    fireEvent.change(select(copy.toneLabel), { target: { value: 'BLACK' } });
    expect(valueOf('b2', 'patientName')!.className).toBe('');
  });

  it('keeps the text size between the smallest and the largest allowed', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    type(copy.sizeLabel, '200');
    expect(valueOf('b2', 'patientName')!.style.fontSize).toBe(`${C.fontMaxPt}pt`);
    type(copy.sizeLabel, '1');
    expect(valueOf('b2', 'patientName')!.style.fontSize).toBe(`${C.fontMinPt}pt`);
  });

  it('alignment applies to every paragraph of the box', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    click(copy.alignRight);
    expect((box('b2').querySelector('.print-para') as HTMLElement).style.textAlign).toBe('right');
    click(copy.alignCenter);
    expect((box('b2').querySelector('.print-para') as HTMLElement).style.textAlign).toBe('center');
    click(copy.alignLeft);
    expect((box('b2').querySelector('.print-para') as HTMLElement).style.textAlign).toBe('');
  });

  it('Insert value puts a value of the document at the end of the text', () => {
    renderScreen();
    goReceipt();
    pick('b4');
    fireEvent.change(select(copy.insertValue), { target: { value: 'uhid' } });
    expect(valueOf('b4', 'uhid')).toBeTruthy();
    expect(box('b4').textContent).toBe(`Open 9 to 5${staffCopy.print.sample.uhid}`);
    const options = [...select(copy.insertValue).options].map((o) => o.textContent);
    expect(options).toContain(fields.uhid);
    expect(options).toContain(fields.total);
    expect(options).not.toContain(fields.medicines);
  });

  it('exact place and size can be typed and stay on the page', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    type(copy.leftLabel, '30');
    type(copy.topLabel, '50.5');
    type(copy.boxWidthLabel, '70');
    expect(box('b2').style.left).toBe('30mm');
    expect(box('b2').style.top).toBe('50.5mm');
    expect(box('b2').style.width).toBe('70mm');
    type(copy.leftLabel, '500');
    expect(box('b2').style.left).toBe('78mm');
  });

  it('a line has no text tools', () => {
    renderScreen();
    goReceipt();
    click(copy.addLine);
    expect(screen.queryByRole('button', { name: copy.bold })).toBeNull();
    fireEvent.change(select(copy.toneLabel), { target: { value: 'GREY' } });
    expect(boxes().at(-1)!.className).toContain('print-tone-grey');
  });
});

describe('typing in a box (Word-style)', () => {
  it('a double click starts typing: the editor opens in the box and the handles go', () => {
    renderScreen();
    goReceipt();
    expect(stub()).toBeNull();
    edit('b4');
    expect(stub()).toBeTruthy();
    expect(within(box('b4')).getByLabelText('stub editor')).toBeTruthy();
    expect(box('b4').className).toContain('is-editing');
    expect(box('b4').querySelectorAll('[data-handle]')).toHaveLength(0);
    expect(screen.getByText(copy.editingHint)).toBeTruthy();
  });

  it('Enter, F2 and the Edit text button start typing, and a line cannot be typed in', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    press('Enter');
    expect(stub()).toBeTruthy();
    click('stub exit');
    expect(stub()).toBeNull();
    pick('b3');
    press('F2');
    expect(stub()).toBeTruthy();
    click('stub exit');
    pick('b1');
    click(copy.editText);
    expect(stub()).toBeTruthy();
    click('stub exit');
    click(copy.addLine);
    edit(boxes().at(-1)!.dataset.box!);
    expect(stub()).toBeNull();
  });

  it('what is typed is kept in ONE step for the whole typing', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    const area = screen.getByLabelText('stub editor') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Open 9 to 6' } });
    fireEvent.change(area, { target: { value: 'Open 9 to 6\nSundays closed' } });
    click('stub exit');
    expect(stub()).toBeNull();
    expect([...box('b4').querySelectorAll('.print-para')].map((p) => p.textContent)).toEqual([
      'Open 9 to 6',
      'Sundays closed',
    ]);
    click(copy.undo);
    expect(box('b4').textContent).toBe('Open 9 to 5');
    expect(isDisabled(copy.undo)).toBe(true);
    click(copy.redo);
    expect(box('b4').textContent).toContain('Sundays closed');
  });

  it('typing nothing new is not a step', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    click('stub exit');
    expect(isDisabled(copy.undo)).toBe(true);
  });

  it('while typing, the ribbon acts through the editor, not on the whole box', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    click(copy.bold);
    expect(mockCommands.toggleRunMark).toHaveBeenCalledWith(mockFakeEditor, 'bold');
    click(copy.italic);
    expect(mockCommands.toggleRunMark).toHaveBeenLastCalledWith(mockFakeEditor, 'italic');
    click(copy.underline);
    expect(mockCommands.toggleRunMark).toHaveBeenLastCalledWith(mockFakeEditor, 'underline');
    type(copy.sizeLabel, '20');
    expect(mockCommands.setRunStyle).toHaveBeenLastCalledWith(mockFakeEditor, { size: 20 });
    fireEvent.change(select(copy.fontFamilyLabel), { target: { value: 'MONO' } });
    expect(mockCommands.setRunStyle).toHaveBeenLastCalledWith(mockFakeEditor, { font: 'MONO' });
    fireEvent.change(select(copy.toneLabel), { target: { value: 'GREY' } });
    expect(mockCommands.setRunStyle).toHaveBeenLastCalledWith(mockFakeEditor, { tone: 'GREY' });
    click(copy.alignCenter);
    expect(mockCommands.setParagraphAlign).toHaveBeenCalledWith(mockFakeEditor, 'CENTER');
    fireEvent.change(select(copy.insertValue), { target: { value: 'uhid' } });
    expect(mockCommands.insertValue).toHaveBeenCalledWith(mockFakeEditor, 'uhid');
    click('stub exit');
    expect(box('b4').textContent).toBe('Open 9 to 5');
  });

  it('the ribbon shows the style at the cursor while typing', () => {
    mockCommands.styleAtCursor.mockReturnValue({
      bold: true,
      italic: true,
      size: 22,
      align: 'RIGHT',
    });
    renderScreen();
    goReceipt();
    edit('b4');
    expect(screen.getByRole('button', { name: copy.bold }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: copy.underline }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: copy.alignRight }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(input(copy.sizeLabel).value).toBe('22');
  });

  it('Undo, Redo, order, duplicate and delete wait until the typing is done', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    for (const name of [
      copy.undo,
      copy.redo,
      copy.forward,
      copy.backward,
      copy.duplicate,
      copy.remove,
    ]) {
      expect({ name, off: isDisabled(name) }).toEqual({ name, off: true });
    }
  });

  it('the keys of the page (Delete, arrows) are the editor own while typing', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    press('Delete');
    press('ArrowRight');
    expect(boxes()).toHaveLength(4);
    expect(box('b4').style.left).toBe('10mm');
  });

  it('clicking another box, the page, Add text, the preview or another document ends the typing', () => {
    renderScreen();
    goReceipt();
    edit('b4');
    pick('b2');
    expect(stub()).toBeNull();
    edit('b4');
    fireEvent.pointerDown(document.querySelector('.print-canvas') as HTMLElement);
    expect(stub()).toBeNull();
    edit('b4');
    click(copy.addText);
    expect(stub()).toBeNull();
    edit('b4');
    click(copy.modePreview);
    click(copy.modeEdit);
    expect(stub()).toBeNull();
    edit('b4');
    click(staffCopy.print.docs.REGISTRATION_SLIP!);
    expect(stub()).toBeNull();
  });

  it('what was typed is saved even if Save is pressed while typing', async () => {
    saveMock.mockResolvedValue({ ok: true, data: receipt({ source: 'CUSTOM' }) });
    renderScreen();
    goReceipt();
    edit('b4');
    fireEvent.change(screen.getByLabelText('stub editor'), {
      target: { value: 'Saved while typing' },
    });
    click(copy.save);
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const sent = saveMock.mock.calls[0]![1].layout.elements.find(
      (e: PrintElement) => e.id === 'b4',
    );
    expect(sent.content.paragraphs[0].runs[0].text).toBe('Saved while typing');
  });

  it('a read only page cannot be typed in', () => {
    renderScreen(false);
    goReceipt();
    edit('b4');
    expect(stub()).toBeNull();
    pick('b4');
    press('Enter');
    expect(stub()).toBeNull();
  });
});

describe('moving and resizing with the mouse', () => {
  it('a drag moves the box, snapped to the grid, and is one step on release', () => {
    renderScreen();
    goReceipt();
    const move = drag('b2', 10.2, 5.7);
    expect(box('b2').style.left).toBe('30mm');
    expect(box('b2').style.top).toBe('46mm');
    expect(isDisabled(copy.undo)).toBe(true);
    move.up();
    expect(isDisabled(copy.undo)).toBe(false);
    click(copy.undo);
    expect(box('b2').style.left).toBe('20mm');
    expect(box('b2').style.top).toBe('40mm');
  });

  it('a plain click that moves nothing is not a step', () => {
    renderScreen();
    goReceipt();
    drag('b3', 0, 0).up();
    expect(box('b3').getAttribute('aria-pressed')).toBe('true');
    expect(isDisabled(copy.undo)).toBe(true);
  });

  it('a box dragged off the page stops at the edge', () => {
    renderScreen();
    goReceipt();
    drag('b2', -500, -500).up();
    expect(box('b2').style.left).toBe('0mm');
    expect(box('b2').style.top).toBe('0mm');
    drag('b2', 900, 900).up();
    expect(box('b2').style.left).toBe('88mm');
    expect(box('b2').style.top).toBe('202mm');
  });

  it('the grid can be turned off for free placement, or made coarser', () => {
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.snapLabel), { target: { value: '0' } });
    drag('b2', 10.26, 0).up();
    expect(box('b2').style.left).toBe('30.3mm');
    click(copy.undo);
    fireEvent.change(select(copy.snapLabel), { target: { value: '5' } });
    drag('b2', 7, 0).up();
    expect(box('b2').style.left).toBe('25mm');
  });

  it('the handles resize the box', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    drag('b2', 10, 4, 'se').up();
    expect(box('b2').style.width).toBe('70mm');
    expect(box('b2').style.height).toBe('12mm');
    drag('b2', -10, -4, 'nw').up();
    expect(box('b2').style.left).toBe('10mm');
    expect(box('b2').style.top).toBe('36mm');
    expect(box('b2').style.width).toBe('80mm');
    expect(box('b2').style.height).toBe('16mm');
  });

  it('a box cannot be made smaller than the minimum', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    drag('b2', -500, -500, 'se').up();
    expect(box('b2').style.width).toBe(`${C.minBoxMm}mm`);
    expect(box('b2').style.height).toBe(`${C.minBoxMm}mm`);
  });

  it('the handles only show on the selected box, and not when read only', () => {
    const { unmount } = renderScreen();
    goReceipt();
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(0);
    pick('b2');
    expect(box('b2').querySelectorAll('[data-handle]')).toHaveLength(8);
    unmount();
    renderScreen(false);
    goReceipt();
    pick('b2');
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(0);
  });

  it('a drag does nothing on a read only page', () => {
    renderScreen(false);
    goReceipt();
    drag('b2', 10, 10).up();
    expect(box('b2').style.left).toBe('20mm');
  });
});

describe('the keyboard', () => {
  it('arrow keys nudge the selected box by 1 mm, Shift by 5 mm, Alt by 0.1 mm', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    press('ArrowRight');
    expect(box('b2').style.left).toBe('21mm');
    press('ArrowDown', { shiftKey: true });
    expect(box('b2').style.top).toBe('45mm');
    press('ArrowLeft', { altKey: true });
    expect(box('b2').style.left).toBe('20.9mm');
    press('ArrowUp');
    expect(box('b2').style.top).toBe('44mm');
  });

  it('Delete removes the box, Ctrl+D duplicates it, Ctrl+Z and Ctrl+Y undo and redo', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    press('d', { ctrlKey: true });
    expect(boxes()).toHaveLength(5);
    press('Delete');
    expect(boxes()).toHaveLength(4);
    press('z', { ctrlKey: true });
    expect(boxes()).toHaveLength(5);
    press('y', { ctrlKey: true });
    expect(boxes()).toHaveLength(4);
  });

  it('keys do nothing when nothing is selected, and nothing on a read only page', () => {
    const { unmount } = renderScreen();
    goReceipt();
    press('Delete');
    expect(boxes()).toHaveLength(4);
    unmount();
    renderScreen(false);
    goReceipt();
    pick('b2');
    press('Delete');
    expect(boxes()).toHaveLength(4);
  });
});

describe('adding, removing and ordering boxes', () => {
  it('Add text puts a new text box below the others and selects it', () => {
    renderScreen();
    goReceipt();
    click(copy.addText);
    expect(boxes()).toHaveLength(5);
    expect(boxes().at(-1)!.textContent).toBe(copy.textDefault);
    expect(boxes().at(-1)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('Add line and Add logo box make a rule and a marked logo place', () => {
    renderScreen();
    goReceipt();
    click(copy.addLine);
    expect(boxes().at(-1)!.querySelector('.print-rule')).toBeTruthy();
    click(copy.addLogo);
    expect(boxes().at(-1)!.querySelector('.print-image-marker')?.textContent).toBe(copy.logoMarker);
  });

  it('the values list has a tick for each value; ticking adds a box, clearing removes it', () => {
    renderScreen();
    goReceipt();
    const list = document.querySelector('.printing-fields') as HTMLElement;
    const tick = (key: string) => within(list).getByLabelText(fields[key]!) as HTMLInputElement;
    expect(tick('patientName').checked).toBe(true);
    expect(tick('uhid').checked).toBe(false);
    fireEvent.click(tick('uhid'));
    expect(tick('uhid').checked).toBe(true);
    expect(boxes().at(-1)!.textContent).toBe(`${fields.uhid}: ${staffCopy.print.sample.uhid}`);
    fireEvent.click(tick('patientName'));
    expect(tick('patientName').checked).toBe(false);
    expect(box('b2')).toBeNull();
    click(copy.undo);
    expect(valueOf('b2', 'patientName')).toBeTruthy();
  });

  it('a value placed inside a sentence counts as on the page, and clearing keeps the sentence', () => {
    renderScreen();
    goReceipt();
    pick('b4');
    fireEvent.change(select(copy.insertValue), { target: { value: 'uhid' } });
    fireEvent.change(select(copy.insertValue), { target: { value: 'total' } });
    const list = document.querySelector('.printing-fields') as HTMLElement;
    expect((within(list).getByLabelText(fields.uhid!) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(list).getByLabelText(fields.uhid!));
    expect(valueOf('b4', 'uhid')).toBeNull();
    expect(valueOf('b4', 'total')).toBeTruthy();
    expect(box('b4').textContent).toContain('Open 9 to 5');
  });

  it('Delete removes the selected box; Duplicate makes a copy a little further', () => {
    renderScreen();
    goReceipt();
    pick('b3');
    click(copy.duplicate);
    expect(boxes()).toHaveLength(5);
    const copyBox = boxes().at(-1)!;
    expect(copyBox.style.left).toBe('25mm');
    expect(copyBox.style.top).toBe('65mm');
    expect(copyBox.textContent).toBe(box('b3').textContent);
    click(copy.remove);
    expect(boxes()).toHaveLength(4);
    expect(screen.getByText(copy.noSelection)).toBeTruthy();
  });

  it('Bring forward and Send back change the drawing order', () => {
    renderScreen();
    goReceipt();
    pick('b2');
    click(copy.forward);
    expect(boxes().map((b) => b.dataset.box)).toEqual(['b1', 'b3', 'b2', 'b4']);
    click(copy.backward);
    click(copy.backward);
    expect(boxes().map((b) => b.dataset.box)).toEqual(['b2', 'b1', 'b3', 'b4']);
  });

  it('stops adding at the limit of boxes', () => {
    const many: PrintElement[] = Array.from({ length: C.maxElements }, (_, i) =>
      textBox(`x${i}`, 't', { xMm: 1, yMm: 1, widthMm: 10, heightMm: 5 }),
    );
    renderScreen(true, [
      withBoxes(makeTemplate('REGISTRATION_SLIP'), many),
      receipt(),
      templates()[2]!,
    ]);
    expect(isDisabled(copy.addText)).toBe(true);
  });
});

describe('undo and redo', () => {
  it('go through the steps and are disabled at the ends', () => {
    renderScreen();
    goReceipt();
    expect(isDisabled(copy.undo)).toBe(true);
    expect(isDisabled(copy.redo)).toBe(true);
    pick('b3');
    click(copy.bold);
    click(copy.italic);
    click(copy.undo);
    expect(valueOf('b3', 'total')!.style.fontStyle).toBe('');
    expect(valueOf('b3', 'total')!.style.fontWeight).toBe('700');
    expect(isDisabled(copy.redo)).toBe(false);
    click(copy.undo);
    expect(valueOf('b3', 'total')!.style.fontWeight).toBe('');
    expect(isDisabled(copy.undo)).toBe(true);
    click(copy.redo);
    click(copy.redo);
    expect(valueOf('b3', 'total')!.style.fontStyle).toBe('italic');
    expect(isDisabled(copy.redo)).toBe(true);
  });

  it('each document keeps its own steps when switching between documents', () => {
    renderScreen();
    goReceipt();
    pick('b3');
    click(copy.bold);
    click(staffCopy.print.docs.REGISTRATION_SLIP!);
    expect(isDisabled(copy.undo)).toBe(true);
    goReceipt();
    expect(valueOf('b3', 'total')!.style.fontWeight).toBe('700');
    expect(isDisabled(copy.undo)).toBe(false);
  });
});

describe('pre-printed stationery', () => {
  it('fades the boxes that are not printed, and cannot add letterhead boxes', () => {
    renderScreen();
    goReceipt();
    click(copy.addLine);
    fireEvent.change(select(copy.modeLabel), { target: { value: 'PREPRINTED' } });
    expect(screen.getByText(copy.ghostNote)).toBeTruthy();
    expect(boxes().at(-1)!.className).toContain('is-ghost');
    expect(box('b2').className).not.toContain('is-ghost');
    for (const name of [copy.addText, copy.addLine, copy.addLogo]) {
      expect(isDisabled(name)).toBe(true);
    }
  });

  it('a preset of pre-printed stationery replaces the boxes, and undo brings them back', () => {
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.presetLabel), { target: { value: 'PREPRINTED_BILL' } });
    expect(boxes().map((b) => b.dataset.box)).toEqual(['e1', 'e2']);
    expect(select(copy.presetLabel).value).toBe('PREPRINTED_BILL');
    click(copy.undo);
    expect(boxes().map((b) => b.dataset.box)).toEqual(['b1', 'b2', 'b3', 'b4']);
  });
});

describe('print preview', () => {
  it('shows the page exactly as it prints, without handles, and goes back to editing', () => {
    const { container } = renderScreen();
    goReceipt();
    pick('b2');
    click(copy.modePreview);
    expect(container.querySelector('.print-canvas')).toBeNull();
    expect(screen.getByText(copy.previewNote)).toBeTruthy();
    const sheet = container.querySelector('.print-sheet') as HTMLElement;
    expect(sheet.querySelectorAll('[data-handle]')).toHaveLength(0);
    expect(within(sheet).getByText('Open 9 to 5')).toBeTruthy();
    click(copy.modeEdit);
    expect(container.querySelector('.print-canvas')).toBeTruthy();
  });

  it('on pre-printed stationery the preview shows only the values', () => {
    const { container } = renderScreen();
    goReceipt();
    fireEvent.change(select(copy.modeLabel), { target: { value: 'PREPRINTED' } });
    click(copy.modePreview);
    const sheet = container.querySelector('.print-sheet') as HTMLElement;
    expect(within(sheet).queryByText('Open 9 to 5')).toBeNull();
    expect(sheet.textContent).toContain(staffCopy.print.sample.patientName);
    expect(sheet.textContent).not.toContain('Patient:');
  });
});

describe('the page settings', () => {
  it('a preset changes paper, size and boxes; a changed value turns the starting point to Custom', () => {
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.presetLabel), { target: { value: 'LABEL_SLIP' } });
    expect(select(copy.paperLabel).value).toBe('LABEL');
    expect(input(copy.widthLabel).value).toBe('100');
    expect(input(copy.heightLabel).value).toBe('50');
    expect((document.querySelector('.print-canvas-sheet') as HTMLElement).style.width).toBe(
      '100mm',
    );
    type(copy.fontLabel, '12');
    expect(select(copy.presetLabel).value).toBe('');
  });

  it('shows width and height only for papers that need them, and orientation for the others', () => {
    renderScreen();
    goReceipt();
    expect(screen.queryByLabelText(copy.widthLabel)).toBeNull();
    expect(screen.getByLabelText(copy.orientationLabel)).toBeTruthy();
    fireEvent.change(select(copy.paperLabel), { target: { value: 'CUSTOM' } });
    expect(screen.getByLabelText(copy.widthLabel)).toBeTruthy();
    expect(screen.queryByLabelText(copy.orientationLabel)).toBeNull();
  });

  it('landscape turns the page, and the nudge and margins can be typed', () => {
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.orientationLabel), { target: { value: 'LANDSCAPE' } });
    expect((document.querySelector('.print-canvas-sheet') as HTMLElement).style.width).toBe(
      '210mm',
    );
    type(copy.offsetX, '2.5');
    expect(box('b2').style.left).toBe('22.5mm');
    type(copy.marginTop, '20');
    expect((document.querySelector('.print-margin-guide') as HTMLElement).style.top).toBe('20mm');
  });

  it('an unreadable number removes the page from view and is sent as such so the API can refuse it', async () => {
    saveMock.mockResolvedValue({ ok: true, data: receipt() });
    renderScreen();
    goReceipt();
    type(copy.fontLabel, '');
    expect(document.querySelector('.print-canvas')).toBeNull();
    click(copy.save);
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(Number.isNaN(saveMock.mock.calls[0]![1].layout.fontSizePt)).toBe(true);
  });
});

describe('saving', () => {
  it('sends the boxes as designed (version 3) and shows what was saved', async () => {
    const saved = receipt({ source: 'CUSTOM', updatedAt: '2026-11-21T05:00:00.000Z' });
    saveMock.mockResolvedValue({ ok: true, data: saved });
    renderScreen();
    goReceipt();
    pick('b3');
    click(copy.italic);
    click(copy.save);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    const [docType, body] = saveMock.mock.calls[0]!;
    expect(docType).toBe('RECEIPT');
    expect(body).toMatchObject({ paper: 'A5', mode: 'FULL', widthMm: null, heightMm: null });
    expect(body.layout.version).toBe(3);
    expect(body.layout.elements).toHaveLength(4);
    const sent = body.layout.elements.find((e: PrintElement) => e.id === 'b3');
    expect(sent.type).toBe('RICH');
    expect(
      sent.content.paragraphs[0].runs.every(
        (r: { style?: { italic?: boolean } }) => r.style?.italic,
      ),
    ).toBe(true);
    expect(screen.getByText(copy.sourceCustom)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.reset })).toBeTruthy();
    expect(isDisabled(copy.undo)).toBe(true);
  });

  it('sends one request for a double click on Save', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderScreen();
    const save = screen.getByRole('button', { name: copy.save });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(saveMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: templates()[0] });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('explains a refused template in plain words naming the box, and keeps what was designed', async () => {
    saveMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'PRINT_TEMPLATE_INVALID',
      field: 'layout.elements.1.widthMm',
      reason: 'OUT_OF_PAGE',
    });
    renderScreen();
    goReceipt();
    pick('b3');
    click(copy.italic);
    click(copy.save);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const message = screen.getByRole('alert').textContent!;
    expect(message).toContain('2');
    expect(message).toContain(copy.reasons.OUT_OF_PAGE);
    expect(valueOf('b3', 'total')!.style.fontStyle).toBe('italic');
  });

  it('shows the usual calm message for other failures', async () => {
    saveMock.mockResolvedValue({ ok: false, status: 403, code: 'FORBIDDEN' });
    renderScreen();
    click(copy.save);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden),
    );
  });
});

describe('going back to the default', () => {
  it('asks twice, then shows the default', async () => {
    resetMock.mockResolvedValue({ ok: true, data: receipt() });
    renderScreen(true, [templates()[0]!, receipt({ source: 'CUSTOM' }), templates()[2]!]);
    goReceipt();
    click(copy.reset);
    expect(resetMock).not.toHaveBeenCalled();
    expect(screen.getByText(copy.resetConfirm)).toBeTruthy();
    click(copy.cancel);
    expect(screen.queryByText(copy.resetConfirm)).toBeNull();
    click(copy.reset);
    click(copy.resetYes);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.resetDone));
    expect(resetMock).toHaveBeenCalledWith('RECEIPT');
    expect(screen.getByText(copy.sourceDefault)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.reset })).toBeNull();
  });
});

describe('without the write permission', () => {
  it('shows the page for looking only', () => {
    renderScreen(false);
    goReceipt();
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(isDisabled(copy.save)).toBe(true);
    expect(input(copy.fontLabel).matches(':disabled')).toBe(true);
    for (const name of [copy.addText, copy.addLine, copy.addLogo, copy.undo]) {
      expect(isDisabled(name)).toBe(true);
    }
    pick('b2');
    expect(box('b2').getAttribute('aria-pressed')).toBe('true');
    expect(isDisabled(copy.bold)).toBe(true);
    click(copy.modePreview);
    expect(screen.getByText(copy.previewNote)).toBeTruthy();
  });
});

describe('zoom to the room there is', () => {
  const room = (width: number) =>
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => width,
    });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });
  const frame = () => document.querySelector('.print-canvas-frame') as HTMLElement;

  it('starts by fitting the whole page, and fit width follows the width of the room', () => {
    room(600);
    const first = renderScreen();
    goReceipt();
    expect(select(copy.zoomLabel).value).toBe('fit-page');
    fireEvent.change(select(copy.zoomLabel), { target: { value: 'fit-width' } });
    const small = Number(frame().dataset.zoom);
    expect(small).toBeLessThan(100);
    first.unmount();
    room(2400);
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.zoomLabel), { target: { value: 'fit-width' } });
    expect(Number(frame().dataset.zoom)).toBeGreaterThan(small);
  });

  it('a fixed percent can be chosen, and a drag stays exact at any zoom', () => {
    room(800);
    renderScreen();
    goReceipt();
    fireEvent.change(select(copy.zoomLabel), { target: { value: '200' } });
    expect(frame().dataset.zoom).toBe('200');
    drag('b2', 10, 0).up();
    expect(box('b2').style.left).toBe('25mm');
  });
});
