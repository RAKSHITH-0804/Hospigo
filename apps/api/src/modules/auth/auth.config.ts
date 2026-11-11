/**
 * Single source for auth limits and token lifetimes.
 * Defaults are approved Step 6a values; every value is env-overridable.
 */

export type AuthConfig = {
  passwordMinLength: number;
  tempPasswordLength: number;
  loginMaxFailures: number;
  loginFailureWindowMs: number;
  loginLockoutMs: number;
  ipRateLimitPerMinute: number;
  /** Sliding window for the per-IP login/refresh counter. */
  ipRateLimitWindowMs: number;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  changePasswordTokenTtlSec: number;
  activationLinkTtlSec: number;
  resetLinkTtlSec: number;
  /** Max JSON/urlencoded body size in bytes (express limit). */
  requestBodyLimitBytes: number;
  /**
   * Express trust-proxy setting. Default `none` means X-Forwarded-For is not trusted.
   * Set to a hop count (e.g. `1`) or `true` only behind a known reverse proxy.
   */
  trustedProxy: 'none' | true | number;
  jwtHospitalAccessSecret: string;
  jwtHqAccessSecret: string;
};

const DEFAULTS = {
  passwordMinLength: 10,
  tempPasswordLength: 14,
  loginMaxFailures: 5,
  loginFailureWindowMs: 15 * 60 * 1000,
  loginLockoutMs: 15 * 60 * 1000,
  ipRateLimitPerMinute: 20,
  ipRateLimitWindowMs: 60 * 1000,
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 7 * 24 * 60 * 60,
  changePasswordTokenTtlSec: 10 * 60,
  activationLinkTtlSec: 48 * 60 * 60,
  resetLinkTtlSec: 30 * 60,
  requestBodyLimitBytes: 100 * 1024,
} as const;

export const AUTH_JWT_MIN_SECRET_LENGTH = 32;
export const AUTH_REDIS_KEY_PREFIX = 'hospigo:auth:';

export function loadAuthConfig(env: Record<string, unknown> = process.env): AuthConfig {
  const jwtHospitalAccessSecret = requireSecret(env, 'JWT_HOSPITAL_ACCESS_SECRET');
  const jwtHqAccessSecret = requireSecret(env, 'JWT_HQ_ACCESS_SECRET');
  if (jwtHospitalAccessSecret === jwtHqAccessSecret) {
    throw new Error('JWT_HOSPITAL_ACCESS_SECRET and JWT_HQ_ACCESS_SECRET must differ');
  }

  return {
    passwordMinLength: intEnv(env, 'AUTH_PASSWORD_MIN_LENGTH', DEFAULTS.passwordMinLength, 8, 128),
    tempPasswordLength: intEnv(
      env,
      'AUTH_TEMP_PASSWORD_LENGTH',
      DEFAULTS.tempPasswordLength,
      12,
      64,
    ),
    loginMaxFailures: intEnv(env, 'AUTH_LOGIN_MAX_FAILURES', DEFAULTS.loginMaxFailures, 1, 50),
    loginFailureWindowMs: intEnv(
      env,
      'AUTH_LOGIN_FAILURE_WINDOW_MS',
      DEFAULTS.loginFailureWindowMs,
      60_000,
      86_400_000,
    ),
    loginLockoutMs: intEnv(
      env,
      'AUTH_LOGIN_LOCKOUT_MS',
      DEFAULTS.loginLockoutMs,
      60_000,
      86_400_000,
    ),
    ipRateLimitPerMinute: intEnv(
      env,
      'AUTH_IP_RATE_LIMIT_PER_MIN',
      DEFAULTS.ipRateLimitPerMinute,
      1,
      1000,
    ),
    ipRateLimitWindowMs: intEnv(
      env,
      'AUTH_IP_RATE_LIMIT_WINDOW_MS',
      DEFAULTS.ipRateLimitWindowMs,
      1000,
      3_600_000,
    ),
    accessTokenTtlSec: intEnv(
      env,
      'AUTH_ACCESS_TOKEN_TTL_SEC',
      DEFAULTS.accessTokenTtlSec,
      60,
      86_400,
    ),
    refreshTokenTtlSec: intEnv(
      env,
      'AUTH_REFRESH_TOKEN_TTL_SEC',
      DEFAULTS.refreshTokenTtlSec,
      3600,
      90 * 24 * 60 * 60,
    ),
    changePasswordTokenTtlSec: intEnv(
      env,
      'AUTH_CHANGE_PASSWORD_TOKEN_TTL_SEC',
      DEFAULTS.changePasswordTokenTtlSec,
      60,
      3600,
    ),
    activationLinkTtlSec: intEnv(
      env,
      'AUTH_ACTIVATION_LINK_TTL_SEC',
      DEFAULTS.activationLinkTtlSec,
      3600,
      14 * 24 * 60 * 60,
    ),
    resetLinkTtlSec: intEnv(env, 'AUTH_RESET_LINK_TTL_SEC', DEFAULTS.resetLinkTtlSec, 300, 86_400),
    requestBodyLimitBytes: intEnv(
      env,
      'AUTH_REQUEST_BODY_LIMIT_BYTES',
      DEFAULTS.requestBodyLimitBytes,
      1024,
      10 * 1024 * 1024,
    ),
    trustedProxy: parseTrustedProxy(env['AUTH_TRUSTED_PROXY']),
    jwtHospitalAccessSecret,
    jwtHqAccessSecret,
  };
}

function parseTrustedProxy(raw: unknown): AuthConfig['trustedProxy'] {
  if (raw === undefined || raw === '' || raw === 'none') {
    return 'none';
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  throw new Error('AUTH_TRUSTED_PROXY must be none, true, or a non-negative hop count');
}

function requireSecret(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length < AUTH_JWT_MIN_SECRET_LENGTH) {
    throw new Error(`${key} must be at least ${AUTH_JWT_MIN_SECRET_LENGTH} characters`);
  }
  return trimmed;
}

function intEnv(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return n;
}
