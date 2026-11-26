'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { BranchChip } from '@/components/shell/branch-chip';
import { BranchSwitcher } from '@/components/shell/branch-switcher';
import { BranchSync } from '@/components/shell/branch-sync';
import { NavIcon } from '@/components/shell/nav-icon';
import { PoweredBy } from '@/components/shell/powered-by';
import { ApprovalsBell, PendingBadge } from '@/components/opd/pending-approvals';
import { UserMenu } from '@/components/shell/user-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip } from '@/components/ui/tooltip';
import { staffCopy } from '@/config/staff-copy';
import { AuthGuard } from '@/lib/auth-guard';
import { cn } from '@/lib/utils';
import type { ShellNavItem } from '@/config/modules';

export type ShellNavGroup = {
  label: string;
  items: ShellNavItem[];
};

function matchNavItem(items: ShellNavItem[], pathname: string): ShellNavItem | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function flattenGroups(groups: ShellNavGroup[]): ShellNavItem[] {
  return groups.flatMap((g) => g.items);
}

function readCollapsedPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(staffCopy.shell.collapsedStorageKey);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(staffCopy.shell.collapsedStorageKey, collapsed ? '1' : '0');
  } catch {
    // Ignore quota / private mode.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

function NavLinks({
  groups,
  pathname,
  collapsed,
  onNavigate,
}: {
  groups: ShellNavGroup[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const flat = flattenGroups(groups);
  const current = matchNavItem(flat, pathname);

  return (
    <nav className="shell-nav" aria-label={staffCopy.brand}>
      {groups.map((group, groupIndex) => {
        if (group.items.length === 0) {
          return null;
        }
        const showLabel = Boolean(group.label);
        return (
          <div key={showLabel ? group.label : `group-${groupIndex}`} className="shell-nav-group">
            {showLabel ? (
              <p className={cn('shell-nav-group-label', collapsed && 'visually-hidden')}>
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => {
              const isCurrent = current?.href === item.href;
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={item.label}
                  className={cn('shell-nav-link', collapsed && 'shell-nav-link-icon')}
                >
                  <NavIcon name={item.icon} />
                  <span className={cn('shell-nav-label', collapsed && 'visually-hidden')}>
                    {item.label}
                  </span>
                  {item.href === '/app/opd' ? <PendingBadge /> : null}
                </Link>
              );
              if (!collapsed) {
                return <span key={`${groupIndex}-${item.href}`}>{link}</span>;
              }
              return (
                <Tooltip key={`${groupIndex}-${item.href}`} content={item.label} side="right">
                  {link}
                </Tooltip>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({
  title,
  brandLabel,
  groups,
  items,
  branchName,
  activeBranchId,
  canSwitchBranch,
  userDisplayName,
  userEmail,
  roleCodes,
  hospitalName,
  profileHref,
  canApprove = false,
  children,
}: {
  title: ReactNode;
  brandLabel?: string;
  groups?: ShellNavGroup[];
  items?: ShellNavItem[];
  branchName?: string | null;
  /** Branch this page was rendered for (stale-tab guard + focus re-check). */
  activeBranchId?: string | null;
  /** True only for hospital-wide users: shows the switcher instead of the read-only chip. */
  canSwitchBranch?: boolean;
  userDisplayName?: string;
  userEmail?: string;
  roleCodes?: string[];
  hospitalName?: string | null;
  /** Link to the doctor's own profile page (only given to people who have a doctor profile). */
  profileHref?: string | null;
  /** The person may approve refunds and cancellations: the bell and the badges are shown. */
  canApprove?: boolean;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseReady, setCollapseReady] = useState(false);
  const [modKey, setModKey] = useState<string>(staffCopy.shell.sidebarShortcutCtrl);
  const panelId = useId();
  const navId = useId();
  const pathname = usePathname() ?? '';
  const resolvedGroups: ShellNavGroup[] = groups?.length
    ? groups
    : [{ label: '', items: items ?? [] }];
  const brand = brandLabel ?? staffCopy.brand;
  const hospitalText = typeof title === 'string' ? title : '';

  useEffect(() => {
    setCollapsed(readCollapsedPreference());
    setCollapseReady(true);
    try {
      const platform = window.navigator.platform ?? '';
      setModKey(
        /Mac|iPhone|iPad|iPod/i.test(platform)
          ? staffCopy.shell.sidebarShortcutCmd
          : staffCopy.shell.sidebarShortcutCtrl,
      );
    } catch {
      setModKey(staffCopy.shell.sidebarShortcutCtrl);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (key !== 'b' || !(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setCollapsed((prev) => {
        const next = !prev;
        writeCollapsedPreference(next);
        return next;
      });
      setCollapseReady(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function closeMenu() {
    setMenuOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPreference(next);
      return next;
    });
  }

  function renderSidebar(onNavigate?: () => void, options?: { allowCollapse?: boolean }) {
    const allowCollapse = options?.allowCollapse !== false;
    const collapsedHere = allowCollapse && collapseReady && collapsed;
    const actionLabel = collapsedHere
      ? staffCopy.shell.expandSidebar
      : staffCopy.shell.collapseSidebar;
    const collapseControl = allowCollapse ? (
      <Tooltip
        side="right"
        content={
          <span className="ui-tooltip-with-kbd">
            <span>{actionLabel}</span>
            <Kbd>
              {modKey} {staffCopy.shell.sidebarShortcutKey}
            </Kbd>
          </span>
        }
      >
        <button
          type="button"
          className="shell-collapse-button"
          aria-label={actionLabel}
          aria-expanded={!collapsedHere}
          aria-controls={navId}
          onClick={toggleCollapsed}
        >
          <PanelLeft aria-hidden="true" className="shell-menu-icon" />
        </button>
      </Tooltip>
    ) : null;

    return (
      <>
        <div
          className={cn('shell-sidebar-title', collapsedHere && 'is-collapsed')}
          aria-label={[brand, hospitalText].filter(Boolean).join(', ')}
        >
          <div className="shell-sidebar-title-row">
            <div className="shell-sidebar-title-brand">
              <span className="shell-brand-mark" aria-hidden="true">
                {staffCopy.brandMark}
              </span>
              <span
                className={cn(
                  'shell-brand-wordmark',
                  'whitespace-nowrap',
                  'shrink-0',
                  collapsedHere && 'visually-hidden',
                )}
              >
                {brand}
              </span>
            </div>
            {collapseControl}
          </div>
          {title ? (
            collapsedHere ? (
              <span className="visually-hidden">{title}</span>
            ) : (
              <Tooltip
                className="shell-brand-hospital-tip"
                content={hospitalText || String(title)}
                side="bottom"
              >
                <span className="shell-brand-hospital truncate" tabIndex={0}>
                  {title}
                </span>
              </Tooltip>
            )
          ) : null}
        </div>
        <div className="shell-sidebar-body" id={navId}>
          <NavLinks
            groups={resolvedGroups}
            pathname={pathname}
            collapsed={collapsedHere}
            onNavigate={onNavigate}
          />
        </div>
        <div className="shell-sidebar-footer">
          <PoweredBy collapsed={collapsedHere} />
        </div>
      </>
    );
  }

  return (
    <AuthGuard>
      <div className="shell-root">
        {activeBranchId ? <BranchSync activeBranchId={activeBranchId} /> : null}
        <a href={`#${staffCopy.mainLandmarkId}`} className="shell-skip-link">
          {staffCopy.skipToMain}
        </a>
        <aside
          className={cn('shell-sidebar', collapseReady && collapsed && 'is-collapsed')}
          data-testid="shell-sidebar"
        >
          {renderSidebar(undefined, { allowCollapse: true })}
        </aside>

        {menuOpen ? (
          <div className="shell-drawer-root">
            <button
              type="button"
              aria-label={staffCopy.nav.closeMenu}
              className="shell-drawer-backdrop"
              onClick={closeMenu}
            />
            <aside id={panelId} className="shell-drawer-panel">
              {renderSidebar(closeMenu, { allowCollapse: false })}
            </aside>
          </div>
        ) : null}

        <div className="shell-main-column">
          <header className="shell-topbar">
            <div className="shell-topbar-left">
              <button
                type="button"
                aria-label={staffCopy.nav.openMenu}
                aria-expanded={menuOpen}
                aria-controls={panelId}
                className="shell-menu-button"
                onClick={() => setMenuOpen(true)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="shell-menu-icon"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              {branchName ? (
                canSwitchBranch && activeBranchId ? (
                  <BranchSwitcher activeBranchName={branchName} />
                ) : (
                  <BranchChip name={branchName} />
                )
              ) : null}
            </div>
            <div className="shell-topbar-right">
              <ApprovalsBell enabled={canApprove} />
              {userDisplayName && userEmail ? (
                <UserMenu
                  displayName={userDisplayName}
                  email={userEmail}
                  roleCodes={roleCodes ?? []}
                  branchName={branchName}
                  hospitalName={hospitalName}
                  profileHref={profileHref}
                />
              ) : null}
            </div>
          </header>
          <main id={staffCopy.mainLandmarkId} className="shell-main">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

/** @deprecated Prefer BranchChip in the top bar. */
export function ActiveBranchLabel({ name }: { name: string }) {
  return <BranchChip name={name} />;
}

/** @deprecated Prefer BranchChip. */
export function BranchSwitcherPlaceholder() {
  return <BranchChip name="—" />;
}
