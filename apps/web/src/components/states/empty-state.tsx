export function EmptyState({
  title = 'Nothing here yet',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div>
      <p className="type-label font-medium">{title}</p>
      {description ? <p className="type-label text-muted-foreground">{description}</p> : null}
    </div>
  );
}
