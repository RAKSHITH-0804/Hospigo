import { render, screen } from '@testing-library/react';
import { BookingComingSoon } from '@/components/book/booking-coming-soon';
import BookPage from '@/app/book/[code]/page';
import { staffCopy } from '@/config/staff-copy';

describe('public booking page (coming soon)', () => {
  it('says booking is coming soon, from the copy file', () => {
    render(<BookingComingSoon />);
    expect(screen.getByRole('heading', { name: staffCopy.booking.heading })).toBeTruthy();
    expect(screen.getByText(staffCopy.booking.body)).toBeTruthy();
  });

  it('shows no sample data, no hospital name, no access code, no doctors or slots', () => {
    render(<BookPage />);
    const text = document.body.textContent ?? '';
    expect(screen.queryByText(staffCopy.sampleData)).toBeNull();
    expect(text).not.toMatch(/Demo Hospital|Demo Doctor|DEMOONE|access code/i);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
