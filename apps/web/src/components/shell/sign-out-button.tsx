'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { staffCopy } from '@/config/staff-copy';
import { Button } from '@/components/ui/button';
import { performSignOut } from './sign-out-action';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="touch-target"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void performSignOut(router);
      }}
    >
      {pending ? staffCopy.signingOut : staffCopy.signOut}
    </Button>
  );
}
