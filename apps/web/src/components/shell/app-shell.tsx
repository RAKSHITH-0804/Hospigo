'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { AuthGuard } from '@/lib/auth-guard';
import type { NavItem } from '@/mock/navigation';

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          onClick={onNavigate}
          className="flex min-h-11 items-center rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({
  title,
  items,
  branchSwitcher,
  children,
}: {
  title: string;
  items: NavItem[];
  branchSwitcher?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();

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
      <div className="flex min-h-screen overflow-x-hidden bg-background text-foreground">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
          <div className="border-b border-sidebar-border px-4 py-4 text-sm font-medium">
            {title}
          </div>
          <NavLinks items={items} />
        </aside>

        {menuOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-foreground/40"
              onClick={closeMenu}
            />
            <aside
              id={panelId}
              className="absolute inset-y-0 left-0 flex w-56 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-lg"
            >
              <div className="border-b border-sidebar-border px-4 py-4 text-sm font-medium">
                {title}
              </div>
              <NavLinks items={items} onNavigate={closeMenu} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 min-w-0 items-center gap-2 border-b border-border px-4 md:px-6">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls={panelId}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border md:hidden"
              onClick={() => setMenuOpen(true)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            {branchSwitcher ? <div className="shrink-0">{branchSwitcher}</div> : null}
          </header>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}

export function BranchSwitcherPlaceholder() {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="hidden sm:inline">Branch</span>
      <select
        disabled
        aria-label="Branch switcher"
        className="max-w-[11rem] rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
        defaultValue="placeholder"
      >
        <option value="placeholder">Placeholder</option>
      </select>
    </label>
  );
}
