'use client';

import { Button } from '@/components/ui/button';

/** The only client part of the slip: opens the browser print dialog. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" className="touch-target" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
