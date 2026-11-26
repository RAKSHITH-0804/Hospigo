import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndigoSwitch } from '@/components/shell/indigo-switch';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.admin.switchHospital;
const assignMock = jest.fn();

describe('IndigoSwitch', () => {
  const originalFetch = global.fetch;
  beforeEach(() => assignMock.mockReset());
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const reply = (items: Array<{ id: string; name: string }>, enterOk = true) => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        String(url).includes('indigo-hospitals')
          ? { ok: true, json: async () => ({ items }) }
          : { ok: enterOk, status: enterOk ? 200 : 403 },
      ),
    ) as unknown as typeof fetch;
  };

  it('offers the other hospitals and switches without signing out', async () => {
    reply([
      { id: 'h1', name: 'North' },
      { id: 'h2', name: 'South' },
    ]);
    render(<IndigoSwitch currentName="North" navigate={assignMock} />);
    const button = await screen.findByRole('button', { name: copy.button });
    fireEvent.click(button);
    await waitFor(() => expect(assignMock).toHaveBeenCalled());
    const enter = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('indigo-enter'),
    )!;
    expect(JSON.parse(enter[1].body)).toEqual({ hospitalId: 'h2' });
  });

  it('is not shown with a single hospital, and says plainly when the switch is refused', async () => {
    reply([{ id: 'h1', name: 'North' }]);
    const { container, unmount } = render(
      <IndigoSwitch currentName="North" navigate={assignMock} />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();
    reply(
      [
        { id: 'h1', name: 'North' },
        { id: 'h2', name: 'South' },
      ],
      false,
    );
    render(<IndigoSwitch currentName="North" navigate={assignMock} />);
    fireEvent.click(await screen.findByRole('button', { name: copy.button }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.failed));
  });
});
