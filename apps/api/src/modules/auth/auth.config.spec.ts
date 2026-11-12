import { AUTH_JWT_MIN_SECRET_LENGTH, loadAuthConfig } from './auth.config';

const HOSPITAL = 'hospital-access-secret-value-32chars!!';
const HQ = 'hq-access-secret-value-32-characters!!!';

describe('auth config', () => {
  it('loads approved defaults when optional overrides are absent', () => {
    const cfg = loadAuthConfig({
      JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
      JWT_HQ_ACCESS_SECRET: HQ,
    });
    expect(cfg.passwordMinLength).toBe(10);
    expect(cfg.tempPasswordLength).toBe(14);
    expect(cfg.loginMaxFailures).toBe(5);
    expect(cfg.loginFailureWindowMs).toBe(15 * 60 * 1000);
    expect(cfg.loginLockoutMs).toBe(15 * 60 * 1000);
    expect(cfg.ipRateLimitPerMinute).toBe(20);
    expect(cfg.ipRateLimitWindowMs).toBe(60 * 1000);
    expect(cfg.accessTokenTtlSec).toBe(15 * 60);
    expect(cfg.refreshTokenTtlSec).toBe(7 * 24 * 60 * 60);
    expect(cfg.changePasswordTokenTtlSec).toBe(10 * 60);
    expect(cfg.activationLinkTtlSec).toBe(48 * 60 * 60);
    expect(cfg.resetLinkTtlSec).toBe(30 * 60);
    expect(cfg.requestBodyLimitBytes).toBe(100 * 1024);
    expect(cfg.trustedProxy).toBe('none');
    expect(cfg.forgotPasswordMinResponseMs).toBe(250);
    expect(cfg.resetMaxRequestsPerWindow).toBe(5);
    expect(cfg.resetRequestWindowMs).toBe(15 * 60 * 1000);
    expect(cfg.mailJobAttempts).toBe(5);
    expect(cfg.mailJobBackoffMs).toBe(5_000);
    expect(cfg.mailRemoveOnCompleteCount).toBe(100);
    expect(cfg.mailRemoveOnFailCount).toBe(50);
  });

  it('rejects missing, short, or identical JWT secrets', () => {
    expect(() => loadAuthConfig({})).toThrow(/JWT_HOSPITAL_ACCESS_SECRET is required/);
    expect(() =>
      loadAuthConfig({
        JWT_HOSPITAL_ACCESS_SECRET: 'short',
        JWT_HQ_ACCESS_SECRET: HQ,
      }),
    ).toThrow(new RegExp(`at least ${AUTH_JWT_MIN_SECRET_LENGTH}`));
    expect(() =>
      loadAuthConfig({
        JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
        JWT_HQ_ACCESS_SECRET: HOSPITAL,
      }),
    ).toThrow(/must differ/);
  });
});
