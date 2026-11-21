import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsShell } from '@/components/settings/settings-shell';
import { PrintingSettings } from '@/components/print/printing-settings';
import { UhidStartCard } from '@/components/patients/uhid-start-card';
import { EmptyState } from '@/components/states/empty-state';
import { sessionConfig } from '@/config/session';
import { findSettingsSection, visibleSettingsSections } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import { API_UHID_START_NUMBER, fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import type { UhidStartNumberResponse } from '@/lib/patients/types';
import {
  PRINT_API_PATH,
  type PrintPresetsResponse,
  type PrintTemplatesResponse,
} from '@/lib/print/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.settings };

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  // Viewing any settings needs hospital.settings.read; without it: the usual no-permission redirect.
  const session = await requirePermission('hospital.settings.read');
  const { section: sectionId } = await params;
  const sections = visibleSettingsSections(session.permissions);
  const section = findSettingsSection(sectionId);

  if (!section) {
    return (
      <SettingsShell sections={sections}>
        <EmptyState
          title={staffCopy.settings.notFoundTitle}
          description={staffCopy.settings.notFoundDescription}
        />
      </SettingsShell>
    );
  }
  // Per-section permission (each section lists its own).
  if (!session.permissions?.includes(section.permission)) {
    redirect(`${sessionConfig.homeHospital}?notice=no-permission`);
  }

  const canWrite = session.permissions?.includes('hospital.settings.write') ?? false;
  let content: ReactNode = null;
  if (section.id === 'patient-registration') {
    const info = await fetchStaffOnServer<UhidStartNumberResponse>(API_UHID_START_NUMBER);
    content = (
      <UhidStartCard
        canWrite={canWrite}
        initialInfo={info.status === 'ok' ? info.data : null}
        initialErrorCode={info.status === 'ok' ? null : serverErrorCode(info)}
      />
    );
  }
  if (section.id === 'printing') {
    const [templates, presets] = await Promise.all([
      fetchStaffOnServer<PrintTemplatesResponse>(PRINT_API_PATH),
      fetchStaffOnServer<PrintPresetsResponse>(`${PRINT_API_PATH}/presets`),
    ]);
    if (templates.status !== 'ok') {
      content = (
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(templates))}
        </p>
      );
    } else if (presets.status !== 'ok') {
      content = (
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(presets))}
        </p>
      );
    } else {
      content = (
        <PrintingSettings
          templates={templates.data.items}
          presets={presets.data.items}
          canWrite={session.permissions?.includes('opd.settings.write') ?? false}
          hospitalName={session.hospitalName?.trim() || staffCopy.brand}
        />
      );
    }
  }
  return (
    <SettingsShell sections={sections} activeId={section.id} wide={section.id === 'printing'}>
      {content}
    </SettingsShell>
  );
}
