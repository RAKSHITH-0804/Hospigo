'use client';

import { useParams } from 'next/navigation';
import { BookingScreen } from '@/components/book/booking-screen';

export default function BookPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === 'string' ? params.code : 'DEMOONE';

  return <BookingScreen code={code} />;
}
