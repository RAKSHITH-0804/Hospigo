import type { Metadata } from 'next';
import SettingsSectionPage from '@/app/app/settings/[section]/page';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.administration.title };

/** Administration: Staff, Roles and Doctors. The same screens as before, under their own menu. */
export default function AdministrationSectionPage(props: {
  params: Promise<{ section: string }>;
  searchParams?: Promise<{ q?: string; kind?: string; page?: string }>;
}) {
  return SettingsSectionPage({ ...props, area: 'administration' });
}
