import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { visibleSettingsSections } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.pageTitles.settings };

/**
 * /app/settings has no content of its own: it sends the user to the first section
 * they may see. Without hospital.settings.read the guard gives the usual
 * no-permission redirect to the staff home.
 */
export default async function SettingsIndexPage() {
  const session = await requirePermission('hospital.settings.read');
  const first = visibleSettingsSections(session.permissions, {
    canSwitchBranch: (session.hospitalWide ?? session.canSwitchBranch) === true,
  })[0];
  if (!first) {
    redirect(`${sessionConfig.homeHospital}?notice=no-permission`);
  }
  redirect(first.route);
}
