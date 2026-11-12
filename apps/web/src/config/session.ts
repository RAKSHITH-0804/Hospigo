/**
 * Single source for web session cookie names, lifetimes, paths, redirects, and UI copy.
 * Every limit is env-overridable; no magic numbers in handlers or components.
 */

export type SessionConfig = {
  cookieAccessName: string;
  cookieRefreshName: string;
  cookieChangeName: string;
  /** Refresh cookie path — restricted to auth route handlers. */
  refreshCookiePath: string;
  refreshMaxAgeSec: number;
  changePasswordMaxAgeSec: number;
  /** Max JSON body bytes for auth POSTs. */
  bodyLimitBytes: number;
  /** In-process single-flight TTL for refresh rotations. */
  refreshSingleFlightTtlMs: number;
  /**
   * When true, `resolveClientIp` trusts `x-forwarded-for` / `x-real-ip`
   * (web app behind our IIS/nginx). When false (default), only socket address.
   */
  trustForwardedHeaders: boolean;
  homeHq: string;
  homeHospital: string;
  loginPath: string;
  changePasswordPath: string;
  forgotPasswordPath: string;
  resetPasswordPath: string;
  activatePath: string;
  /** Plain login query flag after reset/activate (no secrets). */
  passwordUpdatedNotice: string;
  errorInvalidCredentials: string;
  errorRateLimited: string;
  errorUnavailable: string;
  /** Change-password UI copy (generic rules — no hardcoded min length number). */
  errorChangePasswordValidation: string;
  errorChangePasswordInvalid: string;
  errorChangePasswordRateLimited: string;
  errorChangePasswordUnavailable: string;
  forgotPasswordConfirmation: string;
  errorInvalidLink: string;
  errorPasswordValidation: string;
  passwordUpdatedNoticeText: string;
};

const DEFAULTS = {
  cookieAccessName: 'hospigo_access',
  cookieRefreshName: 'hospigo_refresh',
  cookieChangeName: 'hospigo_change',
  refreshCookiePath: '/api/auth',
  refreshMaxAgeSec: 7 * 24 * 60 * 60,
  changePasswordMaxAgeSec: 10 * 60,
  bodyLimitBytes: 16 * 1024,
  refreshSingleFlightTtlMs: 15_000,
  trustForwardedHeaders: false,
  homeHq: '/admin',
  homeHospital: '/app',
  loginPath: '/login',
  changePasswordPath: '/change-password',
  forgotPasswordPath: '/forgot-password',
  resetPasswordPath: '/reset-password',
  activatePath: '/activate',
  passwordUpdatedNotice: 'password-updated',
  errorInvalidCredentials: 'Sign-in failed. Check your details and try again.',
  errorRateLimited: 'Too many attempts. Wait a moment and try again.',
  errorUnavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  errorChangePasswordValidation:
    'That password does not meet the requirements. Use at least the minimum length and avoid common passwords.',
  errorChangePasswordInvalid: 'Current password is incorrect.',
  errorChangePasswordRateLimited: 'Too many attempts. Try again later.',
  errorChangePasswordUnavailable: 'Service temporarily unavailable. Try again.',
  forgotPasswordConfirmation: 'If an account exists, we have sent instructions.',
  errorInvalidLink: 'This link is invalid or has expired. Request a new one.',
  errorPasswordValidation: 'That password does not meet the requirements.',
  passwordUpdatedNoticeText: 'Your password was updated. You can sign in now.',
} as const;

function intEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return n;
}

function strEnv(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.trim();
}

function boolEnv(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  throw new Error(`${key} must be a boolean (true/false)`);
}

