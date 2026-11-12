import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

/** Shared with prisma/seeds/dev-tenants.ts — refuse outside development. */
export function assertDevTenantSeedAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv !== 'development') {
    throw new Error('Dev tenant seed refuses to run unless NODE_ENV=development');
  }
}

/**
 * Production safety: refuse to serve if any hospital is marked isTest.
 * Demo/seeded accounts live under isTest hospitals (dev-tenants seed), so
 * isTest is the single signal we check — not email patterns or access codes.
 */
export async function assertNoTestTenantsInProduction(
  nodeEnv: string,
  ownerDatabaseUrl: string,
): Promise<void> {
  if (nodeEnv !== 'production') {
    return;
  }

  const adapter = new PrismaPg({ connectionString: ownerDatabaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    const testHospitalCount = await prisma.hospital.count({ where: { isTest: true } });
    if (testHospitalCount > 0) {
      throw new Error(
        `Refusing to start in production: found ${testHospitalCount} hospital(s) with isTest=true (demo/seed tenants). Remove them before going live.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Non-fatal warning helper for non-production environments that somehow have isTest data. */
export function logTestTenantPresence(logger: Logger, count: number): void {
  if (count <= 0) {
    return;
  }
  logger.warn(
    `Database contains ${count} hospital(s) with isTest=true (expected only in development).`,
  );
}
