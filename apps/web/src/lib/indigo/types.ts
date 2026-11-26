/** What the Indigo console API answers (Step 2.1e). */
export type IndigoBranch = {
  id: string;
  code: string;
  name: string;
  isMain: boolean;
  isActive: boolean;
  /** Only the Indigo Owner sees access codes. */
  accessCode?: string;
  modules: string[];
};

export type IndigoHospitalRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  isActive: boolean;
  isTest: boolean;
  modules: string[];
  branches: IndigoBranch[];
};

export type IndigoOverview = {
  canManage: boolean;
  moduleCatalog: Array<{ code: string; name: string }>;
  items: IndigoHospitalRow[];
};

export type IndigoEmployee = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  hospitalIds: string[];
};

export type OnboardBody = {
  code: string;
  name: string;
  branches: Array<{ code: string; name: string; accessCode: string; isMain: boolean }>;
  moduleCodes: string[];
  superAdmin: { name: string; email: string };
};

export type OnboardResult = {
  hospital: { id: string; code: string; name: string };
  branches: Array<{ code: string; name: string; accessCode: string; isMain: boolean }>;
  superAdmin: { id: string | null; email: string; temporaryPassword: string };
  nextStep: string;
};
