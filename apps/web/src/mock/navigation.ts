/**
 * LABEL: mock navigation. Remove this folder when menus come from the API.
 * Sidebar items only. No live data.
 */

export type NavItem = {
  href: string;
  label: string;
};

export const hqNavItems: NavItem[] = [
  { href: '/admin', label: 'Hospitals' },
  { href: '/admin', label: 'Branches' },
  { href: '/admin', label: 'Modules' },
];

export const staffNavItems: NavItem[] = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app', label: 'Patients' },
];
