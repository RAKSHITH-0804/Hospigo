#!/usr/bin/env node
/**
 * Phase 2.2: drops and recreates the DEVELOPMENT database `hospigo` (called by npm run dev:reset),
 * hardened like the others. Also drops the old showcase database `hospigo_demo` if it is still there.
 * It does not touch roles or passwords and never touches hospigo_test.
 * Needs POSTGRES_SUPERUSER_URL in .env. Never prints a password.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const DB = 'hospigo';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(root, '.env');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const env = Object.fromEntries(
  lines
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const need = (k) => {
  if (!env[k] || env[k].includes('CHANGE_ME')) {
    throw new Error(`${k} must be set in .env`);
  }
  return env[k];
};
const quote = (s) => `"${s.replace(/"/g, '""')}"`;

for (const key of ['DATABASE_URL', 'DATABASE_URL_OWNER']) {
  if (new URL(need(key)).pathname !== `/${DB}`) {
    throw new Error(`${key} must point at the database ${DB}`);
  }
}
const superUrl = need('POSTGRES_SUPERUSER_URL');
const client = new pg.Client({ connectionString: superUrl, connectionTimeoutMillis: 8000 });
await client.connect();
{
  // drop both completely: every hospital in them and all its history goes
  await client.query(`DROP DATABASE IF EXISTS "hospigo_demo" WITH (FORCE)`);
  await client.query(`DROP DATABASE IF EXISTS ${quote(DB)} WITH (FORCE)`);
  console.log(`dropped_database ${DB}`);
}
const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
if (exists.rowCount === 0) {
  await client.query(`CREATE DATABASE ${quote(DB)} OWNER hospigo_owner`);
  console.log(`created_database ${DB}`);
} else {
  console.log(`ensured_database ${DB}`);
}
const admin = new URL(superUrl);
admin.pathname = `/${DB}`;
const db = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 8000 });
await db.connect();
for (const sql of [
  'REVOKE ALL ON SCHEMA public FROM PUBLIC',
  'GRANT USAGE, CREATE ON SCHEMA public TO hospigo_owner',
  'GRANT USAGE ON SCHEMA public TO hospigo_app',
  'GRANT USAGE ON SCHEMA public TO hospigo_hq',
  'GRANT USAGE ON SCHEMA public TO hospigo_patient',
  'GRANT USAGE, CREATE ON SCHEMA public TO hospigo_security',
  'ALTER SCHEMA public OWNER TO hospigo_owner',
  'ALTER DEFAULT PRIVILEGES FOR ROLE hospigo_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  'ALTER DEFAULT PRIVILEGES FOR ROLE hospigo_security REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
]) {
  await db.query(sql);
}
await db.end();
await client.query(`REVOKE CONNECT ON DATABASE ${quote(DB)} FROM PUBLIC`);
for (const role of ['hospigo_owner', 'hospigo_app', 'hospigo_hq', 'hospigo_patient']) {
  await client.query(`GRANT CONNECT ON DATABASE ${quote(DB)} TO ${role}`);
}
await client.end();
console.log(`hardened ${DB}`);
