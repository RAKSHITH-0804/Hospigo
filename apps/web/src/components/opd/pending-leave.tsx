'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';

const Count = createContext<number>(0);

/** The number of leave requests waiting for the signed-in person's decision (0 when they cannot decide). */
export const usePendingLeave = (): number => useContext(Count);

/**
 * For people who may decide leave requests (Admin, Super Admin): asks the API how many wait, now and
 * every few seconds (a light poll, like the refund requests). The number comes from the API only.
 */
export function PendingLeaveProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let stopped = false;
    async function load() {
      try {
        const response = await fetch('/api/staff/opd/leave-requests/pending-count', {
          cache: 'no-store',
        });
        if (!response.ok || stopped) {
          return;
        }
        const data = (await response.json()) as { count?: unknown };
        setCount(typeof data.count === 'number' ? data.count : 0);
      } catch {
        // a failed poll just means the number stays as it was
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), opdWebConfig.approvalsPollSeconds * 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return <Count.Provider value={enabled ? count : 0}>{children}</Count.Provider>;
}

/** A number badge that is not there at zero. */
export function PendingLeaveBadge() {
  const count = usePendingLeave();
  if (count <= 0) {
    return null;
  }
  return (
    <span className="count-badge" aria-label={fill(staffCopy.opd.approvals.leaveBadge, { count })}>
      {count}
    </span>
  );
}
