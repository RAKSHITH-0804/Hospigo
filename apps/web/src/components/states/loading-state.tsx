export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {label}…
    </p>
  );
}
