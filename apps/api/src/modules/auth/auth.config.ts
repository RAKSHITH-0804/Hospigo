/**
 * Single source for auth limits and token lifetimes.
 * Defaults are approved Step 6a/6b values; every value is env-overridable.
 */

export type AuthConfig = {
  passwordMinLength: number;
  tempPasswordLength: number;
  loginMaxFailures: number;
  loginFailureWindowMs: number;
  loginLockoutMs: number;
  ipRateLimitPerMinute: number;
  /** Sliding window for the per-IP login/refresh/reset counter. */
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
  /** Pad forgot-password responses so hit/miss paths take similar time. */
  forgotPasswordMinResponseMs: number;
  /** Max forgot-password requests per normalised account hash within the window. */
  resetMaxRequestsPerWindow: number;
  resetRequestWindowMs: number;
  mailJobAttempts: number;
  mailJobBackoffMs: number;
  mailRemoveOnCompleteCount: number;
  mailRemoveOnFailCount: number;
  jwtHospitalAccessSecret: string;
  jwtHqAccessSecret: string;
  jwtPatientAccessSecret: string;
  otpHashSecret: string;
  otpCodeLength: number;
  otpTtlSec: number;
  otpMaxAttempts: number;
  otpResendCooldownSec: number;
  otpMaxRequestsPerPhonePerHour: number;
  otpIpRateLimitPerMinute: number;
  /** Window for OTP IP counter (fixed 60s, same shape as staff IP window override via AUTH). */
  otpIpRateLimitWindowMs: number;
  patientAccessTokenTtlSec: number;
  patientRefreshTokenTtlSec: number;
  otpDefaultChannel: 'WHATSAPP' | 'SMS';
  otpFallbackChannel: 'WHATSAPP' | 'SMS';
  otpDriver: 'dev';
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
  forgotPasswordMinResponseMs: 250,
  resetMaxRequestsPerWindow: 5,
  resetRequestWindowMs: 15 * 60 * 1000,
  mailJobAttempts: 5,
  mailJobBackoffMs: 5_000,
  mailRemoveOnCompleteCount: 100,
  mailRemoveOnFailCount: 50,
  otpCodeLength: 6,
  otpTtlSec: 300,
  otpMaxAttempts: 5,
  otpResendCooldownSec: 30,
  otpMaxRequestsPerPhonePerHour: 5,
  otpIpRateLimitPerMinute: 10,
  otpIpRateLimitWindowMs: 60 * 1000,
  patientAccessTokenTtlSec: 15 * 60,
  patientRefreshTokenTtlSec: 30 * 24 * 60 * 60,
  otpDefaultChannel: 'WHATSAPP' as const,
  otpFallbackChannel: 'SMS' as const,
  otpDriver: 'dev' as const,
} as const;

export const AUTH_JWT_MIN_SECRET_LENGTH = 32;
export const AUTH_REDIS_KEY_PREFIX = 'hospigo:auth:';

