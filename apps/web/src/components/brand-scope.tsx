import type { CSSProperties, ReactNode } from 'react';

/** Applies a hospital brand colour through CSS variables for staff and booking shells. */
export function BrandScope({ brandColor, children }: { brandColor: string; children: ReactNode }) {
  const style = {
    '--brand': brandColor,
    '--primary': brandColor,
    '--sidebar-primary': brandColor,
    '--ring': brandColor,
  } as CSSProperties;

  return (
    <div className="viewport-fill" style={style}>
      {children}
    </div>
  );
}
