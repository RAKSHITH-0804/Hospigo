import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UhidFormatCard } from '@/components/settings/uhid-format-card';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import type { UhidFormatResponse } from '@/lib/settings/types';

const saveMock = jest.fn();
jest.mock('@/lib/settings/client', () => ({
  saveUhidFormat: (...args: unknown[]) => saveMock(...args),
}));

const copy = staffCopy.settings.uhidFormat;
const limits = {
  maxBlocks: 12,
  maxTextLength: 10,
  minWidthMin: 1,
  minWidthMax: 12,
  maxExampleLength: 30,
  fyStartMonthMin: 1,
  fyStartMonthMax: 12,
  fyStartMonthDefault: 4,
};
const configured = (): UhidFormatResponse => ({
  configured: true,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  format: {
    resetRule: 'NEVER',
    fyStartMonth: 4,
    blocks: [
      { blockType: 'FIXED_TEXT', textValue: 'UH', fyStyle: null, minWidth: null },
      { blockType: 'SEPARATOR', textValue: '-', fyStyle: null, minWidth: null },
      { blockType: 'RUNNING_NUMBER', textValue: null, fyStyle: null, minWidth: 5 },
    ],
  },
  example: 'UH-00001',
  next: 'UH-00041',
  branchCode: 'MAIN',
  limits,
});
const unconfigured = (): UhidFormatResponse => ({
  configured: false,
  effectiveFrom: null,
  format: null,
  example: null,
  next: null,
  branchCode: 'MAIN',
  limits,
});

const renderCard = (info: UhidFormatResponse | null = configured(), canWrite = true) =>
  render(<UhidFormatCard initial={info} initialErrorCode={null} canWrite={canWrite} />);
const part = (n: number) =>
  screen.getByRole('group', { name: copy.partAria.replace('{n}', String(n)) });
const parts = () => screen.queryAllByRole('group', { name: /^Piece \d+$/ });
const sampleText = () =>
  screen.getByText(copy.previewLabel).closest('div')!.querySelector('.settings-sample')!
    .textContent;
const saveButton = () => screen.getByRole('button', { name: copy.save }) as HTMLButtonElement;

beforeEach(() => saveMock.mockReset());

