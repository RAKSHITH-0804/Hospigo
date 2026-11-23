import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ImportsScreen, stateOf } from '@/components/settings/imports-screen';
import { importScreenConfig } from '@/config/imports';
import { staffCopy } from '@/config/staff-copy';
import { batchProblemText } from '@/lib/imports/errors';
import type { ImportBatch, ImportListResponse, ImportRow } from '@/lib/imports/types';

const listMock = jest.fn();
const getMock = jest.fn();
const rowsMock = jest.fn();
const actionMock = jest.fn();
const uploadMock = jest.fn();
jest.mock('@/lib/imports/client', () => ({
  listImports: (...a: unknown[]) => listMock(...a),
  getImport: (...a: unknown[]) => getMock(...a),
  importRows: (...a: unknown[]) => rowsMock(...a),
  importAction: (...a: unknown[]) => actionMock(...a),
  uploadImport: (...a: unknown[]) => uploadMock(...a),
  templateHref: (type: string) => `/api/staff/imports/templates/${type}`,
}));

const copy = staffCopy.imports;

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'b1',
  type: 'MEDICINES',
  status: 'PREVIEWED',
  runStatus: null,
  runStale: false,
  fileName: 'medicines.xlsx',
  totalRows: 5,
  validRows: 3,
  exceptionRows: 2,
  unchangedRows: 1,
  postedRows: 0,
  errorMessage: null,
  createdAt: '2026-11-23T10:00:00.000Z',
  createdByName: 'Asha',
  approvedAt: null,
  postedAt: null,
  ...over,
});

const list = (items: ImportBatch[]): ImportListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
});

const problemRow = (over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: 3,
  matchKey: 'PCM',
  status: 'EXCEPTION',
  action: null,
  values: {},
  reason: 'NAME_REQUIRED',
  field: 'name',
  ...over,
});

const page = (items: ImportRow[]) => ({
  ok: true,
  data: { items, total: items.length, page: 1, pageSize: 50 },
});

const file = () => new File([new Uint8Array([80, 75])], 'medicines.xlsx');

function chooseFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file()], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  jest.useRealTimers();
  for (const m of [listMock, getMock, rowsMock, actionMock, uploadMock]) m.mockReset();
  listMock.mockResolvedValue({ ok: true, data: list([]) });
  rowsMock.mockResolvedValue(page([]));
});

describe('stateOf', () => {
  it('words every step of a batch', () => {
    expect(stateOf(batch({ status: 'DRAFT', runStatus: 'PREVIEWING' })).key).toBe('reading');
    expect(stateOf(batch({ status: 'DRAFT', runStatus: 'PREVIEWING', runStale: true })).key).toBe(
      'slow',
    );
    expect(stateOf(batch()).key).toBe('checked');
    expect(stateOf(batch({ status: 'APPROVED' })).key).toBe('approved');
    expect(stateOf(batch({ status: 'APPROVED', runStatus: 'POSTING' })).key).toBe('saving');
    expect(stateOf(batch({ status: 'APPROVED', runStatus: 'POST_FAILED' })).key).toBe('saveFailed');
    expect(stateOf(batch({ status: 'POSTED' })).key).toBe('saved');
    expect(stateOf(batch({ status: 'FAILED', runStatus: 'CANCELLED' })).key).toBe('cancelled');
    expect(stateOf(batch({ status: 'FAILED', runStatus: 'FAILED' })).key).toBe('failed');
  });

  it('turns the stored problem codes into plain words', () => {
    expect(batchProblemText(null)).toBeNull();
    expect(batchProblemText('MISSING_COLUMNS: Price, Name')).toContain('Price, Name');
    expect(batchProblemText('TOO_MANY_ROWS')).toBe(copy.runReasons.TOO_MANY_ROWS);
    expect(batchProblemText('STALE:VERSION_EXISTS:3')).toContain('row 3');
    expect(batchProblemText('STALE:FILE_CHANGED')).toContain(copy.rowReasons.FILE_CHANGED);
    expect(batchProblemText('SOMETHING_ELSE')).toBe(copy.runReasons.RUN_FAILED);
  });
});

