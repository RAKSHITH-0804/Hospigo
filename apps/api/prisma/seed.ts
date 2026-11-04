import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import { seedReferenceData } from './seeds/reference';
import { seedDevTenants } from './seeds/dev-tenants';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER (or DATABASE_URL) is required for seeding');
  }
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedReferenceData(prisma);
    if (process.env.NODE_ENV === 'development') {
      await seedDevTenants(prisma);
    } else {
      console.log('Skipping dev tenant seed (NODE_ENV is not development).');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
