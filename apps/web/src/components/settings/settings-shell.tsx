import type { ReactNode } from 'react';
import { SettingsHelp } from '@/components/settings/settings-help';
import { SettingsNav } from '@/components/settings/settings-nav';
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
        <SettingsNav sections={sections} activeId={activeId} />
        <div className={wide ? 'settings-content settings-content-wide' : 'settings-content'}>
          {activeId ? <SettingsHelp pageId={activeId} /> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
