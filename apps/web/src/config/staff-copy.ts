/**
 * Typed defaults for staff (/app, /admin) UI copy.
 * Pages read from here; components take labels as props.
 */

export const staffCopy = {
  brand: 'Hospigo',
  brandMark: 'H',
  hqTitle: 'HQ',
  sampleData: 'Sample data',
  comingLater: 'Coming later.',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  poweredByIndigo: 'Powered by Indigo',
  skipToMain: 'Skip to main content',
  mainLandmarkId: 'main-content',
  shell: {
    collapsedStorageKey: 'hospigo.sidebar.collapsed',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    sidebarShortcutCtrl: 'Ctrl',
    sidebarShortcutCmd: 'Cmd',
    sidebarShortcutKey: 'B',
    branchChipAria: 'Active branch',
    patientSearchLabel: 'Search patients',
    patientSearchPlaceholder: 'Search patients',
    patientSearchShortcut: '/',
    userMenuAria: 'Account menu',
    hospitalCaption: 'Hospital',
    branchCaption: 'Branch',
    roleCaption: 'Role',
  },
  pageTitles: {
    login: 'Sign in',
    forgotPassword: 'Forgot password',
    resetPassword: 'Reset password',
    activate: 'Activate account',
    changePassword: 'Change password',
    patientLogin: 'Patient sign in',
    patientHome: 'Patient home',
    dashboard: 'Dashboard',
    patients: 'Patients',
    opd: 'OPD queue',
    ipd: 'IPD wards',
    lab: 'Lab and radiology',
    pharmacy: 'Pharmacy',
    billing: 'Billing',
    settings: 'Settings',
    admin: 'Hospitals',
    adminModules: 'Modules and plans',
    adminImports: 'Master data imports',
    adminStaff: 'Staff and support',
    adminHealth: 'Platform health',
  },
  nav: {
    patients: 'Patients',
    patientsDescription: 'Search and register patients',
    settings: 'Settings',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    branchCaption: 'Branch',
    roleCaption: 'Role',
  },
  patients: {
    title: 'Patients',
    description: 'Search and register patients for this hospital.',
    emptyTitle: 'Search arrives next',
    emptyDescription: 'Patient search and registration arrive in the next step',
  },
  settings: {
    title: 'Settings',
    description: 'Hospital settings for this branch.',
    emptyTitle: 'Settings arrive next',
    emptyDescription: 'Hospital settings (including the next UHID number) arrive in the next step',
  },
  roleLabels: {
    SUPER_ADMIN: 'Super admin',
    BRANCH_ADMIN: 'Branch admin',
    RECEPTIONIST: 'Receptionist',
    NURSE: 'Nurse',
    DOCTOR: 'Doctor',
    HQ_ADMIN: 'HQ admin',
  },
  pagination: {
    previous: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {totalPages}',
    total: '{total} total',
  },
  table: {
    defaultCaption: 'Data table',
  },
  field: {
    requiredMark: '*',
  },
} as const;

export type StaffCopy = typeof staffCopy;

/** Map a role code to human wording; unknown codes are title-cased. */
export function formatRoleLabel(code: string): string {
  const mapped = (staffCopy.roleLabels as Record<string, string>)[code];
  if (mapped) {
    return mapped;
  }
  return code
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/** Join several role codes with a comma using readable labels. */
export function formatRoleLabels(codes: string[]): string {
  if (!codes.length) {
    return '—';
  }
  return codes.map(formatRoleLabel).join(', ');
}
