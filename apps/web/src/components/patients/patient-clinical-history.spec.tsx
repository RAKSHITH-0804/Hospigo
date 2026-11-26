import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PatientClinicalHistory } from '@/components/patients/patient-clinical-history';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.patients.history;

describe('PatientClinicalHistory', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads nothing until the person asks (opening it is logged), then shows every visit read-only', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        visits: [
          {
            visitId: 'v1',
            visitDate: '2026-11-20',
            status: 'COMPLETED',
            branch: { id: 'b1', name: 'East Wing' },
            doctor: { id: 'd1', name: 'Dr Rao' },
            receptionSymptoms: 'Cold and fever',
            consultation: {
              complaints: 'cough',
              diagnosis: 'viral',
              advice: null,
              completed: true,
              amended: true,
            },
            prescription: [
              {
                lineNo: 1,
                medicineName: 'Paracetamol',
                dose: '1',
                frequency: 'twice',
                duration: '3 days',
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<PatientClinicalHistory patientId="p1" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: copy.show }));
    await waitFor(() => expect(screen.getByText(/East Wing/)).toBeTruthy());
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/staff/patients/p1/clinical-history');
    expect(screen.getByText('Diagnosis: viral')).toBeTruthy();
    expect(screen.getByText('Told at reception: Cold and fever')).toBeTruthy();
    expect(screen.getByText(/Paracetamol/)).toBeTruthy();
    expect(screen.getByText(new RegExp(copy.amended))).toBeTruthy();
    // read-only: no inputs, no save buttons
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says so when the history cannot be loaded', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    render(<PatientClinicalHistory patientId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: copy.show }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.failed));
  });
});
