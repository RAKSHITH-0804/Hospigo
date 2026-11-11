'use client';

import type { ReactNode } from 'react';

/**
 * Route guard stub. Step 6 connects this to real auth.
 * Until then every route is allowed.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  return children;
}
