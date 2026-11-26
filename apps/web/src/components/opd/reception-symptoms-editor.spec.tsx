import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReceptionSymptomsEditor } from '@/components/opd/reception-symptoms-editor';
import { staffCopy } from '@/config/staff-copy';

const saveMock = jest.fn();
jest.mock('@/lib/opd/client', () => ({
  saveReceptionSymptoms: (...args: unknown[]) => saveMock(...args),
}));

const copy = staffCopy.opd.symptoms;

beforeEach(() => saveMock.mockReset());

describe('ReceptionSymptomsEditor', () => {
  it('shows what was typed at billing and saves a change', async () => {
    saveMock.mockResolvedValue({ ok: true, data: { receptionSymptoms: 'Headache' } });
    render(<ReceptionSymptomsEditor visitId="v1" initial="Cold cough" />);
    const box = screen.getByLabelText(copy.label) as HTMLTextAreaElement;
    expect(box.value).toBe('Cold cough');
    fireEvent.change(box, { target: { value: 'Headache' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.saved));
    expect(saveMock).toHaveBeenCalledWith('v1', 'Headache');
  });

  it('says plainly when the doctor has already started', async () => {
    saveMock.mockResolvedValue({ ok: false, code: 'CONSULTATION_STARTED', status: 409 });
    render(<ReceptionSymptomsEditor visitId="v1" initial={null} />);
    fireEvent.change(screen.getByLabelText(copy.label), { target: { value: 'Fever' } });
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy.started));
  });

  it('limits the text to the length the API accepts', () => {
    render(<ReceptionSymptomsEditor visitId="v1" initial={null} />);
    expect(screen.getByLabelText(copy.label).getAttribute('maxlength')).toBe(
      String(copy.maxLength),
    );
  });
});
