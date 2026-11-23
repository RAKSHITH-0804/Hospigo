import { staffCopy } from '@/config/staff-copy';

/**
 * The public booking page is not open yet. It says so and shows nothing else: no hospital name,
 * no access code, no sample doctors or slots.
 */
export function BookingComingSoon() {
  const copy = staffCopy.booking;
  return (
    <section className="section-stack content-container-inner max-w-[var(--size-form-card-max)]">
      <h1 className="type-heading font-medium">{copy.heading}</h1>
      <p className="type-label text-muted-foreground">{copy.body}</p>
    </section>
  );
}
