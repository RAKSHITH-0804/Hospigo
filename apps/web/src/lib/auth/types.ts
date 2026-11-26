export type AuthKind = 'HOSPITAL' | 'HQ';

export type TokenPairResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  mustChangePassword: boolean;
};

/** Patient OTP token pair (no password / mustChangePassword). */
export type PatientTokenPairResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type PatientMeProfile = {
  id: string;
  phone: string;
  createdAt: string;
  linkedProfiles: Array<Record<string, unknown>>;
};

export type PatientRequestOtpResponse = {
  ok: true;
  resendAfterSec: number;
};

export type AuthMeBranch = {
  id: string;
  name: string;
  isMain: boolean;
};

export type AuthMeModule = {
  code: string;
  name: string;
};

export type AuthMeProfile = {
  id: string;
  displayName: string;
  email: string;
  kind: AuthKind;
  hospitalName: string | null;
  activeBranchId: string | null;
  activeBranchName: string | null;
  roleCodes: string[];
  mustChangePassword: boolean;
  branches: AuthMeBranch[];
  enabledModules: AuthMeModule[];
  /** Permission codes allowed on the active branch (hospital); empty for HQ. */
  permissions: string[];
  /** True for hospital-wide users (branch switcher). Display only: the API decides. */
  canSwitchBranch: boolean;
  /** Hospital-wide role (a person with several branches of their own is a switcher but not hospital-wide). */
  hospitalWide?: boolean;
};

export type BrowserAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'UNKNOWN'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'INVALID_LINK';
