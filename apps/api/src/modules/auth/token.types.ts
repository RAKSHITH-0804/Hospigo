export const ACCESS_TOKEN_TYPES = [
  'HOSPITAL',
  'HQ',
  'CHANGE_PASSWORD_HOSPITAL',
  'CHANGE_PASSWORD_HQ',
  'PATIENT',
] as const;

export type AccessTokenType = (typeof ACCESS_TOKEN_TYPES)[number];

export function isAccessTokenType(value: unknown): value is AccessTokenType {
  return typeof value === 'string' && (ACCESS_TOKEN_TYPES as readonly string[]).includes(value);
}

export function isHospitalTokenType(
  type: AccessTokenType,
): type is HospitalAccessClaims['tokenType'] {
  return type === 'HOSPITAL' || type === 'CHANGE_PASSWORD_HOSPITAL';
}

export function isHqTokenType(type: AccessTokenType): type is HqAccessClaims['tokenType'] {
  return type === 'HQ' || type === 'CHANGE_PASSWORD_HQ';
}

export function isPatientTokenType(
  type: AccessTokenType,
): type is PatientAccessClaims['tokenType'] {
  return type === 'PATIENT';
}

export type HospitalAccessClaims = {
  tokenType: 'HOSPITAL' | 'CHANGE_PASSWORD_HOSPITAL';
  tenantId: string;
  userId: string;
  branchId: string;
};

export type HqAccessClaims = {
  tokenType: 'HQ' | 'CHANGE_PASSWORD_HQ';
  userId: string;
};

export type PatientAccessClaims = {
  tokenType: 'PATIENT';
  accountId: string;
};

export type AccessClaims = HospitalAccessClaims | HqAccessClaims | PatientAccessClaims;

/** Hospital refresh: h.&lt;tenantId&gt;.&lt;sessionId&gt;.&lt;secret&gt; — tenantId lets RLS resolve without cross-tenant scan. */
export type HospitalRefreshParts = {
  kind: 'hospital';
  tenantId: string;
  sessionId: string;
  secret: string;
};

/** HQ refresh: q.&lt;sessionId&gt;.&lt;secret&gt; — no tenant. */
export type HqRefreshParts = {
  kind: 'hq';
  sessionId: string;
  secret: string;
};

/** Patient refresh: p.&lt;sessionId&gt;.&lt;secret&gt; — no tenant. */
export type PatientRefreshParts = {
  kind: 'patient';
  sessionId: string;
  secret: string;
};

export type RefreshTokenParts = HospitalRefreshParts | HqRefreshParts | PatientRefreshParts;
