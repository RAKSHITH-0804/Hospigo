import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { getPatientSession } from '@/lib/auth/patient-session';

export default async function PatientLoginLayout({ children }: { children: ReactNode }) {
  const session = await getPatientSession();
  if (session) {
    redirect(sessionConfig.patientHomePath);
  }
  return children;
}
