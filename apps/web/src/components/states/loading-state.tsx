export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="type-label text-muted-foreground">
      {label}…
    </p>
  );
}
