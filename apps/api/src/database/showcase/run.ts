import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import { seedShowcase } from './showcase';

loadEnv({ path: path.resolve(__dirname, '../../../../../.env') });

/**
 * npm run prisma:seed-showcase -w @hospigo/api
 * Two fictional hospitals with 75 days of history (SHOWCASE_DAYS, SHOWCASE_VISITS_PER_DAY to change).
 * Development only. SHOWCASE_DEACTIVATE_DEMO=1 also switches off the older demo hospitals.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER (or DATABASE_URL) is required for seeding');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedShowcase(prisma, {
      historyDays: Number(process.env.SHOWCASE_DAYS ?? 75),
      visitsPerDay: Number(process.env.SHOWCASE_VISITS_PER_DAY ?? 14),
      deactivateDemoHospitals: process.env.SHOWCASE_DEACTIVATE_DEMO === '1',
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
