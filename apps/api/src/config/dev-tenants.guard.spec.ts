/**
 * @jest-environment node
 */
import { assertDevTenantSeedAllowed } from './production-seed-guard';

describe('seedDevTenants first-live guard', () => {
  it('refuses to run when NODE_ENV is not development', () => {
    expect(() => assertDevTenantSeedAllowed('production')).toThrow(
      /refuses to run unless NODE_ENV=development/i,
    );
    expect(() => assertDevTenantSeedAllowed('test')).toThrow(
      /refuses to run unless NODE_ENV=development/i,
    );
    expect(() => assertDevTenantSeedAllowed(undefined)).toThrow(
      /refuses to run unless NODE_ENV=development/i,
    );
  });

  it('allows NODE_ENV=development', () => {
    expect(() => assertDevTenantSeedAllowed('development')).not.toThrow();
  });
});
