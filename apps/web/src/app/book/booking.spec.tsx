import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BookingScreen } from '@/components/book/booking-screen';

describe('booking concept screen', () => {
  it('renders mock booking data without showing the access code', async () => {
    render(<BookingScreen code="DEMOONE" />);

    expect(screen.getAllByText('Sample data')).toHaveLength(1);
    expect(screen.getByText('Demo Hospital One')).toBeTruthy();
    expect(screen.getByText('Book an OPD appointment')).toBeTruthy();
    expect(await screen.findByText('Demo Doctor A')).toBeTruthy();
    expect(screen.getByText('Demo Doctor B')).toBeTruthy();
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Mobile')).toHaveProperty('value', '');
    expect((screen.getByRole('button', { name: 'Send OTP' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      screen.getAllByText(/Pay the fee at the hospital desk when you arrive/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/access code/i)).toBeNull();
    expect(screen.queryByText('DEMOONE')).toBeNull();
    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('enables Send OTP only after doctor, slot, name, and mobile are filled', async () => {
    render(<BookingScreen code="DEMOONE" />);
    const sendOtp = (await screen.findByRole('button', {
      name: 'Send OTP',
    })) as HTMLButtonElement;
    expect(sendOtp.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Demo Doctor A/i }));
    expect(sendOtp.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '10:30' }));
    expect(sendOtp.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sample Visitor' } });
    expect(sendOtp.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '9000000001' } });
    expect(sendOtp.disabled).toBe(false);
  });

  it('lets the visitor select a doctor and slot without changing mock source data', async () => {
    render(<BookingScreen code="DEMOONE" />);
    const doctor = await screen.findByRole('button', {
      name: /Demo Doctor A/i,
    });
    fireEvent.click(doctor);
    expect(doctor.getAttribute('aria-pressed')).toBe('true');
    const slot = screen.getByRole('button', { name: '10:30' });
    fireEvent.click(slot);
    expect(slot.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Demo Doctor B')).toBeTruthy();
  });

  it('shows loading, empty, and error with retry', async () => {
    const { rerender } = render(
      <BookingScreen code="DEMOONE" loadOptions={{ mode: 'ok', delayMs: 0 }} />,
    );
    await screen.findByText('Demo Doctor A');

    rerender(<BookingScreen code="DEMOONE" loadOptions={{ mode: 'empty', delayMs: 0 }} />);
    expect(await screen.findByText('No doctors available')).toBeTruthy();

    rerender(<BookingScreen code="DEMOONE" loadOptions={{ mode: 'error', delayMs: 0 }} />);
    expect(await screen.findByText('Booking options could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    rerender(<BookingScreen code="DEMOONE" loadOptions={{ mode: 'ok', delayMs: 20 }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading booking options');
    await waitFor(() => {
      expect(screen.getByText('Demo Doctor A')).toBeTruthy();
    });
  });
});
