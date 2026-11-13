import type { ReactNode } from 'react';
import { requireModule } from '@/lib/auth/module-guard';

export default async function LabLayout({ children }: { children: ReactNode }) {
  await requireModule('LAB');
  return children;
}
