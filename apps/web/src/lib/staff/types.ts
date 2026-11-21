/** What the staff, roles and account APIs answer (Step 7d). The API checks every value; these are only the shapes. */

export const API_STAFF = '/staff';
export const API_STAFF_OPTIONS = '/staff/options';
export const API_ROLES = '/roles';
export const API_ROLES_CATALOG = '/roles/catalog';
export const API_ROLES_TEMPLATES = '/roles/templates';
export const API_ACCOUNT_ME = '/account/me';

/** The Next route handlers the browser calls (the access token never leaves the server). */
export const STAFF_ROUTES = {
  people: '/api/staff/people',
  codeFormat: '/api/staff/people/code-format',
  roles: '/api/staff/roles',
  accountMe: '/api/staff/account/me',
  emailRequest: '/api/staff/account/email/request',
  emailConfirm: '/api/staff/account/email/confirm',
  passwordRequest: '/api/staff/account/password/request',
  passwordConfirm: '/api/staff/account/password/confirm',
} as const;

export type StaffStatus = 'ACTIVE' | 'INVITED' | 'INACTIVE';

export type StaffRole = {
  assignmentId: string;
  roleId: string;
  code: string;
  name: string;
  isSystem: boolean;
  scope: 'BRANCH' | 'HOSPITAL';
  branchIds: string[];
};

export type StaffMember = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  status: StaffStatus;
  branches: Array<{ id: string; name: string }>;
  roles: StaffRole[];
  doctorCode: string | null;
  lastLoginAt: string | null;
  editable: boolean;
  isYou: boolean;
};

export type StaffListResponse = {
  items: StaffMember[];
  total: number;
  page: number;
  pageSize: number;
};

export type StaffCodeFormat = {
  prefix: string;
  minWidth: number;
  next: string;
  limits: { prefixMax: number; minWidthMin: number; minWidthMax: number };
};

export type RoleOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  assignable: boolean;
  reason: 'SYSTEM_ROLE' | 'NOT_GRANTABLE' | null;
};

export type StaffOptions = {
  roles: RoleOption[];
  branches: Array<{ id: string; name: string }>;
  canHospitalScope: boolean;
  canWrite: boolean;
  codeFormat: StaffCodeFormat;
  limits: { nameMax: number; emailMax: number; phoneMax: number; maxRolesPerPerson: number };
};

export type RoleView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionCodes: string[];
  assignedCount: number;
};

export type RolesListResponse = {
  items: RoleView[];
  /** The caller is a hospital-wide Admin who may make and change roles. */
  canWrite: boolean;
};
export type CatalogPermission = { code: string; description: string; group: string };
export type PermissionCatalog = { items: CatalogPermission[] };
export type RoleTemplate = {
  key: string;
  name: string;
  description: string;
  permissionCodes: string[];
};
export type RoleTemplates = { items: RoleTemplate[] };

export type AccountView = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  branches: string[];
  roles: string[];
  isDoctor: boolean;
  limits: { nameMax: number; phoneMax: number };
};

/** The body of "add / change a staff member". */
export type StaffBody = {
  name: string;
  email: string;
  phone?: string;
  branchIds: string[];
  roles: Array<{ roleId: string; scope?: 'BRANCH' | 'HOSPITAL' }>;
};
