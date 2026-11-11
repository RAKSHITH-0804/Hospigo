import { SampleDataBadge } from '@/components/sample-data-badge';

export function ComingLater({ title }: { title: string }) {
  return (
    <div className="section-stack max-w-[var(--size-form-card-max)]">
      <SampleDataBadge />
      <h1 className="type-heading font-medium">{title}</h1>
      <p className="type-label text-muted-foreground">Coming later.</p>
    </div>
  );
}
