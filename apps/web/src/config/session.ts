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
  errorModuleUnavailable: string;
  /** Patient session cookies (separate from staff/HQ). */
  patientCookieAccessName: string;
  patientCookieRefreshName: string;
  /** Must not equal or path-prefix-overlap staff refreshCookiePath. */
  patientRefreshCookiePath: string;
  patientRefreshMaxAgeSec: number;
  patientLoginPath: string;
  patientHomePath: string;
  patientUpstreamTimeoutMs: number;
  patientOtpCodeLength: number;
  patientErrorInvalidPhone: string;
  patientErrorInvalidCode: string;
  patientErrorRateLimited: string;
  patientErrorUnavailable: string;
  patientCodeSentNotice: string;
  patientResendCountdownLabel: string;
  patientSignedOutNotice: string;
  patientEmptyProfilesTitle: string;
  patientEmptyProfilesDescription: string;
  patientWelcomeText: string;
  patientBrandTitle: string;
  patientBrandSubtitle: string;
  patientStepPhoneHeading: string;
  patientStepCodeHeading: string;
  patientPhoneLabel: string;
  patientCodeLabel: string;
  patientSendCodeLabel: string;
  patientSendingLabel: string;
  patientVerifyLabel: string;
  patientVerifyingLabel: string;
  patientResendLabel: string;
  patientChangeNumberLabel: string;
  patientSignOutLabel: string;
  patientSigningOutLabel: string;
  patientLinkedProfilesHeading: string;
  /** Fallback list label; `{n}` is the 1-based index. */
  patientProfileFallbackLabel: string;
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
  errorModuleUnavailable: 'That module is not available for your active branch.',
  patientCookieAccessName: 'hospigo_patient_access',
  patientCookieRefreshName: 'hospigo_patient_refresh',
  patientRefreshCookiePath: '/api/patient-auth',
  patientRefreshMaxAgeSec: 30 * 24 * 60 * 60,
  patientLoginPath: '/patient/login',
  patientHomePath: '/patient',
  patientUpstreamTimeoutMs: 8000,
  patientOtpCodeLength: 6,
  patientErrorInvalidPhone: 'Enter a valid mobile number and try again.',
  patientErrorInvalidCode: 'That code is invalid or has expired. Request a new one.',
  patientErrorRateLimited: 'Too many attempts. Wait a moment and try again.',
  patientErrorUnavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  patientCodeSentNotice: 'If that number can receive messages, a code is on its way to {phone}.',
  patientResendCountdownLabel: 'Resend available in {sec}s',
  patientSignedOutNotice: 'You have been signed out.',
  patientEmptyProfilesTitle: 'No profiles linked yet',
  patientEmptyProfilesDescription: 'Hospital profiles will appear here when linking is available.',
  patientWelcomeText: 'Welcome. You are signed in.',
  patientBrandTitle: 'Patient sign in',
  patientBrandSubtitle: 'Verify with a one-time code sent to your mobile',
  patientStepPhoneHeading: 'Enter mobile number',
  patientStepCodeHeading: 'Enter verification code',
  patientPhoneLabel: 'Mobile number',
  patientCodeLabel: 'Verification code',
  patientSendCodeLabel: 'Send code',
  patientSendingLabel: 'Sending…',
  patientVerifyLabel: 'Verify',
  patientVerifyingLabel: 'Verifying…',
  patientResendLabel: 'Resend code',
  patientChangeNumberLabel: 'Change number',
  patientSignOutLabel: 'Sign out',
  patientSigningOutLabel: 'Signing out…',
  patientLinkedProfilesHeading: 'Linked profiles',
  patientProfileFallbackLabel: 'Profile {n}',
} as const;

/**
 * Cookie Path attributes must not collide: a path that is a prefix of another
 * causes the browser to send both cookies on overlapping routes.
 */
