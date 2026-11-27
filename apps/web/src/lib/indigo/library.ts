import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';

/** What the Indigo console and the hospital chooser exchange with the API (Step 2.1f). */
export type LibraryTemplateRow = {
  id: string;
  docType: string;
  key: string;
  name: string;
  description: string;
  paper: string;
  retired: boolean;
  hospitalIds: string[];
};
export type LibraryLogoRow = {
  id: string;
  name: string;
  width: number;
  height: number;
  hospitalIds: string[];
};
export type LibraryOverview = {
  templates: LibraryTemplateRow[];
  logos: LibraryLogoRow[];
  samplesMissing: number;
};
export type HospitalLibrary = { templateIds: string[]; logoIds: string[] };

export type ChooserView = {
  canChoose: { branch: boolean; hospital: boolean };
  templates: Array<{
    id: string;
    docType: string;
    name: string;
    description: string;
    paper: string;
    active: boolean;
  }>;
  logos: Array<{ id: string; name: string; width: number; height: number }>;
};

export type TermsResponse = { items: Record<string, string> };

const BASE = '/api/staff/indigo';

export const LIBRARY_PRESETS = ['A4_FULL', 'A5_FULL', 'LABEL_SLIP', 'CARD_LABEL'] as const;

export const addSamples = (): Promise<PatientsApiResult<{ added: number }>> =>
  patientsApi(`${BASE}/library/samples`, { method: 'POST', body: {} });

export const createLibraryTemplate = (body: {
  name: string;
  docType?: string;
  copyOf?: string;
  preset?: string;
}): Promise<PatientsApiResult<{ id: string }>> =>
  patientsApi(`${BASE}/library/templates`, { method: 'POST', body });

export const retireLibraryTemplate = (id: string): Promise<PatientsApiResult<{ ok: true }>> =>
  patientsApi(`${BASE}/library/templates/${encodeURIComponent(id)}/retire`, {
    method: 'POST',
    body: {},
  });

export async function uploadLibraryLogo(name: string, file: File): Promise<boolean> {
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch(`${BASE}/library/logos?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: form,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const getHospitalLibrary = (id: string): Promise<PatientsApiResult<HospitalLibrary>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(id)}/library`);

export const saveHospitalLibrary = (
  id: string,
  body: HospitalLibrary,
): Promise<PatientsApiResult<HospitalLibrary>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(id)}/library`, { method: 'PUT', body });

export const getTerms = (id: string): Promise<PatientsApiResult<TermsResponse>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(id)}/terminology`);

export const saveTerms = (
  id: string,
  items: Record<string, string | null>,
): Promise<PatientsApiResult<TermsResponse>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(id)}/terminology`, {
    method: 'PUT',
    body: { items },
  });

export const saveBranchModules = (
  hospitalId: string,
  branchId: string,
  moduleCodes: string[],
): Promise<PatientsApiResult<{ moduleCodes: string[] }>> =>
  patientsApi(
    `${BASE}/hospitals/${encodeURIComponent(hospitalId)}/branches/${encodeURIComponent(branchId)}/modules`,
    { method: 'PUT', body: { moduleCodes } },
  );

export const runStarter = (
  hospitalId: string,
): Promise<PatientsApiResult<{ created: string[]; kept: string[]; warnings: string[] }>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(hospitalId)}/starter`, {
    method: 'POST',
    body: {},
  });

// ---- the hospital side -----------------------------------------------------------------------

export const chooseTemplate = (
  id: string,
  scope: 'branch' | 'hospital',
): Promise<PatientsApiResult<{ scope: string }>> =>
  patientsApi(
    `/api/staff/print-library/templates/${encodeURIComponent(id)}/choose?scope=${scope}`,
    {
      method: 'PUT',
      body: {},
    },
  );

export const chooseLogo = (id: string): Promise<PatientsApiResult<{ id: string }>> =>
  patientsApi(`/api/staff/print-library/logos/${encodeURIComponent(id)}/choose`, {
    method: 'PUT',
    body: {},
  });
