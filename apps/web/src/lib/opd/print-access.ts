import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { requireKind } from '@/lib/auth/guards';
import type { ConsultationResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import { apiConsultationPath, apiVisitVitalsPath } from '@/lib/opd/server';
import { fetchStaffOnServer, type ServerFetch } from '@/lib/patients/server';

/**
 * The prescription and the patient report may be opened by people who read notes (doctor, nurse,
 * Admin) and by people who may only PRINT them (reception, Phase 2.3). Anyone else is sent to the
 * home page with the usual no-permission notice.
 */
export async function requireClinicalPrint() {
  const session = await requireKind('HOSPITAL');
  const permissions = session.permissions ?? [];
  if (!permissions.includes('opd.notes.read') && !permissions.includes('opd.prints.clinical')) {
    redirect(`${sessionConfig.homeHospital}?notice=no-permission`);
  }
  return session;
}

/** The note and the vitals for a printout: through the notes route, or through the print-only route. */
export async function fetchClinicalForPrint(
  id: string,
  permissions: readonly string[],
): Promise<{
  consult: ServerFetch<ConsultationResponse>;
  vitals: ServerFetch<VitalsResponse> | null;
}> {
  if (permissions.includes('opd.notes.read')) {
    const [consult, vitals] = await Promise.all([
      fetchStaffOnServer<ConsultationResponse>(apiConsultationPath(id)),
      permissions.includes('opd.vitals.read')
        ? fetchStaffOnServer<VitalsResponse>(apiVisitVitalsPath(id))
        : Promise.resolve(null),
    ]);
    return { consult, vitals };
  }
  const bundle = await fetchStaffOnServer<{
    consultation: ConsultationResponse;
    vitals: VitalsResponse;
  }>(`/opd/visits/${encodeURIComponent(id)}/print-data`);
  if (bundle.status !== 'ok') {
    return { consult: bundle, vitals: null };
  }
  return {
    consult: { status: 'ok', data: bundle.data.consultation },
    vitals: { status: 'ok', data: bundle.data.vitals },
  };
}
