export function EmptyState({
  title = 'Nothing here yet',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
