'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
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

  return (
    <Button
      type="button"
      variant="outline"
      className="touch-target"
      disabled={pending}
      onClick={() => {
        void onSignOut();
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
