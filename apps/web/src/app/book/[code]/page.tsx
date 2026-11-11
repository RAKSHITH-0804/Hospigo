'use client';

import { useParams } from 'next/navigation';

export default function BookPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === 'string' ? params.code : '';

  return (
    <section className="max-w-lg">
      <h1 className="text-xl font-medium">Book an appointment</h1>
      <p className="mt-2 text-sm text-muted-foreground">Access code: {code}</p>
    </section>
  );
}
