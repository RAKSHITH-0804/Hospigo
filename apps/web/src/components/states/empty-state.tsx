import type { ReactNode } from 'react';

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div>
        <p className="type-label-strong">{title}</p>
        {description ? <p className="type-label">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
