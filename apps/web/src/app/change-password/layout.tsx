import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.changePassword };

export default function ChangePasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
