/**
 * @jest-environment node
 */
import { assertNoTestTenantsInProduction } from './production-seed-guard';

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
