/**
 * LABEL: mock hospital staff app config, modules, and OPD queue for Step 5b.
 */

import { mockHospitals, type MockHospital } from '@/mock/hospitals';
import type { NavItem } from '@/mock/navigation';

export type EnabledModule = {
  code: string;
  label: string;
  href: string;
};

/** Active demo hospital for the staff shell (not a live tenant). */
export const demoStaffHospital: MockHospital = mockHospitals[0]!;

export const mockEnabledModules: EnabledModule[] = [
  { code: 'dashboard', label: 'Dashboard', href: '/app' },
  { code: 'opd', label: 'OPD queue', href: '/app/opd' },
  { code: 'ipd', label: 'IPD wards', href: '/app/ipd' },
  { code: 'pharmacy', label: 'Pharmacy', href: '/app/pharmacy' },
  { code: 'lab', label: 'Lab and radiology', href: '/app/lab' },
  { code: 'billing', label: 'Billing', href: '/app/billing' },
];

export function staffNavFromModules(modules: EnabledModule[] = mockEnabledModules): NavItem[] {
  return modules.map((module) => ({ href: module.href, label: module.label }));
}

export type OpdStats = {
  waiting: number;
  inConsultation: number;
  seenToday: number;
  onlineBookings: number;
};

export type OpdTokenStatus = 'In consultation' | 'Checked in paid' | 'Booked unpaid at desk';

export type OpdToken = {
  token: string;
  patient: string;
  slot: string;
  status: OpdTokenStatus;
};

export type OpdQueue = {
  doctorName: string;
  speciality: string;
  stats: OpdStats;
  tokens: OpdToken[];
};

export const mockOpdQueue: OpdQueue = {
  doctorName: 'Demo Doctor A',
  speciality: 'General medicine',
  stats: {
    waiting: 6,
    inConsultation: 1,
    seenToday: 14,
    onlineBookings: 3,
  },
  tokens: [
    {
      token: 'A-12',
      patient: 'Sample Patient 01',
      slot: '10:00',
      status: 'In consultation',
    },
    {
      token: 'A-13',
      patient: 'Sample Patient 02',
      slot: '10:15',
      status: 'Checked in paid',
    },
    {
      token: 'A-14',
      patient: 'Sample Patient 03',
      slot: '10:30',
      status: 'Booked unpaid at desk',
    },
    {
      token: 'A-15',
      patient: 'Sample Patient 04',
      slot: '10:45',
      status: 'Checked in paid',
    },
  ],
};
