import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndigoLibrary } from '@/components/admin/indigo-library';
import { IndigoTerminology } from '@/components/admin/indigo-terminology';
import { staffCopy } from '@/config/staff-copy';
import type { LibraryOverview } from '@/lib/indigo/library';

const refreshMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: jest.fn() }),
}));
const lib = {
  addSamples: jest.fn(),
  createLibraryTemplate: jest.fn(),
  retireLibraryTemplate: jest.fn(),
  uploadLibraryLogo: jest.fn(),
  getHospitalLibrary: jest.fn(),
  saveHospitalLibrary: jest.fn(),
  getTerms: jest.fn(),
  saveTerms: jest.fn(),
};
jest.mock('@/lib/indigo/library', () => ({
  ...jest.requireActual('@/lib/indigo/library'),
  addSamples: (...a: unknown[]) => lib.addSamples(...a),
  createLibraryTemplate: (...a: unknown[]) => lib.createLibraryTemplate(...a),
  retireLibraryTemplate: (...a: unknown[]) => lib.retireLibraryTemplate(...a),
  uploadLibraryLogo: (...a: unknown[]) => lib.uploadLibraryLogo(...a),
  getHospitalLibrary: (...a: unknown[]) => lib.getHospitalLibrary(...a),
  saveHospitalLibrary: (...a: unknown[]) => lib.saveHospitalLibrary(...a),
  getTerms: (...a: unknown[]) => lib.getTerms(...a),
  saveTerms: (...a: unknown[]) => lib.saveTerms(...a),
}));

const copy = staffCopy.library;
const hospitals = [
  { id: 'h1', name: 'North Hospital' },
  { id: 'h2', name: 'South Hospital' },
];
const overview = (over: Partial<LibraryOverview> = {}): LibraryOverview => ({
  templates: [
    {
      id: 't1',
      docType: 'RECEIPT',
      key: 'bill-classic',
      name: 'Classic cash bill (A5)',
      description: '',
      paper: 'A5',
      retired: false,
      hospitalIds: ['h1'],
    },
    {
      id: 't2',
      docType: 'RECEIPT',
      key: 'bill-modern',
      name: 'Modern bill (A5)',
      description: '',
      paper: 'A5',
      retired: false,
      hospitalIds: [],
    },
  ],
  logos: [{ id: 'l1', name: 'North mark', width: 256, height: 256, hospitalIds: ['h1'] }],
  samplesMissing: 3,
  ...over,
});

describe('IndigoLibrary', () => {
  beforeEach(() => {
    Object.values(lib).forEach((fn) => fn.mockReset());
    refreshMock.mockReset();
    lib.getHospitalLibrary.mockResolvedValue({
      ok: true,
      data: { templateIds: ['t1'], logoIds: [] },
    });
  });

  it('lists templates and logos with how many hospitals have them, and says how many samples are missing', async () => {
    render(<IndigoLibrary overview={overview()} hospitals={hospitals} />);
    expect(screen.getAllByText(/Classic cash bill/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/North mark/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 designed samples/)).toBeTruthy();
    await waitFor(() => expect(lib.getHospitalLibrary).toHaveBeenCalledWith('h1'));
  });

  it('adds the samples and refreshes; one plain message when it fails', async () => {
    lib.addSamples.mockResolvedValue({ ok: true, data: { added: 14 } });
    render(<IndigoLibrary overview={overview()} hospitals={hospitals} />);
    fireEvent.click(screen.getByRole('button', { name: copy.addSamples }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('14'));
    expect(refreshMock).toHaveBeenCalled();
    lib.addSamples.mockResolvedValue({ ok: false, status: 500 });
    fireEvent.click(screen.getByRole('button', { name: copy.addSamples }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('saves what one hospital may choose from, with exactly the ticked templates', async () => {
    lib.saveHospitalLibrary.mockResolvedValue({ ok: true, data: { templateIds: [], logoIds: [] } });
    render(<IndigoLibrary overview={overview()} hospitals={hospitals} />);
    await waitFor(() => expect(lib.getHospitalLibrary).toHaveBeenCalled());
    // wait until the hospital's current choice (t1) has been loaded and ticked
    await waitFor(() =>
      expect((screen.getAllByLabelText(/Classic cash bill/)[0] as HTMLInputElement).checked).toBe(
        true,
      ),
    );
    const modern = screen.getAllByLabelText(/Modern bill/)[0] as HTMLInputElement;
    fireEvent.click(modern);
    fireEvent.click(screen.getByRole('button', { name: copy.assignSave }));
    await waitFor(() => expect(lib.saveHospitalLibrary).toHaveBeenCalled());
    const [id, body] = lib.saveHospitalLibrary.mock.calls[0]!;
    expect(id).toBe('h1');
    expect([...body.templateIds].sort()).toEqual(['t1', 't2']);
  });

  it('retires a template on the button', async () => {
    lib.retireLibraryTemplate.mockResolvedValue({ ok: true, data: { ok: true } });
    render(<IndigoLibrary overview={overview()} hospitals={hospitals} />);
    fireEvent.click(screen.getAllByRole('button', { name: copy.retire })[0]!);
    await waitFor(() => expect(lib.retireLibraryTemplate).toHaveBeenCalledWith('t1'));
  });
});

describe('IndigoTerminology', () => {
  beforeEach(() => {
    lib.getTerms.mockReset();
    lib.saveTerms.mockReset();
  });

  it('shows the words of the chosen hospital and saves a changed word, clearing the empty ones', async () => {
    lib.getTerms.mockResolvedValue({ ok: true, data: { items: { patient: 'Client' } } });
    lib.saveTerms.mockResolvedValue({ ok: true, data: { items: { patient: 'Guest' } } });
    render(<IndigoTerminology hospitals={hospitals} />);
    await waitFor(() => expect(lib.getTerms).toHaveBeenCalledWith('h1'));
    const box = (await screen.findAllByDisplayValue('Client'))[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('button', { name: staffCopy.terms.save }));
    await waitFor(() => expect(lib.saveTerms).toHaveBeenCalled());
    const [id, items] = lib.saveTerms.mock.calls[0]!;
    expect(id).toBe('h1');
    expect(items.patient).toBe('Guest');
    expect(items.queue).toBeNull();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(staffCopy.terms.saved));
  });

  it('one plain message when the words are refused', async () => {
    lib.getTerms.mockResolvedValue({ ok: true, data: { items: {} } });
    lib.saveTerms.mockResolvedValue({ ok: false, status: 400 });
    render(<IndigoTerminology hospitals={hospitals} />);
    await waitFor(() => expect(lib.getTerms).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: staffCopy.terms.save }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(staffCopy.terms.failed));
  });
});
