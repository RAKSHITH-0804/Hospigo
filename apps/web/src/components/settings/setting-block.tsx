import type { ReactNode } from 'react';

/** One compact setting: quiet heading, one-line description, then its value and form. */
export function SettingBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-block" aria-label={title}>
      <h2 className="section-heading">{title}</h2>
      {description ? <p className="type-label text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}
