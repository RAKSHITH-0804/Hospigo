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
  /** What this HQ person may do (the full list for an HQ Admin). */
  permissions?: string[];
  moduleCatalog: Array<{ code: string; name: string }>;
  items: IndigoHospitalRow[];
};

export type IndigoEmployee = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  hospitalIds: string[];
  permissions?: string[];
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

export type HqCounts = {
  hospitalId: string;
  visitsToday: number;
  visits7d: number;
  visits30d: number;
  activeUsers30d: number;
  lastActivity: string | null;
};

export type HqHealth = {
  status: 'ok' | 'degraded';
  checkedAt: string;
  api: string;
  database: string;
  storage: string;
  migrations: string;
};

export type HqSuperAdmin = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type HqActivityRow = {
  id: string;
  at: string;
  person: string | null;
  hospital: string | null;
  action: string;
  entityType: string;
};

export type HqActivePrint = {
  designs: Array<{ docType: string; branchId: string | null; libraryTemplateId: string | null }>;
  hasLogo: boolean;
};
