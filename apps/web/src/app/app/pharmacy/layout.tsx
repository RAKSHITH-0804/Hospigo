import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { requireModule } from '@/lib/auth/module-guard';

export const metadata: Metadata = { title: staffCopy.pageTitles.pharmacy };

export default async function PharmacyLayout({ children }: { children: ReactNode }) {
  await requireModule('PHARMACY');
  return children;
}
