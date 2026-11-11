/**
 * LABEL: mock public booking doctors and slots for Step 5b.
 */

import { findHospitalByAccessCode, mockHospitals, type MockHospital } from '@/mock/hospitals';

export type MockDoctor = {
  id: string;
  name: string;
  speciality: string;
  feeLabel: string;
};

export type MockSlot = {
  id: string;
  label: string;
};

export const mockDoctors: MockDoctor[] = [
  {
    id: 'd1',
    name: 'Demo Doctor A',
    speciality: 'General medicine',
    feeLabel: '₹400',
  },
  {
    id: 'd2',
    name: 'Demo Doctor B',
    speciality: 'Paediatrics',
    feeLabel: '₹500',
  },
];

export const mockSlots: MockSlot[] = [
  { id: 's1', label: '10:00' },
  { id: 's2', label: '10:30' },
  { id: 's3', label: '11:00' },
  { id: 's4', label: '11:30' },
];

export function hospitalForBookingCode(code: string): MockHospital {
  return findHospitalByAccessCode(code) ?? mockHospitals[0]!;
}
