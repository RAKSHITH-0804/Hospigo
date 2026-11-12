export type AuthKind = 'HOSPITAL' | 'HQ';

export type TokenPairResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  mustChangePassword: boolean;
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
};

export type BrowserAuthErrorCode =
  'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNKNOWN' | 'VALIDATION' | 'FORBIDDEN';
