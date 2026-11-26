/**
 * npm run prisma:seed-showcase -w @hospigo/api
 * Fills the SEPARATE showcase database `hospigo_demo` (fictional hospitals, 60 days of history made
 * through the real routes). Create and migrate that database first (docs/guides/dev-commands.md).
 * Needs DATABASE_URL_DEMO and DATABASE_URL_OWNER_DEMO in .env. Development only. Never prints a password.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import { seedReferenceData } from '../prisma/seeds/reference';

const apiRoot = path.resolve(__dirname, '..');
loadEnv({ path: path.resolve(apiRoot, '../../.env') });

const DB = 'hospigo_demo';
const need = (key: string): string => {
  const v = process.env[key];
  if (!v) {
    throw new Error(`${key} is required in .env (run node scripts/db/create-demo-db.mjs)`);
  }
  return v;
};
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, '');
const inDemo = (url: string): string => {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The showcase seed runs only with NODE_ENV=development');
  }
  const app = need('DATABASE_URL_DEMO');
  const owner = need('DATABASE_URL_OWNER_DEMO');
  if (dbName(app) !== DB || dbName(owner) !== DB) {
    throw new Error(`DATABASE_URL_DEMO and DATABASE_URL_OWNER_DEMO must point at ${DB}`);
  }
  const env = {
    ...process.env,
    DATABASE_URL: app,
    DATABASE_URL_OWNER: owner,
    DATABASE_URL_TEST: app,
    DATABASE_URL_OWNER_TEST: owner,
    DATABASE_URL_HQ: inDemo(need('DATABASE_URL_HQ')),
    DATABASE_URL_PATIENT: inDemo(need('DATABASE_URL_PATIENT')),
  };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: owner }) });
  try {
    if ((await prisma.hospital.count({ where: { isTest: true } })) > 0) {
      throw new Error(
        'Refusing: this database holds test hospitals, so it is not a showcase database',
      );
    }
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
  for (const [cmd, args] of [
    ['npx', ['nest', 'build']],
    ['node', ['dist/database/showcase/run.js']],
  ] as const) {
    const r = spawnSync(cmd, [...args], { cwd: apiRoot, env, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      process.exit(r.status ?? 1);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
