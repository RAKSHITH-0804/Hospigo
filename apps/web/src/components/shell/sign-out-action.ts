'use client';

import { sessionConfig } from '@/config/session';

type SignOutRouter = {
  replace: (href: string) => void;
  refresh: () => void;
};

/** Shared staff/HQ sign-out used by the standalone button and the user menu. */
export async function performSignOut(router: SignOutRouter): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    // Cookies may still clear server-side; continue to login.
  }
  router.replace(sessionConfig.loginPath);
  router.refresh();
}
