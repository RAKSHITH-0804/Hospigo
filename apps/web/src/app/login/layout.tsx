import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { staffCopy } from '@/config/staff-copy';
import { getSession, homeForKind } from '@/lib/auth/session';

export const metadata: Metadata = { title: staffCopy.pageTitles.login };

export default async function LoginLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session && !session.mustChangePassword) {
    redirect(homeForKind(session.kind));
  }
  if (session?.mustChangePassword) {
    redirect('/change-password');
  }
  return <div className="viewport-fill bg-background">{children}</div>;
}
