import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PatientRootLayout({ children }: { children: ReactNode }) {
  return <div className="viewport-fill bg-background">{children}</div>;
}
