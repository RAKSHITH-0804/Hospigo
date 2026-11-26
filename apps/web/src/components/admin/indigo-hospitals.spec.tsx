import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndigoHospitals } from '@/components/admin/indigo-hospitals';
import { staffCopy } from '@/config/staff-copy';

const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: jest.fn() }),
}));

const copy = staffCopy.admin.indigo;
const hospitals = [
  { id: 'h1', code: 'NORTH', name: 'North Hospital' },
  { id: 'h2', code: 'SOUTH', name: 'South Hospital' },
];

describe('IndigoHospitals', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    replaceMock.mockReset();
  });

  it('lists the real hospitals the person may enter, and says so when there are none', () => {
    const { unmount } = render(<IndigoHospitals hospitals={hospitals} />);
    expect(screen.getByText('North Hospital')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: copy.enter })).toHaveLength(2);
    unmount();
    render(<IndigoHospitals hospitals={[]} />);
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
  });

  it('Enter sends only the hospital id to the same-origin route and opens the hospital', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<IndigoHospitals hospitals={hospitals} />);
    fireEvent.click(screen.getAllByRole('button', { name: copy.enter })[1]!);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/auth/indigo-enter');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
      hospitalId: 'h2',
    });
  });

  it('one plain message for a refusal', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    render(<IndigoHospitals hospitals={hospitals} />);
    fireEvent.click(screen.getAllByRole('button', { name: copy.enter })[0]!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.notAvailable));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
