/**
 * @jest-environment node
 */
import {
  assertProductionApiInternalUrl,
  assertProductionAppUrl,
  assertRefreshCookiePathsDistinct,
  loadSessionConfig,
  requireApiInternalUrl,
  requireAppOrigin,
} from './session';

describe('APP_URL production startup gate', () => {
  it('assertProductionAppUrl throws when APP_URL is unset in production', () => {
    expect(() => assertProductionAppUrl({ NODE_ENV: 'production', APP_URL: undefined })).toThrow(
      /APP_URL is required/,
    );
  });

  it('assertProductionAppUrl is a no-op outside production', () => {
    expect(() =>
      assertProductionAppUrl({ NODE_ENV: 'development', APP_URL: undefined }),
    ).not.toThrow();
  });

  it('requireAppOrigin returns the origin from APP_URL', () => {
    expect(requireAppOrigin({ APP_URL: 'http://127.0.0.1:3001/path' })).toBe(
      'http://127.0.0.1:3001',
    );
  });
});

describe('API_INTERNAL_URL production startup gate', () => {
  it('assertProductionApiInternalUrl throws when unset in production', () => {
    expect(() =>
      assertProductionApiInternalUrl({ NODE_ENV: 'production', API_INTERNAL_URL: undefined }),
    ).toThrow(/API_INTERNAL_URL is required/);
  });

  it('assertProductionApiInternalUrl is a no-op outside production', () => {
    expect(() =>
      assertProductionApiInternalUrl({ NODE_ENV: 'development', API_INTERNAL_URL: undefined }),
    ).not.toThrow();
  });

  it('requireApiInternalUrl rejects non-http values', () => {
    expect(() => requireApiInternalUrl({ API_INTERNAL_URL: 'ftp://x' })).toThrow(
      /must start with http/,
    );
  });
});

describe('patient session config', () => {
  it('loads patient cookie defaults distinct from staff', () => {
    const cfg = loadSessionConfig({});
    expect(cfg.patientCookieAccessName).toBe('hospigo_patient_access');
    expect(cfg.patientCookieRefreshName).toBe('hospigo_patient_refresh');
    expect(cfg.patientRefreshCookiePath).toBe('/api/patient-auth');
    expect(cfg.patientLoginPath).toBe('/patient/login');
    expect(cfg.patientHomePath).toBe('/patient');
    expect(cfg.patientUpstreamTimeoutMs).toBe(8000);
    expect(cfg.patientOtpCodeLength).toBe(6);
    expect(cfg.patientCookieAccessName).not.toBe(cfg.cookieAccessName);
    expect(cfg.patientCookieRefreshName).not.toBe(cfg.cookieRefreshName);
    expect(cfg.patientRefreshCookiePath).not.toBe(cfg.refreshCookiePath);
  });

  it('rejects overlapping staff/patient refresh cookie paths', () => {
    expect(() => assertRefreshCookiePathsDistinct('/api/auth', '/api/auth')).toThrow(/must differ/);
    expect(() => assertRefreshCookiePathsDistinct('/api', '/api/auth')).toThrow(/prefixes/);
    expect(() =>
      loadSessionConfig({
        WEB_REFRESH_COOKIE_PATH: '/api/auth',
        WEB_PATIENT_REFRESH_COOKIE_PATH: '/api/auth/patient',
      }),
    ).toThrow(/prefixes/);
  });

  it('rejects invalid patient timeout and code length', () => {
    expect(() => loadSessionConfig({ WEB_PATIENT_UPSTREAM_TIMEOUT_MS: '500' })).toThrow(
      /WEB_PATIENT_UPSTREAM_TIMEOUT_MS/,
    );
    expect(() => loadSessionConfig({ WEB_PATIENT_OTP_CODE_LENGTH: '2' })).toThrow(
      /WEB_PATIENT_OTP_CODE_LENGTH/,
    );
  });
});
