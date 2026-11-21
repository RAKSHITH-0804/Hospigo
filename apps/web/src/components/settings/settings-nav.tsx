'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import {
  groupSettingsSections,
  type SettingsGroup,
  type SettingsSection,
} from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';

/**
 * The settings menu: the headings (Hospital, People, Patients, OPD) are buttons. Pressing one opens
 * ITS sections and closes the others; the group of the page you are on starts open. Closed groups
 * stay in the page but hidden, so the menu is short and nothing is lost for assistive technology.
 */
export function SettingsNav({
  sections,
  activeId,
}: {
  sections: readonly SettingsSection[];
  activeId?: string;
}) {
  const baseId = useId();
  const groups = groupSettingsSections(sections);
  const activeGroup = sections.find((s) => s.id === activeId)?.group ?? groups[0]?.group ?? null;
  const [open, setOpen] = useState<SettingsGroup | null>(activeGroup);

  return (
    <nav aria-label={staffCopy.settings.navAria} className="settings-nav">
      {groups.map(({ group, sections: inGroup }) => {
        const isOpen = open === group;
        const listId = `${baseId}-${group}`;
        return (
          <div key={group} className="settings-nav-group">
            <button
              type="button"
              className="settings-nav-heading"
              aria-expanded={isOpen}
              aria-controls={listId}
              onClick={() => setOpen(isOpen ? null : group)}
            >
              <span>{staffCopy.settings.groups[group]}</span>
              <ChevronDown aria-hidden="true" data-open={isOpen} className="settings-nav-chevron" />
            </button>
            <ul id={listId} hidden={!isOpen}>
              {inGroup.map((section) => (
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
          </div>
        );
      })}
    </nav>
  );
}
