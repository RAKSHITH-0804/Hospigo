'use client';

import { Check, ChevronDown, MapPin } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { SkeletonBlock } from '@/components/states/skeletons';
import { staffCopy } from '@/config/staff-copy';
import {
  branchErrorMessageFor,
  fetchSwitchableBranches,
  switchBranchOnce,
  type SwitchableBranch,
} from '@/lib/auth/client-session';
import { reloadPage } from '@/lib/auth/navigate';
import { cn } from '@/lib/utils';

type ListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; branches: SwitchableBranch[] }
  | { status: 'error'; message: string };

/**
 * Top-bar branch control for hospital-wide users only (the shell renders the read-only
 * BranchChip for everyone else). The list and the switch go through Next route handlers;
 * no token is ever visible here. After a successful switch the page reloads so every
 * server-fetched screen, the sidebar and the permissions are rebuilt for the new branch.
 */
export function BranchSwitcher({ activeBranchName }: { activeBranchName: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: 'idle' });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const busy = switchingId !== null;

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setList({ status: 'loading' });
    setError(null);
    void fetchSwitchableBranches().then((result) => {
      if (cancelled) {
        return;
      }
      setList(
        result.ok
          ? { status: 'ready', branches: result.branches }
          : { status: 'error', message: branchErrorMessageFor(result.code) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not([disabled])') ?? [],
      );
      if (items.length === 0) {
        return;
      }
      const index = items.findIndex((el) => el === document.activeElement);
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  async function choose(branch: SwitchableBranch) {
    if (busy || branch.isCurrent) {
      return;
    }
    setError(null);
    setSwitchingId(branch.id);
    const result = await switchBranchOnce(branch.id);
    if (result.ok) {
      // Stay in the "switching" state: the reload replaces this screen.
      reloadPage();
      return;
    }
    setSwitchingId(null);
    setError(branchErrorMessageFor(result.code));
  }

  return (
    <div className="shell-branch-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="shell-branch-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={staffCopy.shell.branchSwitcherAria}
        aria-busy={busy}
        title={activeBranchName}
        onClick={() => setOpen((value) => !value)}
      >
        <MapPin aria-hidden="true" className="shell-branch-chip-icon" />
        <span className="shell-branch-chip-text">{activeBranchName}</span>
        <ChevronDown aria-hidden="true" className="shell-branch-chip-icon" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="shell-branch-switcher-panel"
          aria-label={staffCopy.shell.branchSwitcherListAria}
        >
          {list.status === 'loading' || list.status === 'idle' ? (
            <div
              role="status"
              aria-busy="true"
              aria-label={staffCopy.shell.branchSwitcherLoading}
              className="shell-branch-switcher-skeleton"
            >
              <SkeletonBlock className="skeleton-control" />
              <SkeletonBlock className="skeleton-control" />
            </div>
          ) : null}
          {list.status === 'error' ? (
            <p role="alert" className="shell-branch-switcher-message">
              {list.message}
            </p>
          ) : null}
          {list.status === 'ready' && list.branches.length === 0 ? (
            <p className="shell-branch-switcher-message">{staffCopy.shell.branchSwitcherEmpty}</p>
          ) : null}
          {list.status === 'ready'
            ? list.branches.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={branch.isCurrent}
                  data-menu-item
                  className={cn(
                    'shell-branch-switcher-item',
                    branch.isCurrent && 'is-current',
                    switchingId === branch.id && 'is-switching',
                  )}
                  disabled={busy || branch.isCurrent}
                  title={branch.isCurrent ? staffCopy.shell.branchSwitcherCurrent : branch.name}
                  onClick={() => void choose(branch)}
                >
                  <span className="shell-branch-switcher-item-name">{branch.name}</span>
                  {branch.isCurrent ? (
                    <Check aria-hidden="true" className="shell-branch-chip-icon" />
                  ) : null}
                </button>
              ))
            : null}
          {busy ? (
            <p role="status" className="shell-branch-switcher-message">
              {staffCopy.shell.branchSwitcherSwitching}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="shell-branch-switcher-message is-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
