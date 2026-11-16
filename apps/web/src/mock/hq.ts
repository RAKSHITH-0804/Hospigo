/**
 * LABEL: mock Indigo HQ nav and dashboard stats for Step 5b.
 */

import type { ShellNavItem } from '@/config/modules';

export const hqConceptNavItems: ShellNavItem[] = [
  { href: '/admin', label: 'Hospitals', icon: 'hospitals' },
  { href: '/admin/modules', label: 'Modules and plans', icon: 'modules' },
  { href: '/admin/imports', label: 'Master data imports', icon: 'imports' },
  { href: '/admin/staff', label: 'Staff and support', icon: 'staff' },
  { href: '/admin/health', label: 'Platform health', icon: 'health' },
];

export type HqStats = {
  hospitalCount: number;
  staffAccounts: number;
  lastBackupLabel: string;
  systemHealthLabel: string;
};

export const mockHqStats: HqStats = {
  hospitalCount: 4,
  staffAccounts: 128,
  lastBackupLabel: 'Sample: yesterday 02:00',
  systemHealthLabel: 'Database, Redis, Storage, WebSocket: all up',
};
