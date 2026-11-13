import type { ReactNode } from 'react';
import { requireModule } from '@/lib/auth/module-guard';

export default async function PharmacyLayout({ children }: { children: ReactNode }) {
  await requireModule('PHARMACY');
  return children;
}