describe('ImportsScreen', () => {
  it('offers the price lists only to people who may change prices', () => {
    const { unmount } = render(
      <ImportsScreen initial={list([])} initialErrorCode={null} allowPrices={false} />,
    );
    const options = within(screen.getByLabelText(copy.typeLabel)).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([copy.types.MEDICINES]);
    unmount();
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    expect(
      within(screen.getByLabelText(copy.typeLabel))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([copy.types.TESTS, copy.types.DOCTOR_FEES, copy.types.MEDICINES]);
  });

  it('shows the sample file link of the chosen list, the hint, and the empty history', () => {
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    const link = screen.getByRole('link', { name: copy.sample });
    expect(link.getAttribute('href')).toBe('/api/staff/imports/templates/TESTS');
    expect(screen.getByText(copy.typeHints.TESTS!)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(copy.typeLabel), { target: { value: 'DOCTOR_FEES' } });
    expect(link.getAttribute('href')).toBe('/api/staff/imports/templates/DOCTOR_FEES');
    expect(screen.getByText(copy.emptyHistory)).toBeTruthy();
  });

  it('shows a calm error when the first load failed', () => {
    render(<ImportsScreen initial={null} initialErrorCode="FORBIDDEN" allowPrices />);
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
  });

  it('asks for a file before uploading', async () => {
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.noFile);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('tells in plain words why a file was refused, and why a duplicate was', async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: 'IMPORT_FILE_INVALID',
      reason: 'MACROS',
    });
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.fileReasons.MACROS);
    uploadMock.mockResolvedValueOnce({ ok: false, status: 409, code: 'IMPORT_DUPLICATE_FILE' });
    fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(copy.errors.IMPORT_DUPLICATE_FILE),
    );
  });

  it('upload, wait for the check, see the problems in words, approve, save, done', async () => {
    jest.useFakeTimers();
    uploadMock.mockResolvedValue({
      ok: true,
      data: batch({
        status: 'DRAFT',
        runStatus: 'PREVIEWING',
        totalRows: 0,
        validRows: 0,
        exceptionRows: 0,
      }),
    });
    getMock.mockResolvedValueOnce({ ok: true, data: batch() });
    rowsMock.mockResolvedValue(page([problemRow()]));
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    chooseFile();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    });
    expect(screen.getAllByText(copy.states.reading).length).toBeGreaterThan(0);
    // the screen asks again while the file is being read
    await act(async () => {
      jest.advanceTimersByTime(importScreenConfig.pollMs + 10);
    });
    expect(getMock).toHaveBeenCalledWith('b1');
    expect(screen.getAllByText(copy.states.checked).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        '5 rows: 3 can be saved (1 are already as the file says), 2 have problems and are left out.',
      ),
    ).toBeTruthy();
    // the problem row is told in words, with its column
    expect(
      await screen.findByText(
        copy.problemLine
          .replace('{reason}', copy.rowReasons.NAME_REQUIRED!)
          .replace('{column}', 'Name'),
      ),
    ).toBeTruthy();

    actionMock.mockResolvedValueOnce({ ok: true, data: batch({ status: 'APPROVED' }) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.approve }));
    });
    expect(actionMock).toHaveBeenLastCalledWith('b1', 'approve');
    expect(screen.getAllByText(copy.states.approved).length).toBeGreaterThan(0);

    actionMock.mockResolvedValueOnce({
      ok: true,
      data: batch({ status: 'APPROVED', runStatus: 'POSTING' }),
    });
    getMock.mockResolvedValueOnce({
      ok: true,
      data: batch({ status: 'POSTED', postedRows: 3 }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy.save }));
    });
    expect(actionMock).toHaveBeenLastCalledWith('b1', 'post');
    expect(screen.getAllByText(copy.states.saving).length).toBeGreaterThan(0);
    // no button can be pressed while it is being saved
    expect(screen.queryByRole('button', { name: copy.cancel })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(importScreenConfig.pollMs + 10);
    });
    expect(screen.getAllByText(copy.states.saved).length).toBeGreaterThan(0);
    expect(screen.getByText(copy.savedCounts.replace('{posted}', '3'))).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.another })).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
  });

  it('cannot approve a batch with nothing to save, and can cancel it', async () => {
    const empty = batch({ totalRows: 2, validRows: 0, exceptionRows: 2 });
    render(<ImportsScreen initial={list([empty])} initialErrorCode={null} allowPrices />);
    fireEvent.click(screen.getByRole('button', { name: `${empty.fileName}: ${copy.open}` }));
    expect((screen.getByRole('button', { name: copy.approve }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    actionMock.mockResolvedValueOnce({
      ok: true,
      data: batch({ status: 'FAILED', runStatus: 'CANCELLED' }),
    });
    fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
    await waitFor(() =>
      expect(screen.getAllByText(copy.states.cancelled).length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('button', { name: copy.approve })).toBeNull();
    expect(screen.getByRole('button', { name: copy.another })).toBeTruthy();
  });

  it('a failed save keeps the batch approved, says why and offers to try again', async () => {
    const failed = batch({
      status: 'APPROVED',
      runStatus: 'POST_FAILED',
      errorMessage: 'STALE:VERSION_EXISTS:3',
    });
    render(<ImportsScreen initial={list([failed])} initialErrorCode={null} allowPrices />);
    fireEvent.click(screen.getByRole('button', { name: `${failed.fileName}: ${copy.open}` }));
    expect(screen.getByRole('alert').textContent).toContain('row 3');
    expect(screen.getByRole('alert').textContent).toContain(copy.rowReasons.VERSION_EXISTS);
    expect(screen.getByRole('button', { name: copy.retry })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.cancel })).toBeTruthy();
  });

  it('a file that could not be read says which column is missing', () => {
    const bad = batch({
      status: 'FAILED',
      runStatus: 'FAILED',
      errorMessage: 'MISSING_COLUMNS: Price',
    });
    render(<ImportsScreen initial={list([bad])} initialErrorCode={null} allowPrices />);
    fireEvent.click(screen.getByRole('button', { name: `${bad.fileName}: ${copy.open}` }));
    expect(screen.getByRole('alert').textContent).toContain('Price');
    expect(screen.queryByRole('button', { name: copy.approve })).toBeNull();
  });

  it('a refused action shows the reason and reloads the batch', async () => {
    const approved = batch({ status: 'APPROVED' });
    render(<ImportsScreen initial={list([approved])} initialErrorCode={null} allowPrices />);
    fireEvent.click(screen.getByRole('button', { name: `${approved.fileName}: ${copy.open}` }));
    actionMock.mockResolvedValueOnce({ ok: false, status: 409, code: 'IMPORT_BUSY' });
    getMock.mockResolvedValueOnce({
      ok: true,
      data: batch({ status: 'APPROVED', runStatus: 'POSTING' }),
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.IMPORT_BUSY);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('b1'));
  });

  it('does not send the same click twice', async () => {
    let finish: (v: unknown) => void = () => {};
    uploadMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ImportsScreen initial={list([])} initialErrorCode={null} allowPrices />);
    chooseFile();
    const button = screen.getByRole('button', { name: copy.upload });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ok: false, status: 409, code: 'IMPORT_DUPLICATE_FILE' });
    });
  });

  it('lists earlier uploads with their state', () => {
    render(
      <ImportsScreen
        initial={list([
          batch({ status: 'POSTED', postedRows: 3 }),
          batch({ id: 'b2', status: 'FAILED', runStatus: 'CANCELLED', fileName: 'old.xlsx' }),
        ])}
        initialErrorCode={null}
        allowPrices
      />,
    );
    const table = screen.getByRole('table', { name: copy.historyTitle });
    expect(within(table).getByText(copy.states.saved)).toBeTruthy();
    expect(within(table).getByText(copy.states.cancelled)).toBeTruthy();
    expect(within(table).getByText('old.xlsx')).toBeTruthy();
  });

  it('shows every column of the file for each row (Code, Name, Price, Active ...)', async () => {
    rowsMock.mockResolvedValue(
      page([
        problemRow({
          rowNumber: 2,
          matchKey: 'CBC',
          status: 'VALID',
          action: 'CREATE',
          values: {
            code: 'CBC',
            name: 'Complete blood count',
            price: 350,
            startDate: '',
            active: 'Yes',
          },
          reason: null,
          field: null,
        }),
      ]),
    );
    render(
      <ImportsScreen
        initial={list([batch({ type: 'TESTS', exceptionRows: 0, validRows: 1, totalRows: 1 })])}
        initialErrorCode={null}
        allowPrices
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `medicines.xlsx: ${copy.open}` }));
    const table = await screen.findByRole('table', { name: copy.okTitle });
    for (const header of ['Code', 'Name', 'Price', 'Start date', 'Active']) {
      expect(within(table).getByText(header)).toBeTruthy();
    }
    expect(within(table).getByText('Complete blood count')).toBeTruthy();
    expect(within(table).getByText('350')).toBeTruthy();
    expect(within(table).getByText('Yes')).toBeTruthy();
    expect(within(table).getByText('—')).toBeTruthy(); // the empty start date
  });

  it('Open on a saved upload shows the rows that were saved and brings the block into view', async () => {
    const scroll = jest.fn();
    Element.prototype.scrollIntoView = scroll;
    rowsMock.mockResolvedValue(
      page([
        problemRow({
          rowNumber: 2,
          matchKey: 'PCM500',
          status: 'POSTED',
          action: 'CREATE',
          values: {
            code: 'PCM500',
            name: 'Paracetamol',
            composition: 'Paracetamol',
            form: 'Tablet',
            active: 'Yes',
          },
          reason: null,
          field: null,
        }),
      ]),
    );
    render(
      <ImportsScreen
        initial={list([batch({ status: 'POSTED', postedRows: 1, exceptionRows: 0, totalRows: 1 })])}
        initialErrorCode={null}
        allowPrices
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `medicines.xlsx: ${copy.open}` }));
    const table = await screen.findByRole('table', { name: copy.savedTitle });
    expect(within(table).getByText('PCM500')).toBeTruthy();
    expect(rowsMock).toHaveBeenLastCalledWith('b1', 'POSTED', 1, expect.any(Number));
    expect(scroll).toHaveBeenCalled();
  });
});
