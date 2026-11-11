'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { AuthGuard } from '@/lib/auth-guard';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/mock/navigation';

function matchNavItem(items: NavItem[], pathname: string): NavItem | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const current = matchNavItem(items, pathname);

  return (
    <nav className="shell-nav">
      {items.map((item) => {
        const isCurrent = current?.href === item.href;
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn('shell-nav-link')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  title,
  items,
  branchSwitcher,
  sidebarFooter,
  children,
}: {
  title: ReactNode;
  items: NavItem[];
  branchSwitcher?: ReactNode;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();
  const pathname = usePathname() ?? '';
  const pageLabel = matchNavItem(items, pathname)?.label;

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

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <AuthGuard>
      <div className="shell-root">
        <aside className="shell-sidebar">
          <div className="shell-sidebar-title">{title}</div>
          <div className="flex min-h-0 flex-1 flex-col">
            <NavLinks items={items} pathname={pathname} />
            {sidebarFooter ? <div className="shell-sidebar-footer">{sidebarFooter}</div> : null}
          </div>
        </aside>

        {menuOpen ? (
          <div className="shell-drawer-root">
            <button
              type="button"
              aria-label="Close menu"
              className="shell-drawer-backdrop"
              onClick={closeMenu}
            />
            <aside id={panelId} className="shell-drawer-panel">
              <div className="shell-sidebar-title">{title}</div>
              <div className="flex min-h-0 flex-1 flex-col">
                <NavLinks items={items} pathname={pathname} onNavigate={closeMenu} />
                {sidebarFooter ? <div className="shell-sidebar-footer">{sidebarFooter}</div> : null}
              </div>
            </aside>
          </div>
        ) : null}

        <div className="shell-main-column">
          <header className="shell-topbar">
            <button
              type="button"
              aria-label="Open menu"
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
            <div className="shell-topbar-title">
              <span className="shell-topbar-mobile">{title}</span>
              <span className="shell-topbar-desktop">{pageLabel ?? title}</span>
            </div>
            {branchSwitcher ? <div className="shrink-0">{branchSwitcher}</div> : null}
          </header>
          <main className="shell-main">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}

export function BranchSwitcherPlaceholder() {
  return (
    <label className="shell-branch-label">
      <span className="shell-branch-caption">Branch</span>
      <select
        disabled
        aria-label="Branch switcher"
        className="shell-branch-select"
        defaultValue="main-sample"
      >
        <option value="main-sample">Main Branch (sample)</option>
      </select>
    </label>
  );
}
