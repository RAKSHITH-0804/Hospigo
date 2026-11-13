import type { ReactNode } from 'react';
import { requireModule } from '@/lib/auth/module-guard';

export default async function IpdLayout({ children }: { children: ReactNode }) {
  await requireModule('IPD');
  return children;
}
