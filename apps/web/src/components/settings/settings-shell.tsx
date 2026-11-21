import Link from 'next/link';
import type { ReactNode } from 'react';
import { SettingsHelp } from '@/components/settings/settings-help';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsSection } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';

/**
 * Settings frame: section list on the left (a horizontal list on narrow screens),
 * content on the right with a max width. Server component: no client JS.
 */
export function SettingsShell({
  sections,
  activeId,
  wide,
  children,
}: {
  sections: readonly SettingsSection[];
  activeId?: string;
  /** A section that needs the whole width of the screen (the print designer). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <PageHeader title={staffCopy.settings.title} description={staffCopy.settings.description} />
      <div className="settings-layout">
        <nav aria-label={staffCopy.settings.navAria} className="settings-nav">
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <Link
                  href={section.route}
                  aria-current={section.id === activeId ? 'page' : undefined}
                  className="settings-nav-link"
                >
                  {staffCopy.settings.sections[section.copyKey]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={wide ? 'settings-content settings-content-wide' : 'settings-content'}>
          {activeId ? <SettingsHelp pageId={activeId} /> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
