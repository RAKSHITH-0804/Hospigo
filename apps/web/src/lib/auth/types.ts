export type AuthKind = 'HOSPITAL' | 'HQ';

export type TokenPairResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  mustChangePassword: boolean;
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
};

export type BrowserAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'UNKNOWN'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'INVALID_LINK';
