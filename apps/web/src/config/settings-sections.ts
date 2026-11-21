/**
 * Settings sections: ONE list drives the section nav, the redirect from /app/settings
 * and the per-section permission check. A later step adds one entry here (plus its
 * copy and content); nothing else in the settings frame changes.
 */

export const SETTINGS_BASE_ROUTE = '/app/settings';

export type SettingsSection = {
  /** URL segment: /app/settings/<id>. */
  id: string;
  /** Key of staffCopy.settings.sections for the nav label. */
  copyKey:
    | 'patientRegistration'
    | 'patientNumbers'
    | 'doctors'
    | 'printing'
    | 'opdRules'
    | 'staff'
    | 'roles';
  route: string;
  /** Permission needed to view the section (changing needs the matching write permission). */
  permission: string;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'patient-registration',
    copyKey: 'patientRegistration',
    route: `${SETTINGS_BASE_ROUTE}/patient-registration`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'patient-numbers',
    copyKey: 'patientNumbers',
    route: `${SETTINGS_BASE_ROUTE}/patient-numbers`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'staff',
    copyKey: 'staff',
    route: `${SETTINGS_BASE_ROUTE}/staff`,
    permission: 'user.read',
  },
  {
    id: 'roles',
    copyKey: 'roles',
    route: `${SETTINGS_BASE_ROUTE}/roles`,
    permission: 'role.read',
  },
  {
    id: 'doctors',
    copyKey: 'doctors',
    route: `${SETTINGS_BASE_ROUTE}/doctors`,
    permission: 'opd.doctors.read',
  },
  {
    id: 'opd-rules',
    copyKey: 'opdRules',
    route: `${SETTINGS_BASE_ROUTE}/opd-rules`,
    permission: 'hospital.settings.read',
  },
  {
    id: 'printing',
    copyKey: 'printing',
    route: `${SETTINGS_BASE_ROUTE}/printing`,
    permission: 'hospital.settings.read',
  },
];

/** Sections the user may see, in list order. */
export function visibleSettingsSections(
  permissions: readonly string[] | undefined,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => permissions?.includes(section.permission));
}

export function findSettingsSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}