describe('UhidFormatCard', () => {
  it('shows the format in use with its sample and the next number, and the parts to edit', () => {
    renderCard();
    // the sample in use now, and the sample of the design (the same at first)
    expect(screen.getAllByText('UH-00001')).toHaveLength(2);
    expect(sampleText()).toBe('UH-00001');
    expect(screen.getByText('UH-00041')).toBeTruthy();
    expect(parts()).toHaveLength(3);
    expect((within(part(1)).getByLabelText(copy.textLabel) as HTMLInputElement).value).toBe('UH');
    expect((within(part(3)).getByLabelText(copy.widthLabel) as HTMLInputElement).value).toBe('5');
    expect(sampleText()).toBe('UH-00001');
  });

  it('the sample of the design follows every change', () => {
    renderCard();
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'AB' } });
    expect(sampleText()).toBe('AB-00001');
    fireEvent.change(within(part(3)).getByLabelText(copy.widthLabel), { target: { value: '8' } });
    expect(sampleText()).toBe('AB-00000001');
  });

  it('Save waits until something is changed, and says the format is already in use', () => {
    renderCard();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(copy.unchanged)).toBeTruthy();
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'XY' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'UH' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('asks before saving, can be cancelled, then saves the design and shows the answer', async () => {
    const next = configured();
    next.format!.blocks[0]!.textValue = 'XY';
    next.example = 'XY-00001';
    next.next = 'XY-00041';
    saveMock.mockResolvedValue({ ok: true, data: next });
    renderCard();
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'XY' } });
    fireEvent.click(saveButton());
    expect(screen.getByText(copy.confirm)).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
    expect(screen.queryByText(copy.confirm)).toBeNull();
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole('button', { name: copy.confirmYes }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(saveMock).toHaveBeenCalledWith({
      resetRule: 'NEVER',
      fyStartMonth: 4,
      blocks: [
        { blockType: 'FIXED_TEXT', textValue: 'XY', fyStyle: null, minWidth: null },
        { blockType: 'SEPARATOR', textValue: '-', fyStyle: null, minWidth: null },
        { blockType: 'RUNNING_NUMBER', textValue: null, fyStyle: null, minWidth: 5 },
      ],
    });
    expect(screen.getByText('XY-00041')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('a second click on Yes does not send a second request', async () => {
    let finish: (v: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCard();
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'XY' } });
    fireEvent.click(saveButton());
    const yes = screen.getByRole('button', { name: copy.confirmYes });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(saveMock).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: configured() });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('explains a refusal naming the part, and keeps the design', async () => {
    saveMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'blocks.0.textValue',
      reason: 'INVALID',
    });
    renderCard();
    fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'A B' } });
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole('button', { name: copy.confirmYes }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const errors = staffCopy.settings.settingsErrors;
    expect(screen.getByRole('alert').textContent).toBe(
      `${errors.prefix} ${errors.fields.textValue} (piece 1) ${errors.reasons.INVALID}`,
    );
    expect((within(part(1)).getByLabelText(copy.textLabel) as HTMLInputElement).value).toBe('A B');
    expect(screen.queryByText(copy.confirm)).toBeNull();
  });

  it('adds, removes and moves parts; the running number can be used only once', () => {
    renderCard();
    const add = screen.getByLabelText(copy.addPart) as HTMLSelectElement;
    const offered = [...add.options].map((o) => o.value).filter(Boolean);
    expect(offered).toEqual([
      'FIXED_TEXT',
      'SEPARATOR',
      'BRANCH_CODE',
      'FINANCIAL_YEAR',
      'CALENDAR_YEAR',
    ]);
    fireEvent.change(add, { target: { value: 'BRANCH_CODE' } });
    expect(parts()).toHaveLength(4);
    expect(sampleText()).toBe('UH-00001MAIN');
    // the branch code is now used: no second one is offered
    expect(
      [...(screen.getByLabelText(copy.addPart) as HTMLSelectElement).options].map((o) => o.value),
    ).not.toContain('BRANCH_CODE');
    fireEvent.click(within(part(4)).getByRole('button', { name: copy.moveUp }));
    expect(sampleText()).toBe('UH-MAIN00001');
    expect(
      (within(part(1)).getByRole('button', { name: copy.moveUp }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(part(4)).getByRole('button', { name: copy.moveDown }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(part(3)).getByRole('button', { name: copy.remove }));
    expect(parts()).toHaveLength(3);
    expect(sampleText()).toBe('UH-00001');
    fireEvent.click(within(part(2)).getByRole('button', { name: copy.remove }));
    expect(sampleText()).toBe('UH00001');
  });

  it('the last part cannot be removed, and the number of parts has a limit', () => {
    const info = configured();
    info.limits.maxBlocks = 3;
    renderCard(info);
    expect((screen.getByLabelText(copy.addPart) as HTMLSelectElement).disabled).toBe(true);
    for (const n of [3, 2]) {
      fireEvent.click(within(part(n)).getByRole('button', { name: copy.remove }));
    }
    expect(
      (within(part(1)).getByRole('button', { name: copy.remove }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('changing the type of a part resets what that type needs', () => {
    renderCard();
    fireEvent.change(within(part(1)).getByLabelText(copy.typeLabel), {
      target: { value: 'FINANCIAL_YEAR' },
    });
    expect(within(part(1)).queryByLabelText(copy.textLabel)).toBeNull();
    expect(within(part(1)).getByLabelText(copy.styleLabel)).toBeTruthy();
    fireEvent.change(within(part(1)).getByLabelText(copy.styleLabel), {
      target: { value: 'LONG' },
    });
    expect(sampleText()).toMatch(/^\d{4}-\d{2}-00001$/);
    fireEvent.change(within(part(1)).getByLabelText(copy.typeLabel), {
      target: { value: 'SEPARATOR' },
    });
    expect((within(part(1)).getByLabelText(copy.textLabel) as HTMLInputElement).value).toBe('-');
  });

  it('restarting every financial year asks for the month the year starts in', () => {
    renderCard();
    expect(screen.queryByLabelText(copy.fyStartLabel)).toBeNull();
    fireEvent.change(screen.getByLabelText(copy.resetLabel), {
      target: { value: 'FINANCIAL_YEAR' },
    });
    const month = screen.getByLabelText(copy.fyStartLabel) as HTMLSelectElement;
    expect(month.value).toBe('4');
    expect(month.options).toHaveLength(12);
    expect(month.options[3]!.textContent).toBe('April');
    fireEvent.change(month, { target: { value: '1' } });
    expect(month.value).toBe('1');
  });

  it('before the first format it offers a starting design and an enabled Save', () => {
    renderCard(unconfigured());
    expect(screen.getByText(copy.notConfigured)).toBeTruthy();
    expect(parts()).toHaveLength(3);
    expect(saveButton().disabled).toBe(false);
  });

  it('shows the usual message when the format could not be read', () => {
    render(<UhidFormatCard initial={null} initialErrorCode="UNAVAILABLE" canWrite />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('without the write permission it is for looking only', () => {
    renderCard(configured(), false);
    expect(screen.getByText(copy.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
    expect(within(part(1)).getByLabelText(copy.textLabel).matches(':disabled')).toBe(true);
    expect(screen.getByLabelText(copy.resetLabel).matches(':disabled')).toBe(true);
  });
  it('Saved. fades by itself after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      saveMock.mockResolvedValue({ ok: true, data: configured() });
      renderCard();
      fireEvent.change(within(part(1)).getByLabelText(copy.textLabel), { target: { value: 'XY' } });
      fireEvent.click(saveButton());
      fireEvent.click(screen.getByRole('button', { name: copy.confirmYes }));
      await act(async () => {});
      expect(screen.getByRole('status').textContent).toBe(copy.saved);
      act(() => {
        jest.advanceTimersByTime(settingsScreenConfig.savedMessageMs + 10);
      });
      expect(screen.getByRole('status').textContent).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('no hint line pushes a piece row out of line: the digits box has no hint under it', () => {
    renderCard();
    expect(screen.getByText(copy.partsHelp)).toBeTruthy();
    expect(within(part(3)).queryByText(copy.widthHint)).toBeNull();
    expect(within(part(3)).getByLabelText(copy.widthLabel).getAttribute('title')).toBe(
      copy.widthHint,
    );
  });

  it('the move and remove buttons are small icons that still have a name', () => {
    renderCard();
    for (const name of [copy.moveUp, copy.moveDown, copy.remove]) {
      expect(within(part(2)).getByRole('button', { name }).getAttribute('title')).toBe(name);
    }
  });
});
