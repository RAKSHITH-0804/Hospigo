import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import { seedShowcase } from './showcase';

loadEnv({ path: path.resolve(__dirname, '../../../../../.env') });

/**
 * Started by scripts/seed-showcase.ts (npm run prisma:seed-showcase -w @hospigo/api), which points
 * every database URL at the separate showcase database `hospigo_demo`. Two guards here as well:
 * the database must be named hospigo_demo, and it must not hold any test hospital (a test database
 * such as hospigo_test is never a showcase database). Development only.
 * SHOWCASE_DAYS and SHOWCASE_VISITS_PER_DAY change the amount of history.
 */
export const SHOWCASE_DATABASE = 'hospigo_demo';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error(
      'DATABASE_URL_OWNER is required (start this through npm run prisma:seed-showcase)',
    );
  }
  const name = new URL(url).pathname.replace(/^\//u, '');
  // the showcase database, or (only when asked for with SHOWCASE_ALLOW_DEV=1) the development database `hospigo`
  const allowDev = process.env.SHOWCASE_ALLOW_DEV === '1' && name === 'hospigo';
  if (name !== SHOWCASE_DATABASE && !allowDev) {
    throw new Error(`The showcase seed runs only against ${SHOWCASE_DATABASE}, not "${name}"`);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (!allowDev && (await prisma.hospital.count({ where: { isTest: true } })) > 0) {
      throw new Error(
        'Refusing: this database holds test hospitals, so it is not a showcase database',
      );
    }
    await seedShowcase(prisma, {
      historyDays: Number(process.env.SHOWCASE_DAYS ?? 60),
      visitsPerDay: Number(process.env.SHOWCASE_VISITS_PER_DAY ?? 12),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
