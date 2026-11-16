import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.activate };

export default function ActivateLayout({ children }: { children: ReactNode }) {
  return children;
}
