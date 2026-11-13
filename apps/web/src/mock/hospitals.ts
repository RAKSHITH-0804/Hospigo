/**
 * LABEL: mock hospital catalog for Step 5b concept screens.
 * Clearly fake names only. Remove when live hospital APIs exist.
 */

export type HospitalStatus = 'Active' | 'Onboarding';

export type MockHospital = {
  id: string;
  name: string;
  accessCode: string;
  modules: string[];
  status: HospitalStatus;
  brandColor: string;
};

export const mockHospitals: MockHospital[] = [
  {
    id: 'h1',
    name: 'Demo Hospital One',
    accessCode: 'DEMOONE',
    modules: ['OPD', 'IPD', 'Pharmacy'],
    status: 'Active',
    brandColor: '#0f766e',
  },
  {
    id: 'h2',
    name: 'Demo Hospital Two',
    accessCode: 'DEMOTWO',
    modules: ['OPD', 'Lab'],
    status: 'Active',
    brandColor: '#1d4ed8',
  },
  {
    id: 'h3',
    name: 'Demo Hospital Three',
    accessCode: 'DEMOTHR',
    modules: ['OPD', 'IPD', 'Billing'],
    status: 'Onboarding',
    brandColor: '#7c3aed',
  },
  {
    id: 'h4',
    name: 'Demo Hospital Four',
    accessCode: 'DEMOFOR',
    modules: ['OPD', 'Pharmacy', 'Radiology'],
    status: 'Active',
    brandColor: '#b45309',
  },
];

export function findHospitalByAccessCode(code: string): MockHospital | undefined {
  const normalized = code.trim().toUpperCase();
  return mockHospitals.find((hospital) => hospital.accessCode === normalized);
}