export function assertRefreshCookiePathsDistinct(staffPath: string, patientPath: string): void {
  if (staffPath === patientPath) {
    throw new Error('WEB_REFRESH_COOKIE_PATH and WEB_PATIENT_REFRESH_COOKIE_PATH must differ');
  }
  const a = staffPath.endsWith('/') ? staffPath.slice(0, -1) : staffPath;
  const b = patientPath.endsWith('/') ? patientPath.slice(0, -1) : patientPath;
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
    throw new Error('Staff and patient refresh cookie paths must not be prefixes of each other');
  }
}

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
  const refreshCookiePath = strEnv(env, 'WEB_REFRESH_COOKIE_PATH', DEFAULTS.refreshCookiePath);
  const patientRefreshCookiePath = strEnv(
    env,
    'WEB_PATIENT_REFRESH_COOKIE_PATH',
    DEFAULTS.patientRefreshCookiePath,
  );
  assertRefreshCookiePathsDistinct(refreshCookiePath, patientRefreshCookiePath);

  return {
    cookieAccessName: strEnv(env, 'WEB_COOKIE_ACCESS_NAME', DEFAULTS.cookieAccessName),
    cookieRefreshName: strEnv(env, 'WEB_COOKIE_REFRESH_NAME', DEFAULTS.cookieRefreshName),
    cookieChangeName: strEnv(env, 'WEB_COOKIE_CHANGE_NAME', DEFAULTS.cookieChangeName),
    refreshCookiePath,
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
    errorModuleUnavailable: strEnv(
      env,
      'WEB_ERROR_MODULE_UNAVAILABLE',
      DEFAULTS.errorModuleUnavailable,
    ),
    patientCookieAccessName: strEnv(
      env,
      'WEB_PATIENT_COOKIE_ACCESS_NAME',
      DEFAULTS.patientCookieAccessName,
    ),
    patientCookieRefreshName: strEnv(
      env,
      'WEB_PATIENT_COOKIE_REFRESH_NAME',
      DEFAULTS.patientCookieRefreshName,
    ),
    patientRefreshCookiePath,
    patientRefreshMaxAgeSec: intEnv(
      env,
      'WEB_PATIENT_REFRESH_COOKIE_MAX_AGE_SEC',
      DEFAULTS.patientRefreshMaxAgeSec,
      60,
      90 * 24 * 60 * 60,
    ),
    patientLoginPath: strEnv(env, 'WEB_PATIENT_LOGIN_PATH', DEFAULTS.patientLoginPath),
    patientHomePath: strEnv(env, 'WEB_PATIENT_HOME_PATH', DEFAULTS.patientHomePath),
    patientUpstreamTimeoutMs: intEnv(
      env,
      'WEB_PATIENT_UPSTREAM_TIMEOUT_MS',
      DEFAULTS.patientUpstreamTimeoutMs,
      1000,
      60_000,
    ),
    patientOtpCodeLength: intEnv(
      env,
      'WEB_PATIENT_OTP_CODE_LENGTH',
      DEFAULTS.patientOtpCodeLength,
      4,
      10,
    ),
    patientErrorInvalidPhone: strEnv(
      env,
      'WEB_PATIENT_ERROR_INVALID_PHONE',
      DEFAULTS.patientErrorInvalidPhone,
    ),
    patientErrorInvalidCode: strEnv(
      env,
      'WEB_PATIENT_ERROR_INVALID_CODE',
      DEFAULTS.patientErrorInvalidCode,
    ),
    patientErrorRateLimited: strEnv(
      env,
      'WEB_PATIENT_ERROR_RATE_LIMITED',
      DEFAULTS.patientErrorRateLimited,
    ),
    patientErrorUnavailable: strEnv(
      env,
      'WEB_PATIENT_ERROR_UNAVAILABLE',
      DEFAULTS.patientErrorUnavailable,
    ),
    patientCodeSentNotice: strEnv(
      env,
      'WEB_PATIENT_CODE_SENT_NOTICE',
      DEFAULTS.patientCodeSentNotice,
    ),
    patientResendCountdownLabel: strEnv(
      env,
      'WEB_PATIENT_RESEND_COUNTDOWN_LABEL',
      DEFAULTS.patientResendCountdownLabel,
    ),
    patientSignedOutNotice: strEnv(
      env,
      'WEB_PATIENT_SIGNED_OUT_NOTICE',
      DEFAULTS.patientSignedOutNotice,
    ),
    patientEmptyProfilesTitle: strEnv(
      env,
      'WEB_PATIENT_EMPTY_PROFILES_TITLE',
      DEFAULTS.patientEmptyProfilesTitle,
    ),
    patientEmptyProfilesDescription: strEnv(
      env,
      'WEB_PATIENT_EMPTY_PROFILES_DESCRIPTION',
      DEFAULTS.patientEmptyProfilesDescription,
    ),
    patientWelcomeText: strEnv(env, 'WEB_PATIENT_WELCOME_TEXT', DEFAULTS.patientWelcomeText),
    patientBrandTitle: strEnv(env, 'WEB_PATIENT_BRAND_TITLE', DEFAULTS.patientBrandTitle),
    patientBrandSubtitle: strEnv(env, 'WEB_PATIENT_BRAND_SUBTITLE', DEFAULTS.patientBrandSubtitle),
    patientStepPhoneHeading: strEnv(
      env,
      'WEB_PATIENT_STEP_PHONE_HEADING',
      DEFAULTS.patientStepPhoneHeading,
    ),
    patientStepCodeHeading: strEnv(
      env,
      'WEB_PATIENT_STEP_CODE_HEADING',
      DEFAULTS.patientStepCodeHeading,
    ),
    patientPhoneLabel: strEnv(env, 'WEB_PATIENT_PHONE_LABEL', DEFAULTS.patientPhoneLabel),
    patientCodeLabel: strEnv(env, 'WEB_PATIENT_CODE_LABEL', DEFAULTS.patientCodeLabel),
    patientSendCodeLabel: strEnv(env, 'WEB_PATIENT_SEND_CODE_LABEL', DEFAULTS.patientSendCodeLabel),
    patientSendingLabel: strEnv(env, 'WEB_PATIENT_SENDING_LABEL', DEFAULTS.patientSendingLabel),
    patientVerifyLabel: strEnv(env, 'WEB_PATIENT_VERIFY_LABEL', DEFAULTS.patientVerifyLabel),
    patientVerifyingLabel: strEnv(
      env,
      'WEB_PATIENT_VERIFYING_LABEL',
      DEFAULTS.patientVerifyingLabel,
    ),
    patientResendLabel: strEnv(env, 'WEB_PATIENT_RESEND_LABEL', DEFAULTS.patientResendLabel),
    patientChangeNumberLabel: strEnv(
      env,
      'WEB_PATIENT_CHANGE_NUMBER_LABEL',
      DEFAULTS.patientChangeNumberLabel,
    ),
    patientSignOutLabel: strEnv(env, 'WEB_PATIENT_SIGN_OUT_LABEL', DEFAULTS.patientSignOutLabel),
    patientSigningOutLabel: strEnv(
      env,
      'WEB_PATIENT_SIGNING_OUT_LABEL',
      DEFAULTS.patientSigningOutLabel,
    ),
    patientLinkedProfilesHeading: strEnv(
      env,
      'WEB_PATIENT_LINKED_PROFILES_HEADING',
      DEFAULTS.patientLinkedProfilesHeading,
    ),
    patientProfileFallbackLabel: strEnv(
      env,
      'WEB_PATIENT_PROFILE_FALLBACK_LABEL',
      DEFAULTS.patientProfileFallbackLabel,
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

/**
 * Production startup gate: fail closed if API_INTERNAL_URL is missing/invalid.
 * Paired with APP_URL so the BFF cannot boot without a reachable API base.
 */
export function assertProductionApiInternalUrl(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  requireApiInternalUrl(env);
}

export function cookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  if (env['NODE_ENV'] === 'production') {
    return true;
  }
  const appUrl = env['APP_URL'] ?? '';
  return appUrl.trim().toLowerCase().startsWith('https://');
}
