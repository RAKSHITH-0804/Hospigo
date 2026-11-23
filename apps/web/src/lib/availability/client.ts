import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import { availabilityPath, type Availability, type SlotBody } from './types';

/** Browser calls to the Next route handlers of the availability panel. Tokens never reach the browser. */

export function getAvailability(doctorId: string): Promise<PatientsApiResult<Availability>> {
  return patientsApi<Availability>(availabilityPath(doctorId));
}

export function saveSwitch(
  doctorId: string,
  availabilityOn: boolean,
): Promise<PatientsApiResult<Availability>> {
  return patientsApi<Availability>(availabilityPath(doctorId, '/switch'), {
    method: 'PUT',
    body: { availabilityOn },
  });
}

export function saveTimings(
  doctorId: string,
  branchId: string,
  slots: SlotBody[],
): Promise<PatientsApiResult<Availability>> {
  return patientsApi<Availability>(
    availabilityPath(doctorId, `/timings/${encodeURIComponent(branchId)}`),
    { method: 'PUT', body: { slots } },
  );
}

export function addLeave(
  doctorId: string,
  fromDate: string,
  toDate: string,
): Promise<PatientsApiResult<Availability>> {
  return patientsApi<Availability>(availabilityPath(doctorId, '/leave'), {
    method: 'POST',
    body: { fromDate, toDate },
  });
}

export function removeLeave(
  doctorId: string,
  leaveId: string,
): Promise<PatientsApiResult<Availability>> {
  return patientsApi<Availability>(
    availabilityPath(doctorId, `/leave/${encodeURIComponent(leaveId)}/remove`),
    { method: 'POST', body: {} },
  );
}
