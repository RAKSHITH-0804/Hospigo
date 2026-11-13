'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';

export function PatientSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    try {
      await fetch('/api/patient-auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // Cookies may still clear server-side; continue to login.
    }
    router.replace(`${sessionConfig.patientLoginPath}?notice=signed-out`);
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
      {pending ? sessionConfig.patientSigningOutLabel : sessionConfig.patientSignOutLabel}
    </Button>
  );
}
