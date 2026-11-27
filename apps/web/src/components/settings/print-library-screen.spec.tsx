import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrintLibraryScreen } from '@/components/settings/print-library-screen';
import { staffCopy } from '@/config/staff-copy';
import type { ChooserView } from '@/lib/indigo/library';

const refreshMock = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const chooseTemplateMock = jest.fn();
const chooseLogoMock = jest.fn();
jest.mock('@/lib/indigo/library', () => ({
  ...jest.requireActual('@/lib/indigo/library'),
  chooseTemplate: (...a: unknown[]) => chooseTemplateMock(...a),
  chooseLogo: (...a: unknown[]) => chooseLogoMock(...a),
}));

const copy = staffCopy.library;
const view = (over: Partial<ChooserView> = {}): ChooserView => ({
  canChoose: { branch: true, hospital: true },
  templates: [
    {
      id: 't1',
      docType: 'RECEIPT',
      name: 'Classic bill',
      description: '',
      paper: 'A5',
      active: true,
    },
    {
      id: 't2',
      docType: 'RECEIPT',
      name: 'Modern bill',
      description: '',
      paper: 'A5',
      active: false,
    },
  ],
  logos: [{ id: 'l1', name: 'North mark', width: 256, height: 256 }],
  ...over,
});

describe('PrintLibraryScreen', () => {
  beforeEach(() => {
    chooseTemplateMock.mockReset();
    chooseLogoMock.mockReset();
    refreshMock.mockReset();
  });

  it('marks the design in use and offers Use on the others', () => {
    render(<PrintLibraryScreen view={view()} />);
    expect(screen.getByText(copy.inUse)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: copy.use })).toHaveLength(1);
  });

  it('a SuperAdmin chooses for the whole hospital and sees the logos; an Admin only for the branch, without logos', async () => {
    chooseTemplateMock.mockResolvedValue({ ok: true, data: { scope: 'HOSPITAL' } });
    const { unmount } = render(<PrintLibraryScreen view={view()} />);
    fireEvent.click(screen.getByRole('button', { name: copy.use }));
    await waitFor(() => expect(chooseTemplateMock).toHaveBeenCalledWith('t2', 'hospital'));
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.logoUse })).toBeTruthy();
    unmount();
    chooseTemplateMock.mockClear();
    render(<PrintLibraryScreen view={view({ canChoose: { branch: true, hospital: false } })} />);
    expect(screen.queryByRole('button', { name: copy.logoUse })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.use }));
    await waitFor(() => expect(chooseTemplateMock).toHaveBeenCalledWith('t2', 'branch'));
  });

  it('chooses a logo; says so plainly when nothing is assigned or the load failed or a choice is refused', async () => {
    chooseLogoMock.mockResolvedValue({ ok: false, status: 403 });
    const { unmount } = render(<PrintLibraryScreen view={view()} />);
    fireEvent.click(screen.getByRole('button', { name: copy.logoUse }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.chooseFailed));
    unmount();
    const empty = render(<PrintLibraryScreen view={view({ templates: [], logos: [] })} />);
    expect(screen.getByText(copy.chooserEmpty)).toBeTruthy();
    empty.unmount();
    render(<PrintLibraryScreen view={null} />);
    expect(screen.getByRole('alert').textContent).toBe(copy.loadFailed);
  });
});
