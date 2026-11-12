import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { getSession, homeForKind } from '@/lib/auth/session';

export default async function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session && !session.mustChangePassword) {
    redirect(homeForKind(session.kind));
  }
  if (session?.mustChangePassword) {
    redirect(sessionConfig.changePasswordPath);
  }
  return <div className="viewport-fill bg-background">{children}</div>;
}
