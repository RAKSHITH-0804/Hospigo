/**
 * Settings sections: ONE list drives the section nav, the redirect from /app/settings
 * and the per-section permission check. A later step adds one entry here (plus its
 * copy and content); nothing else in the settings frame changes.
 *
 * Sections are shown under group headings (Hospital, People, Patients, OPD). A new area
 * of settings goes into the group it belongs to; a whole new group is one entry in
 * SETTINGS_GROUPS plus its heading in the copy file.
 */

export const SETTINGS_BASE_ROUTE = '/app/settings';
/** Staff, Roles and Doctors are management, not configuration: they live in Administration (Phase 2.3). */
export const ADMINISTRATION_BASE_ROUTE = '/app/administration';

export type SettingsArea = 'settings' | 'administration';

/** The headings of the settings menu, in the order they are shown. */
export const SETTINGS_GROUPS = ['hospital', 'people', 'patients', 'opd', 'billing'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export type SettingsSection = {
  /** URL segment: /app/settings/<id>. */
  id: string;
  /** The heading it is listed under. */
  group: SettingsGroup;
  /** Key of staffCopy.settings.sections for the nav label. */
  copyKey:
    | 'patientRegistration'
    | 'patientNumbers'
    | 'doctors'
    | 'printing'
    | 'printValues'
    | 'printLibrary'
    | 'opdRules'
    | 'staff'
    | 'roles'
    | 'branding'
    | 'prices'
    | 'uploadLists'
    | 'paymentModes'
    | 'vitalsFields'
    | 'billNumbers';
  route: string;
  /** Where it lives: Settings (configuration, the default) or Administration (people). */
  area?: 'administration';
  /** Permission needed to view the section (changing needs the matching write permission). */
  permission: string;
  /**
   * When true, only hospital-wide Admins (session.canSwitchBranch) see the item. Branch Admins
   * share the permission code but the API refuses them; hiding avoids a dead 403 link.
   */
  hospitalWideOnly?: boolean;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // Hospital
  {
    id: 'branding',
    group: 'hospital',
    copyKey: 'branding',
    route: `${SETTINGS_BASE_ROUTE}/branding`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'printing',
    group: 'hospital',
    copyKey: 'printing',
    route: `${SETTINGS_BASE_ROUTE}/printing`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'print-values',
    group: 'hospital',
    copyKey: 'printValues',
    route: `${SETTINGS_BASE_ROUTE}/print-values`,
    permission: 'opd.settings.write',
  },
  {
    id: 'print-library',
    group: 'hospital',
    copyKey: 'printLibrary',
    route: `${SETTINGS_BASE_ROUTE}/print-library`,
    permission: 'print.templates.choose',
  },
  // People
  {
    id: 'staff',
    group: 'people',
    copyKey: 'staff',
    route: `${ADMINISTRATION_BASE_ROUTE}/staff`,
    area: 'administration',
    permission: 'user.read',
  },
  {
    id: 'roles',
    group: 'people',
    copyKey: 'roles',
    route: `${ADMINISTRATION_BASE_ROUTE}/roles`,
    area: 'administration',
    permission: 'role.read',
  },
  {
    id: 'doctors',
    group: 'people',
    copyKey: 'doctors',
    route: `${ADMINISTRATION_BASE_ROUTE}/doctors`,
    area: 'administration',
    permission: 'opd.doctors.read',
  },
  // Patients
  {
    id: 'patient-registration',
    group: 'patients',
    copyKey: 'patientRegistration',
    route: `${SETTINGS_BASE_ROUTE}/patient-registration`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'patient-numbers',
    group: 'patients',
    copyKey: 'patientNumbers',
    route: `${SETTINGS_BASE_ROUTE}/patient-numbers`,
    permission: 'hospital.settings.read',
  },
  // OPD
  {
    id: 'opd-rules',
    group: 'opd',
    copyKey: 'opdRules',
    route: `${SETTINGS_BASE_ROUTE}/opd-rules`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'vitals-fields',
    group: 'opd',
    copyKey: 'vitalsFields',
    route: `${SETTINGS_BASE_ROUTE}/vitals-fields`,
    permission: 'opd.masters.write',
  },
  {
    id: 'prices',
    group: 'billing',
    copyKey: 'prices',
    route: `${SETTINGS_BASE_ROUTE}/prices`,
    // Prices are shown and changed by Admin and SuperAdmin only.
    permission: 'opd.prices.write',
  },
  {
    id: 'payment-modes',
    group: 'billing',
    copyKey: 'paymentModes',
    route: `${SETTINGS_BASE_ROUTE}/payment-modes`,
    permission: 'opd.masters.write',
  },
  {
    id: 'bill-numbers',
    group: 'billing',
    copyKey: 'billNumbers',
    route: `${SETTINGS_BASE_ROUTE}/bill-numbers`,
    // Money numbering is hospital-wide only; Branch Admins get 403 from the API.
    permission: 'opd.settings.write',
    hospitalWideOnly: true,
  },
  {
    id: 'upload-lists',
    group: 'opd',
    copyKey: 'uploadLists',
    route: `${SETTINGS_BASE_ROUTE}/upload-lists`,
    // The price lists inside also need opd.prices.write (the API checks it for each list).
    permission: 'opd.masters.write',
  },
];

/** Sections the user may see, in list order. */
export function visibleSettingsSections(
  permissions: readonly string[] | undefined,
  opts?: { canSwitchBranch?: boolean; area?: SettingsArea },
): SettingsSection[] {
  const hospitalWide = opts?.canSwitchBranch === true;
  const area = opts?.area ?? 'settings';
  return SETTINGS_SECTIONS.filter((section) => {
    if ((section.area ?? 'settings') !== area) {
      return false;
    }
    if (!permissions?.includes(section.permission)) {
      return false;
    }
    if (section.hospitalWideOnly && !hospitalWide) {
      return false;
    }
    return true;
  });
}

/** The sections under their headings (a heading with nothing to show is left out). */
export function groupSettingsSections(
  sections: readonly SettingsSection[],
): Array<{ group: SettingsGroup; sections: SettingsSection[] }> {
  return SETTINGS_GROUPS.map((group) => ({
    group,
    sections: sections.filter((section) => section.group === group),
  })).filter((entry) => entry.sections.length > 0);
}

export function findSettingsSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}
