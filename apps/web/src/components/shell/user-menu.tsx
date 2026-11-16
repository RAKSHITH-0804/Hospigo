'use client';

import { LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRoleLabel, staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';
import { performSignOut } from './sign-out-action';

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export function UserMenu({
  displayName,
  email,
  roleCodes,
  branchName,
  hospitalName,
}: {
  displayName: string;
  email: string;
  roleCodes: string[];
  branchName?: string | null;
  hospitalName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const roles = roleCodes.length ? roleCodes : [];

  useEffect(() => {
    if (!open) {
      return;
    }
    const first = menuRef.current?.querySelector<HTMLElement>('[data-menu-item]');
    first?.focus();

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
        menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [],
      );
      if (items.length === 0) {
        return;
      }
      const index = items.findIndex((el) => el === document.activeElement);
      event.preventDefault();
      if (event.key === 'ArrowDown') {
        items[(index + 1 + items.length) % items.length]?.focus();
      } else {
        items[(index - 1 + items.length) % items.length]?.focus();
      }
    }

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="shell-user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="shell-user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={staffCopy.shell.userMenuAria}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="shell-user-avatar" aria-hidden="true">
          {initialsFromName(displayName)}
        </span>
        <span className="shell-user-name type-label">{displayName}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className="shell-user-menu-panel"
          aria-label={staffCopy.shell.userMenuAria}
        >
          <div className="shell-user-menu-header">
            <span className="shell-user-avatar shell-user-avatar-lg" aria-hidden="true">
              {initialsFromName(displayName)}
            </span>
            <div className="shell-user-menu-identity">
              <span className="shell-user-menu-name">{displayName}</span>
              <Tooltip content={email} side="bottom">
                <span className="shell-user-menu-email" tabIndex={0}>
                  {email}
                </span>
              </Tooltip>
              <div className="shell-user-menu-roles" data-testid="user-menu-roles">
                {roles.map((code) => (
                  <Badge key={code} variant="neutral">
                    {formatRoleLabel(code)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <dl className="shell-user-menu-dl">
            {branchName ? (
              <div className="shell-user-menu-row">
                <dt>{staffCopy.shell.branchCaption}</dt>
                <dd title={branchName}>{branchName}</dd>
              </div>
            ) : null}
            {hospitalName ? (
              <div className="shell-user-menu-row">
                <dt>{staffCopy.shell.hospitalCaption}</dt>
                <dd title={hospitalName}>{hospitalName}</dd>
              </div>
            ) : null}
          </dl>
          <button
            type="button"
            role="menuitem"
            data-menu-item
            className={cn('shell-user-menu-item')}
            disabled={pending}
            onClick={() => {
              setPending(true);
              void performSignOut(router);
            }}
          >
            <LogOut aria-hidden="true" className="shell-menu-icon" />
            {pending ? staffCopy.signingOut : staffCopy.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
