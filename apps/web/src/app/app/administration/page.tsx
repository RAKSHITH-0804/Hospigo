import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { visibleSettingsSections } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.administration.title };

/** /app/administration has no content of its own: it opens the first section the person may see. */
export default async function AdministrationIndexPage() {
  const session = await requireKind('HOSPITAL');
  const first = visibleSettingsSections(session.permissions, {
    canSwitchBranch: (session.hospitalWide ?? session.canSwitchBranch) === true,
    area: 'administration',
  })[0];
  if (!first) {
    redirect(`${sessionConfig.homeHospital}?notice=no-permission`);
  }
  redirect(first.route);
}
