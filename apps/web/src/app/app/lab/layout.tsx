import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { requireModule } from '@/lib/auth/module-guard';

export const metadata: Metadata = { title: staffCopy.pageTitles.lab };

export default async function LabLayout({ children }: { children: ReactNode }) {
  await requireModule('LAB');
  return children;
}