export function loadAuthConfig(env: Record<string, unknown> = process.env): AuthConfig {
  const jwtHospitalAccessSecret = requireSecret(env, 'JWT_HOSPITAL_ACCESS_SECRET');
  const jwtHqAccessSecret = requireSecret(env, 'JWT_HQ_ACCESS_SECRET');
  const jwtPatientAccessSecret = requireSecret(env, 'JWT_PATIENT_ACCESS_SECRET');
  const otpHashSecret = requireSecret(env, 'OTP_HASH_SECRET');
  if (jwtHospitalAccessSecret === jwtHqAccessSecret) {
    throw new Error('JWT_HOSPITAL_ACCESS_SECRET and JWT_HQ_ACCESS_SECRET must differ');
  }
  if (
    jwtPatientAccessSecret === jwtHospitalAccessSecret ||
    jwtPatientAccessSecret === jwtHqAccessSecret
  ) {
    throw new Error('JWT_PATIENT_ACCESS_SECRET must differ from hospital and HQ secrets');
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
    forgotPasswordMinResponseMs: intEnv(
      env,
      'AUTH_FORGOT_PASSWORD_MIN_RESPONSE_MS',
      DEFAULTS.forgotPasswordMinResponseMs,
      0,
      10_000,
    ),
    resetMaxRequestsPerWindow: intEnv(
      env,
      'AUTH_RESET_MAX_REQUESTS_PER_WINDOW',
      DEFAULTS.resetMaxRequestsPerWindow,
      1,
      100,
    ),
    resetRequestWindowMs: intEnv(
      env,
      'AUTH_RESET_REQUEST_WINDOW_MS',
      DEFAULTS.resetRequestWindowMs,
      60_000,
      86_400_000,
    ),
    mailJobAttempts: intEnv(env, 'AUTH_MAIL_JOB_ATTEMPTS', DEFAULTS.mailJobAttempts, 1, 20),
    mailJobBackoffMs: intEnv(
      env,
      'AUTH_MAIL_JOB_BACKOFF_MS',
      DEFAULTS.mailJobBackoffMs,
      100,
      600_000,
    ),
    mailRemoveOnCompleteCount: intEnv(
      env,
      'AUTH_MAIL_REMOVE_ON_COMPLETE',
      DEFAULTS.mailRemoveOnCompleteCount,
      0,
      10_000,
    ),
    mailRemoveOnFailCount: intEnv(
      env,
      'AUTH_MAIL_REMOVE_ON_FAIL',
      DEFAULTS.mailRemoveOnFailCount,
      0,
      10_000,
    ),
    jwtHospitalAccessSecret,
    jwtHqAccessSecret,
    jwtPatientAccessSecret,
    otpHashSecret,
    otpCodeLength: intEnv(env, 'OTP_CODE_LENGTH', DEFAULTS.otpCodeLength, 4, 10),
    otpTtlSec: intEnv(env, 'OTP_TTL_SEC', DEFAULTS.otpTtlSec, 60, 3600),
    otpMaxAttempts: intEnv(env, 'OTP_MAX_ATTEMPTS', DEFAULTS.otpMaxAttempts, 1, 20),
    otpResendCooldownSec: intEnv(
      env,
      'OTP_RESEND_COOLDOWN_SEC',
      DEFAULTS.otpResendCooldownSec,
      5,
      3600,
    ),
    otpMaxRequestsPerPhonePerHour: intEnv(
      env,
      'OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR',
      DEFAULTS.otpMaxRequestsPerPhonePerHour,
      1,
      100,
    ),
    otpIpRateLimitPerMinute: intEnv(
      env,
      'OTP_IP_RATE_LIMIT_PER_MIN',
      DEFAULTS.otpIpRateLimitPerMinute,
      1,
      1000,
    ),
    otpIpRateLimitWindowMs: DEFAULTS.otpIpRateLimitWindowMs,
    patientAccessTokenTtlSec: intEnv(
      env,
      'PATIENT_ACCESS_TOKEN_TTL_SEC',
      DEFAULTS.patientAccessTokenTtlSec,
      60,
      86_400,
    ),
    patientRefreshTokenTtlSec: intEnv(
      env,
      'PATIENT_REFRESH_TOKEN_TTL_SEC',
      DEFAULTS.patientRefreshTokenTtlSec,
      3600,
      90 * 24 * 60 * 60,
    ),
    otpDefaultChannel: parseChannel(env['OTP_DEFAULT_CHANNEL'], DEFAULTS.otpDefaultChannel),
    otpFallbackChannel: parseChannel(env['OTP_FALLBACK_CHANNEL'], DEFAULTS.otpFallbackChannel),
    otpDriver: parseOtpDriver(env['OTP_DRIVER']),
  };
}

function parseChannel(raw: unknown, fallback: 'WHATSAPP' | 'SMS'): 'WHATSAPP' | 'SMS' {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const v = String(raw).trim().toUpperCase();
  if (v === 'WHATSAPP' || v === 'SMS') {
    return v;
  }
  throw new Error('OTP channel must be WHATSAPP or SMS');
}

function parseOtpDriver(raw: unknown): 'dev' {
  if (raw === undefined || raw === '' || raw === 'dev') {
    return 'dev';
  }
  throw new Error('OTP_DRIVER must be "dev" (other drivers are not implemented yet)');
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
