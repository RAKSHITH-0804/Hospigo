/**
 * @jest-environment node
 */
import {
  assertDevTenantSeedAllowed,
  assertNoTestTenantsInProduction,
} from './production-seed-guard';

describe('assertNoTestTenantsInProduction', () => {
  it('is a no-op outside production', async () => {
    await expect(
      assertNoTestTenantsInProduction('development', 'postgresql://invalid/does-not-connect'),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for test NODE_ENV', async () => {
    await expect(
      assertNoTestTenantsInProduction('test', 'postgresql://invalid/does-not-connect'),
    ).resolves.toBeUndefined();
  });
});

describe('assertDevTenantSeedAllowed (patient seed guard)', () => {
  it('refuses outside development', () => {
    expect(() => assertDevTenantSeedAllowed('test')).toThrow(/development/i);
    expect(() => assertDevTenantSeedAllowed('production')).toThrow(/development/i);
  });

  it('allows development', () => {
    expect(() => assertDevTenantSeedAllowed('development')).not.toThrow();
  });
});
