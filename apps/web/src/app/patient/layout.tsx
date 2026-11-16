import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = {
  title: staffCopy.pageTitles.patientHome,
  robots: { index: false, follow: false },
};

export default function PatientRootLayout({ children }: { children: ReactNode }) {
  return <div className="viewport-fill bg-background">{children}</div>;
}
