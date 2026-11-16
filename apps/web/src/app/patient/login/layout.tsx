import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import { getPatientSession } from '@/lib/auth/patient-session';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientLogin };

export default async function PatientLoginLayout({ children }: { children: ReactNode }) {
  const session = await getPatientSession();
  if (session) {
    redirect(sessionConfig.patientHomePath);
  }
  return children;
}
