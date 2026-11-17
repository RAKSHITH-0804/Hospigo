import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UhidStartCard } from '@/components/patients/uhid-start-card';
import { staffCopy } from '@/config/staff-copy';
import type { UhidStartNumberResponse } from '@/lib/patients/types';

const copy = staffCopy.settings.uhid;

function card(
  canWrite: boolean,
  info: typeof baseInfo | null = baseInfo,
  code: string | null = null,
) {
  return <UhidStartCard canWrite={canWrite} initialInfo={info} initialErrorCode={code} />;
}
const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const baseInfo: UhidStartNumberResponse = {
  nextNumber: 12,
  nextUhidPreview: 'TESTA0012',
  resetRule: 'FINANCIAL_YEAR',
  periodYear: 2026,
  periodLabel: '2026-27',
};

const info = baseInfo;

describe('UhidStartCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('shows the server-fetched next number, preview and period line (no client fetch)', () => {
    render(card(false));
    expect(screen.getByText('TESTA0012')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(copy.periodLine.replace('{period}', '2026-27'))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is read-only without the write permission', async () => {
    render(card(false));
    expect(screen.queryByLabelText(copy.newNumberLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull();
  });

  it('omits the period line when there is no period label', async () => {
    render(card(true, { ...info, periodLabel: null, resetRule: 'NEVER' }));
    expect(screen.queryByText(/2026-27/)).toBeNull();
  });

  it('rejects lowering the number and requires a reason without calling PUT', async () => {
    render(card(true));
    fireEvent.change(screen.getByLabelText(copy.newNumberLabel), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts).toEqual([copy.raiseOnlyError, staffCopy.patients.form.required]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs startNumber and reason, shows success and refetches', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({ ...info, nextNumber: 5000, nextUhidPreview: 'TESTA5000' }),
      );
    render(card(true));
    fireEvent.change(screen.getByLabelText(copy.newNumberLabel), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(copy.reasonLabel), {
      target: { value: ' Skip imported block ' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));

    expect((await screen.findByRole('status')).textContent).toBe(copy.success);
    await waitFor(() => expect(screen.getByText('TESTA5000')).toBeTruthy());
    const put = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(put[1].method).toBe('PUT');
    expect(put[1].credentials).toBe('include');
    expect((put[1].headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(put[1].body as string)).toEqual({
      startNumber: 5000,
      reason: 'Skip imported block',
    });
  });

  it('maps PUT failures to copy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'FORBIDDEN' }, 403));
    render(card(true));
    fireEvent.change(screen.getByLabelText(copy.newNumberLabel), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(copy.reasonLabel), { target: { value: 'Reason' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(staffCopy.errors.forbidden);
  });

  it('shows a server load error in an alert', () => {
    render(card(true, null, 'UNAVAILABLE'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(staffCopy.errors.unreachable);
  });
});
