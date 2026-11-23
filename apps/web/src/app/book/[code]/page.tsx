import type { Metadata } from 'next';
import { BookingComingSoon } from '@/components/book/booking-coming-soon';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.booking.title };

/** The code in the address is deliberately not read or shown: booking is not open yet. */
export default function BookPage() {
  return <BookingComingSoon />;
}
