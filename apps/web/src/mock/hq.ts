/**
 * LABEL: mock Indigo HQ nav and dashboard stats for Step 5b.
 */

import type { NavItem } from '@/mock/navigation';

export const hqConceptNavItems: NavItem[] = [
  { href: '/admin', label: 'Hospitals' },
  { href: '/admin/modules', label: 'Modules and plans' },
  { href: '/admin/imports', label: 'Master data imports' },
  { href: '/admin/staff', label: 'Staff and support' },
  { href: '/admin/health', label: 'Platform health' },
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
