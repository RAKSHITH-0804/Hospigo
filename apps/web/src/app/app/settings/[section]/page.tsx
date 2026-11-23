import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsShell } from '@/components/settings/settings-shell';
import { PrintingSettings } from '@/components/print/printing-settings';
import { UhidStartCard } from '@/components/patients/uhid-start-card';
import { DoctorsList } from '@/components/settings/doctors-list';
import { OpdRulesForm } from '@/components/settings/opd-rules-form';
import { PricesScreen } from '@/components/settings/prices-screen';
import { ImportsScreen } from '@/components/settings/imports-screen';
import { RegistrationFields } from '@/components/settings/registration-fields';
import { UhidFormatCard } from '@/components/settings/uhid-format-card';
import { LogoCard } from '@/components/images/logo-card';
import { CodeFormatCard } from '@/components/staff/code-format-card';
import { RolesManager } from '@/components/staff/roles-manager';
import { StaffAdmin } from '@/components/staff/staff-admin';
import { EmptyState } from '@/components/states/empty-state';
import { importScreenConfig } from '@/config/imports';
import { sessionConfig } from '@/config/session';
import { findSettingsSection, visibleSettingsSections } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import { API_UHID_START_NUMBER, fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import type { UhidStartNumberResponse } from '@/lib/patients/types';
import { API_DOCTOR_PROFILES, type DoctorsListResponse } from '@/lib/doctors/types';
import { API_BRANDING, type BrandingResponse } from '@/lib/images/types';
import { API_IMPORTS, type ImportListResponse } from '@/lib/imports/types';
import { API_PRICES, PRICE_KINDS, type PriceKind, type PricesResponse } from '@/lib/prices/types';
import { API_OPD_RULES, API_PATIENT_FIELDS, API_UHID_FORMAT } from '@/lib/settings/paths';
import {
  API_ROLES,
  API_ROLES_CATALOG,
  API_ROLES_TEMPLATES,
  API_STAFF,
  API_STAFF_OPTIONS,
  type PermissionCatalog,
  type RolesListResponse,
  type RoleTemplates,
  type StaffCodeFormat,
  type StaffListResponse,
  type StaffOptions,
} from '@/lib/staff/types';
import type { OpdRules, PatientFieldsResponse, UhidFormatResponse } from '@/lib/settings/types';
import { fetchLogoImageId } from '@/lib/print/server';
import {
  PRINT_API_PATH,
  type PrintPresetsResponse,
  type PrintTemplatesResponse,
} from '@/lib/print/types';

/** Sections that use the whole width of the screen (two blocks side by side). */
const WIDE_SECTIONS = [
  'printing',
  'patient-registration',
  'patient-numbers',
  'doctors',
  'staff',
  'roles',
  'prices',
  'upload-lists',
];

export const metadata: Metadata = { title: staffCopy.pageTitles.settings };

export default async function SettingsSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams?: Promise<{ q?: string; kind?: string }>;
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
    const fields = await fetchStaffOnServer<PatientFieldsResponse>(API_PATIENT_FIELDS);
    content = (
      <RegistrationFields
        canWrite={canWrite}
        initial={fields.status === 'ok' ? fields.data : null}
        initialErrorCode={fields.status === 'ok' ? null : serverErrorCode(fields)}
      />
    );
  }
  if (section.id === 'patient-numbers') {
    const [info, format] = await Promise.all([
      fetchStaffOnServer<UhidStartNumberResponse>(API_UHID_START_NUMBER),
      fetchStaffOnServer<UhidFormatResponse>(API_UHID_FORMAT),
    ]);
    content = (
      <div className="settings-columns">
        <UhidFormatCard
          canWrite={canWrite}
          initial={format.status === 'ok' ? format.data : null}
          initialErrorCode={format.status === 'ok' ? null : serverErrorCode(format)}
        />
        <UhidStartCard
          canWrite={canWrite}
          initialInfo={info.status === 'ok' ? info.data : null}
          initialErrorCode={info.status === 'ok' ? null : serverErrorCode(info)}
        />
      </div>
    );
  }
  if (section.id === 'branding') {
    const branding = await fetchStaffOnServer<BrandingResponse>(API_BRANDING);
    content = (
      <LogoCard
        initial={branding.status === 'ok' ? branding.data : null}
        initialErrorCode={branding.status === 'ok' ? null : serverErrorCode(branding)}
      />
    );
  }
  if (section.id === 'staff') {
    const [list, options] = await Promise.all([
      fetchStaffOnServer<StaffListResponse>(API_STAFF),
      fetchStaffOnServer<StaffOptions>(API_STAFF_OPTIONS),
    ]);
    const firstError = list.status !== 'ok' ? list : options.status !== 'ok' ? options : null;
    const format = options.status === 'ok' ? options.data.codeFormat : null;
    content = (
      <div className="section-stack">
        <CodeFormatCard
          initial={format as StaffCodeFormat | null}
          initialErrorCode={null}
          canWrite={session.permissions?.includes('hospital.settings.write') ?? false}
        />
        <StaffAdmin
          initial={list.status === 'ok' ? list.data : null}
          options={options.status === 'ok' ? options.data : null}
          initialErrorCode={firstError ? serverErrorCode(firstError) : null}
        />
      </div>
    );
  }
  if (section.id === 'roles') {
    const [list, catalog, templates] = await Promise.all([
      fetchStaffOnServer<RolesListResponse>(API_ROLES),
      fetchStaffOnServer<PermissionCatalog>(API_ROLES_CATALOG),
      fetchStaffOnServer<RoleTemplates>(API_ROLES_TEMPLATES),
    ]);
    const firstError = list.status !== 'ok' ? list : catalog.status !== 'ok' ? catalog : null;
    content = (
      <RolesManager
        initial={list.status === 'ok' ? list.data : null}
        catalog={catalog.status === 'ok' ? catalog.data.items : null}
        templates={templates.status === 'ok' ? templates.data.items : []}
        initialErrorCode={firstError ? serverErrorCode(firstError) : null}
      />
    );
  }
  if (section.id === 'doctors') {
    const doctors = await fetchStaffOnServer<DoctorsListResponse>(API_DOCTOR_PROFILES);
    content = (
      <DoctorsList
        initial={doctors.status === 'ok' ? doctors.data : null}
        initialErrorCode={doctors.status === 'ok' ? null : serverErrorCode(doctors)}
      />
    );
  }
  if (section.id === 'opd-rules') {
    const rules = await fetchStaffOnServer<OpdRules>(API_OPD_RULES);
    content =
      rules.status === 'ok' ? (
        <OpdRulesForm
          initial={rules.data}
          canWrite={session.permissions?.includes('opd.settings.write') ?? false}
        />
      ) : (
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(rules))}
        </p>
      );
  }
  if (section.id === 'prices') {
    // The Fees link of a doctor opens this list already searched (code) and filtered (doctor fees).
    const wanted = (await searchParams) ?? {};
    const startKind = (PRICE_KINDS as readonly string[]).includes(wanted.kind ?? '')
      ? (wanted.kind as PriceKind)
      : '';
    const startQ = (wanted.q ?? '').trim().slice(0, 64);
    const startQuery = new URLSearchParams();
    if (startKind) startQuery.set('kind', startKind);
    if (startQ) startQuery.set('q', startQ);
    const startText = startQuery.toString();
    const prices = await fetchStaffOnServer<PricesResponse>(
      startText ? `${API_PRICES}?${startText}` : API_PRICES,
    );
    content = (
      <PricesScreen
        startQuery={{ q: startQ, kind: startKind }}
        initial={prices.status === 'ok' ? prices.data : null}
        initialErrorCode={prices.status === 'ok' ? null : serverErrorCode(prices)}
      />
    );
  }
  if (section.id === 'upload-lists') {
    const batches = await fetchStaffOnServer<ImportListResponse>(API_IMPORTS, {
      page: 1,
      pageSize: importScreenConfig.historyPageSize,
    });
    content = (
      <ImportsScreen
        initial={batches.status === 'ok' ? batches.data : null}
        initialErrorCode={batches.status === 'ok' ? null : serverErrorCode(batches)}
        allowPrices={session.permissions?.includes('opd.prices.write') ?? false}
      />
    );
  }
  if (section.id === 'printing') {
    const [templates, presets, logoImageId] = await Promise.all([
      fetchStaffOnServer<PrintTemplatesResponse>(PRINT_API_PATH),
      fetchStaffOnServer<PrintPresetsResponse>(`${PRINT_API_PATH}/presets`),
      fetchLogoImageId(),
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
          logoImageId={logoImageId}
        />
      );
    }
  }
  return (
    <SettingsShell
      sections={sections}
      activeId={section.id}
      wide={WIDE_SECTIONS.includes(section.id)}
    >
      {content}
    </SettingsShell>
  );
}
