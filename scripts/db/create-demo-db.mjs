#!/usr/bin/env node
/**
 * Step 2.1f: creates the separate SHOWCASE database `hospigo_demo` (idempotent), hardened like the
 * others, and adds DATABASE_URL_DEMO and DATABASE_URL_OWNER_DEMO to .env (the same users as the test
 * database, only the database name differs). It does not touch roles or passwords.
 * Needs POSTGRES_SUPERUSER_URL in .env. Never prints a password.
 *
 * Usage (Git Bash or PowerShell): node scripts/db/create-demo-db.mjs
 * Then: migrate it and seed it (see docs/guides/dev-commands.md, "Showcase database").
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const DB = 'hospigo_demo';
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
const swapDb = (url) => {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
};
const quote = (s) => `"${s.replace(/"/g, '""')}"`;

const superUrl = need('POSTGRES_SUPERUSER_URL');
const client = new pg.Client({ connectionString: superUrl, connectionTimeoutMillis: 8000 });
await client.connect();
if (process.argv.includes('--reset')) {
  // drop it completely (demo:reset): every demo hospital and all its history goes
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

const updates = {
  DATABASE_URL_DEMO: swapDb(need('DATABASE_URL_TEST')),
  DATABASE_URL_OWNER_DEMO: swapDb(need('DATABASE_URL_OWNER_TEST')),
};
const kept = lines.filter((l) => !Object.keys(updates).some((k) => l.startsWith(`${k}=`)));
while (kept.length && kept[kept.length - 1] === '') kept.pop();
for (const [k, v] of Object.entries(updates)) kept.push(`${k}=${v}`);
fs.writeFileSync(envPath, `${kept.join('\n')}\n`);
console.log('DATABASE_URL_DEMO and DATABASE_URL_OWNER_DEMO written to .env (not printed).');
