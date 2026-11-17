'use client';

import { useEffect } from 'react';
import { branchSwitchConfig } from '@/config/branch-switch';
import { fetchCookieBranchId, setClientActiveBranch } from '@/lib/auth/client-session';
import { reloadPage } from '@/lib/auth/navigate';

/**
 * Renders nothing. Keeps this tab honest about its branch:
 * 1. remembers the branch this page was rendered for (sent as the guard header on writes);
 * 2. when the tab regains focus, asks which branch the shared cookie holds and reloads if
 *    another tab has switched (tabs share one cookie, so a switch changes it for all of them).
 */
export function BranchSync({ activeBranchId }: { activeBranchId: string }) {
  // Idempotent, and done during render so it is set before any child event handler can run.
  setClientActiveBranch(activeBranchId);

  useEffect(() => {
    let checking = false;
    let lastCheckAt = 0;

    async function recheck() {
      if (document.visibilityState === 'hidden' || checking) {
        return;
      }
      const now = Date.now();
      if (now - lastCheckAt < branchSwitchConfig.recheckMinIntervalMs) {
        return;
      }
      lastCheckAt = now;
      checking = true;
      try {
        const current = await fetchCookieBranchId();
        // null = unknown (expired cookie, offline): never reload on that.
        if (current && current !== activeBranchId) {
          reloadPage();
        }
      } finally {
        checking = false;
      }
    }

    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [activeBranchId]);

  return null;
}