export function loadSessionConfig(
  env: Record<string, string | undefined> = process.env,
): SessionConfig {
  return {
    cookieAccessName: strEnv(env, 'WEB_COOKIE_ACCESS_NAME', DEFAULTS.cookieAccessName),
    cookieRefreshName: strEnv(env, 'WEB_COOKIE_REFRESH_NAME', DEFAULTS.cookieRefreshName),
    cookieChangeName: strEnv(env, 'WEB_COOKIE_CHANGE_NAME', DEFAULTS.cookieChangeName),
    refreshCookiePath: strEnv(env, 'WEB_REFRESH_COOKIE_PATH', DEFAULTS.refreshCookiePath),
    refreshMaxAgeSec: intEnv(
      env,
      'WEB_REFRESH_COOKIE_MAX_AGE_SEC',
      DEFAULTS.refreshMaxAgeSec,
      60,
      90 * 24 * 60 * 60,
    ),
    changePasswordMaxAgeSec: intEnv(
      env,
      'WEB_CHANGE_PASSWORD_COOKIE_MAX_AGE_SEC',
      DEFAULTS.changePasswordMaxAgeSec,
      60,
      3600,
    ),
    bodyLimitBytes: intEnv(
      env,
      'WEB_AUTH_BODY_LIMIT_BYTES',
      DEFAULTS.bodyLimitBytes,
      1024,
      1024 * 1024,
    ),
    refreshSingleFlightTtlMs: intEnv(
      env,
      'WEB_REFRESH_SINGLE_FLIGHT_TTL_MS',
      DEFAULTS.refreshSingleFlightTtlMs,
      1000,
      120_000,
    ),
    trustForwardedHeaders: boolEnv(
      env,
      'WEB_TRUST_FORWARDED_HEADERS',
      DEFAULTS.trustForwardedHeaders,
    ),
    homeHq: strEnv(env, 'WEB_HOME_HQ', DEFAULTS.homeHq),
    homeHospital: strEnv(env, 'WEB_HOME_HOSPITAL', DEFAULTS.homeHospital),
    loginPath: strEnv(env, 'WEB_LOGIN_PATH', DEFAULTS.loginPath),
    changePasswordPath: strEnv(env, 'WEB_CHANGE_PASSWORD_PATH', DEFAULTS.changePasswordPath),
    forgotPasswordPath: strEnv(env, 'WEB_FORGOT_PASSWORD_PATH', DEFAULTS.forgotPasswordPath),
    resetPasswordPath: strEnv(env, 'WEB_RESET_PASSWORD_PATH', DEFAULTS.resetPasswordPath),
    activatePath: strEnv(env, 'WEB_ACTIVATE_PATH', DEFAULTS.activatePath),
    passwordUpdatedNotice: strEnv(
      env,
      'WEB_PASSWORD_UPDATED_NOTICE',
      DEFAULTS.passwordUpdatedNotice,
    ),
    errorInvalidCredentials: strEnv(
      env,
      'WEB_ERROR_INVALID_CREDENTIALS',
      DEFAULTS.errorInvalidCredentials,
    ),
    errorRateLimited: strEnv(env, 'WEB_ERROR_RATE_LIMITED', DEFAULTS.errorRateLimited),
    errorUnavailable: strEnv(env, 'WEB_ERROR_UNAVAILABLE', DEFAULTS.errorUnavailable),
    errorChangePasswordValidation: strEnv(
      env,
      'WEB_ERROR_CHANGE_PASSWORD_VALIDATION',
      DEFAULTS.errorChangePasswordValidation,
    ),
    errorChangePasswordInvalid: strEnv(
      env,
      'WEB_ERROR_CHANGE_PASSWORD_INVALID',
      DEFAULTS.errorChangePasswordInvalid,
    ),
    errorChangePasswordRateLimited: strEnv(
      env,
      'WEB_ERROR_CHANGE_PASSWORD_RATE_LIMITED',
      DEFAULTS.errorChangePasswordRateLimited,
    ),
    errorChangePasswordUnavailable: strEnv(
      env,
      'WEB_ERROR_CHANGE_PASSWORD_UNAVAILABLE',
      DEFAULTS.errorChangePasswordUnavailable,
    ),
    forgotPasswordConfirmation: strEnv(
      env,
      'WEB_FORGOT_PASSWORD_CONFIRMATION',
      DEFAULTS.forgotPasswordConfirmation,
    ),
    errorInvalidLink: strEnv(env, 'WEB_ERROR_INVALID_LINK', DEFAULTS.errorInvalidLink),
    errorPasswordValidation: strEnv(
      env,
      'WEB_ERROR_PASSWORD_VALIDATION',
      DEFAULTS.errorPasswordValidation,
    ),
    passwordUpdatedNoticeText: strEnv(
      env,
      'WEB_PASSWORD_UPDATED_NOTICE_TEXT',
      DEFAULTS.passwordUpdatedNoticeText,
    ),
  };
}

/** Cached config for the Node process (route handlers / RSC). */
export const sessionConfig: SessionConfig = loadSessionConfig();

/**
 * Server-only API base URL. Never expose via NEXT_PUBLIC_*.
 * Validated when first needed so missing env fails closed.
 */
export function requireApiInternalUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env['API_INTERNAL_URL'];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('API_INTERNAL_URL is required (server-only; do not use NEXT_PUBLIC_*)');
  }
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('API_INTERNAL_URL must start with http:// or https://');
  }
  return trimmed;
}

/** Public app origin for Origin checks (from APP_URL). */
export function requireAppOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env['APP_URL'];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('APP_URL is required for web auth Origin checks');
  }
  try {
    return new URL(raw.trim()).origin;
  } catch {
    throw new Error('APP_URL must be a valid absolute URL');
  }
}

/**
 * Production startup gate: fail closed if APP_URL is missing/invalid.
 * Called from `instrumentation.ts` `register()` so the process dies before traffic.
 */
export function assertProductionAppUrl(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  requireAppOrigin(env);
}

export function cookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  if (env['NODE_ENV'] === 'production') {
    return true;
  }
  const appUrl = env['APP_URL'] ?? '';
  return appUrl.trim().toLowerCase().startsWith('https://');
}
