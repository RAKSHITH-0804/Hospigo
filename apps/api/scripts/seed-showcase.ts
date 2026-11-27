/**
 * npm run prisma:seed-showcase -w @hospigo/api
 * Part of npm run dev:reset: fills the development database `hospigo` with the two realistic hospitals
 * (60 days of history made through the real routes). Development only. Never prints a password.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import { seedReferenceData } from '../prisma/seeds/reference';

const apiRoot = path.resolve(__dirname, '..');
loadEnv({ path: path.resolve(apiRoot, '../../.env') });

const DB = 'hospigo';
const need = (key: string): string => {
  const v = process.env[key];
  if (!v) {
    throw new Error(`${key} is required in .env (use npm run dev:reset)`);
  }
  return v;
};
const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, '');

/**
 * The history is made through the real routes, so the business dates (visit dates) are spread over the
 * period but the moments the rows were written are all "now". This puts the written-at moments of the
 * showcase hospitals' visits, bills, payments, patients and vitals on the visit day (a typical working
 * hour), so reports and dashboards that look at those moments show a believable history. Demo
 * database only (the guard in main); the same result every time it runs.
 */
async function backdate(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const tenants = "SELECT id FROM hospitals WHERE code IN ('NANDAVANA', 'SAGARIKA')";
  const tables = ['opd_visits', 'bills', 'receipts', 'payments', 'patients', 'visit_vitals'];
  try {
    await client.query('BEGIN');
    for (const t of tables) {
      await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }
    await client.query(`
      UPDATE opd_visits v SET
        created_at = x.ts, updated_at = x.ts,
        completed_at = CASE WHEN v.completed_at IS NULL THEN NULL ELSE x.ts + interval '25 minutes' END
      FROM (SELECT id, ((visit_date::timestamp + interval '9 hours' + make_interval(mins => abs(hashtext(id)) % 540)) AT TIME ZONE 'Asia/Kolkata') AS ts FROM opd_visits) x
      WHERE v.id = x.id AND v.tenant_id IN (${tenants})`);
    await client.query(
      `UPDATE bills b SET created_at = v.created_at + interval '2 minutes' FROM opd_visits v WHERE b.visit_id = v.id AND b.tenant_id = v.tenant_id AND b.tenant_id IN (${tenants})`,
    );
    await client.query(
      `UPDATE receipts r SET created_at = b.created_at + interval '1 minute' FROM bills b WHERE r.bill_id = b.id AND r.tenant_id = b.tenant_id AND r.tenant_id IN (${tenants})`,
    );
    await client.query(
      `UPDATE payments p SET paid_at = r.created_at, created_at = r.created_at FROM receipts r WHERE p.receipt_id = r.id AND p.tenant_id = r.tenant_id AND p.tenant_id IN (${tenants})`,
    );
    await client.query(
      `UPDATE visit_vitals t SET created_at = v.created_at + interval '15 minutes' FROM opd_visits v WHERE t.visit_id = v.id AND t.tenant_id = v.tenant_id AND t.tenant_id IN (${tenants})`,
    );
    await client.query(
      `UPDATE patients p SET created_at = f.first_at - interval '10 minutes', updated_at = f.first_at - interval '10 minutes' FROM (SELECT patient_id, tenant_id, min(created_at) AS first_at FROM opd_visits GROUP BY 1, 2) f WHERE p.id = f.patient_id AND p.tenant_id = f.tenant_id AND p.tenant_id IN (${tenants})`,
    );
    for (const t of tables) {
      await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The showcase seed runs only with NODE_ENV=development');
  }
  // npm run dev:reset: only ever the development database `hospigo`
  const app = need('DATABASE_URL');
  const owner = need('DATABASE_URL_OWNER');
  if (dbName(app) !== DB || dbName(owner) !== DB) {
    throw new Error(`The database URLs must point at ${DB}`);
  }
  const env = {
    ...process.env,
    DATABASE_URL: app,
    DATABASE_URL_OWNER: owner,
    DATABASE_URL_TEST: app,
    DATABASE_URL_OWNER_TEST: owner,
    DATABASE_URL_HQ: need('DATABASE_URL_HQ'),
    DATABASE_URL_PATIENT: need('DATABASE_URL_PATIENT'),
  };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: owner }) });
  try {
    if ((await prisma.hospital.count({ where: { isTest: true } })) > 0) {
      throw new Error(
        'Refusing: this database holds test hospitals, so it is not the dev database',
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
  await backdate(owner);
  console.log('Written-at moments of the history set to the visit days.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
