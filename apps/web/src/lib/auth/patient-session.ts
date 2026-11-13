import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { sessionConfig } from '@/config/session';
import { patientMe } from './api-client';
import type { PatientMeProfile } from './types';

export type PatientSessionResult = PatientMeProfile;

/**
 * Reads the patient access cookie and calls API GET /patient/me.
 * Memoized per request via React cache. Does not decode JWTs in the web app.
 */
export const getPatientSession = cache(async (): Promise<PatientSessionResult | null> => {
  const jar = await cookies();
  const access = jar.get(sessionConfig.patientCookieAccessName)?.value;
  if (!access) {
    return null;
  }
  const headersList = await headers();
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? '127.0.0.1';
  const synthetic = new Request(`${proto}://${host}/`, {
    headers: {
      'x-forwarded-for': headersList.get('x-forwarded-for') ?? '',
      'x-real-ip': headersList.get('x-real-ip') ?? '',
    },
  });
  const result = await patientMe(synthetic, access);
  if (!result.ok) {
    return null;
  }
  return result.data;
});

export async function currentPatientPathname(): Promise<string> {
  const headersList = await headers();
  return headersList.get('x-pathname') ?? sessionConfig.patientHomePath;
}
