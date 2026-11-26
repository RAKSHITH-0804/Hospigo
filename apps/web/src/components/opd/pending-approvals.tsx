'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';

const copy = staffCopy.opd.approvals;
const TOAST_MS = 8000;

const Count = createContext<number>(0);

/** The number of requests waiting for the signed-in person's decision (0 when they cannot decide). */
export const usePendingApprovals = (): number => useContext(Count);

/**
 * For people who may approve refunds and cancellations: asks the API how many requests wait (only in
 * the branches where they may approve) now and every few seconds, and shows a short message when a
 * new one arrives. There is no push channel for staff yet, so this is a light poll; the number comes
 * from the API only. Nobody else ever asks (the route needs the approve permission).
 */
export function PendingApprovalsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let stopped = false;
    // (the timer is created below)
    async function load() {
      try {
        const response = await fetch('/api/staff/opd/refund-requests/pending-count', {
          cache: 'no-store',
        });
        if (!response.ok || stopped) {
          return;
        }
        const data = (await response.json()) as { count?: unknown };
        const next = typeof data.count === 'number' ? data.count : 0;
        if (last.current !== null && next > last.current) {
          setToast(true);
          window.setTimeout(() => setToast(false), TOAST_MS);
        }
        last.current = next;
        setCount(next);
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

  return (
    <Count.Provider value={enabled ? count : 0}>
      {children}
      {toast ? (
        <p role="status" className="approvals-toast type-label">
          {copy.toast}
        </p>
      ) : null}
    </Count.Provider>
  );
}

/** A number badge that is not there at zero (the label says what it counts). */
export function PendingBadge() {
  const count = usePendingApprovals();
  if (count <= 0) {
    return null;
  }
  return (
    <span className="count-badge" aria-label={fill(copy.badge, { count })}>
      {count}
    </span>
  );
}

/** The bell in the top bar: a link to the requests, with the number. Only for people who can decide. */
export function ApprovalsBell({ enabled }: { enabled: boolean }) {
  const count = usePendingApprovals();
  if (!enabled) {
    return null;
  }
  return (
    <Link
      href="/app/opd/refunds"
      className="approvals-bell"
      aria-label={count > 0 ? fill(copy.badge, { count }) : copy.bellNone}
      title={copy.bell}
    >
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {count > 0 ? <span className="count-badge">{count}</span> : null}
    </Link>
  );
}
