#!/usr/bin/env node
/**
 * LABEL: Step 3a — one-time / idempotent Postgres bootstrap
 * Creates roles (hospigo_owner, hospigo_app, hospigo_hq, hospigo_security),
 * databases (hospigo, hospigo_test), and revokes PUBLIC on schema public.
 * Runs as Postgres superuser via POSTGRES_SUPERUSER_URL from .env.
 * Passwords are read from .env only; never logged.
 *
 * Usage (Git Bash): node scripts/db/create-roles.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(root, '.env');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function upsertEnv(file, updates) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const next = lines.map((line) => {
    if (!line || line.startsWith('#')) return line;
    const i = line.indexOf('=');
    if (i === -1) return line;
    const key = line.slice(0, i).trim();
    if (!keys.has(key)) return line;
    keys.delete(key);
    return `${key}=${updates[key]}`;
  });
  for (const key of keys) {
    next.push(`${key}=${updates[key]}`);
  }
  fs.writeFileSync(
    file,
    `${next
      .filter((l, idx) => !(l === '' && idx === next.length - 1))
      .join('\n')
      .replace(/\n*$/, '\n')}`,
  );
}

function required(env, key) {
  const value = env[key];
  if (!value || value.includes('CHANGE_ME')) {
    throw new Error(`${key} must be set in .env (not CHANGE_ME)`);
  }
  return value;
}

function quoteIdent(id) {
  return `"${id.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildUrl({ user, password, host, port, database }) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function randomPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

const fileEnv = loadEnv(envPath);
const host = fileEnv.PGHOST || '127.0.0.1';
const port = fileEnv.PGPORT || '5432';

const generated = {};
for (const key of [
  'HOSPIGO_OWNER_PASSWORD',
  'HOSPIGO_APP_PASSWORD',
  'HOSPIGO_HQ_PASSWORD',
  'SEED_SUPERADMIN_PASSWORD',
  'SEED_BRANCH_ADMIN_PASSWORD',
  'SEED_STAFF_PASSWORD',
]) {
  if (!fileEnv[key] || fileEnv[key].includes('CHANGE_ME')) {
    generated[key] = randomPassword();
  }
}
if (Object.keys(generated).length > 0) {
  upsertEnv(envPath, generated);
  Object.assign(fileEnv, generated);
  console.log('Wrote generated DB/seed password keys to .env (values not printed).');
}

const ownerPassword = required(fileEnv, 'HOSPIGO_OWNER_PASSWORD');
const appPassword = required(fileEnv, 'HOSPIGO_APP_PASSWORD');
const hqPassword = required(fileEnv, 'HOSPIGO_HQ_PASSWORD');

const ownerUrl = buildUrl({
  user: 'hospigo_owner',
  password: ownerPassword,
  host,
  port,
  database: 'hospigo',
});
const appUrl = buildUrl({
  user: 'hospigo_app',
  password: appPassword,
  host,
  port,
  database: 'hospigo',
});
const appTestUrl = buildUrl({
  user: 'hospigo_app',
  password: appPassword,
  host,
  port,
  database: 'hospigo_test',
});
const ownerTestUrl = buildUrl({
  user: 'hospigo_owner',
  password: ownerPassword,
  host,
  port,
  database: 'hospigo_test',
});
const hqUrl = buildUrl({
  user: 'hospigo_hq',
  password: hqPassword,
  host,
  port,
  database: 'hospigo',
});

upsertEnv(envPath, {
  DATABASE_URL: appUrl,
  DATABASE_URL_OWNER: ownerUrl,
  DATABASE_URL_TEST: appTestUrl,
  DATABASE_URL_OWNER_TEST: ownerTestUrl,
  DATABASE_URL_HQ: hqUrl,
  PGHOST: host,
  PGPORT: port,
});

const superUrl = required({ ...fileEnv, ...loadEnv(envPath) }, 'POSTGRES_SUPERUSER_URL');

const client = new pg.Client({ connectionString: superUrl, connectionTimeoutMillis: 8000 });
await client.connect();

async function exec(sql) {
  await client.query(sql);
}

async function roleExists(name) {
  const r = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  return r.rowCount > 0;
}

async function ensureLoginRole(name, password, attrs) {
  if (await roleExists(name)) {
    await exec(
      `ALTER ROLE ${quoteIdent(name)} WITH LOGIN PASSWORD ${quoteLiteral(password)} ${attrs}`,
    );
    console.log(`updated_role ${name}`);
  } else {
    await exec(
      `CREATE ROLE ${quoteIdent(name)} WITH LOGIN PASSWORD ${quoteLiteral(password)} ${attrs}`,
    );
    console.log(`created_role ${name}`);
  }
}

async function ensureNoLoginRole(name, attrs) {
  if (await roleExists(name)) {
    await exec(`ALTER ROLE ${quoteIdent(name)} WITH NOLOGIN ${attrs}`);
    console.log(`updated_role ${name}`);
  } else {
    await exec(`CREATE ROLE ${quoteIdent(name)} WITH NOLOGIN ${attrs}`);
    console.log(`created_role ${name}`);
  }
}

async function ensureDatabase(name, owner) {
  const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (r.rowCount === 0) {
    await exec(`CREATE DATABASE ${quoteIdent(name)} OWNER ${quoteIdent(owner)}`);
    console.log(`created_database ${name}`);
  } else {
    await exec(`ALTER DATABASE ${quoteIdent(name)} OWNER TO ${quoteIdent(owner)}`);
    console.log(`ensured_database ${name}`);
  }
}

await ensureLoginRole(
  'hospigo_owner',
  ownerPassword,
  'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
);
await ensureLoginRole(
  'hospigo_app',
  appPassword,
  'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
);
await ensureLoginRole(
  'hospigo_hq',
  hqPassword,
  'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
);
await ensureNoLoginRole(
  'hospigo_security',
  'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
);

// Migration ALTERs SECURITY DEFINER functions OWNER TO hospigo_security (needs SET ROLE).
await exec('GRANT hospigo_security TO hospigo_owner WITH INHERIT FALSE, SET TRUE');
console.log('granted_set_role hospigo_security -> hospigo_owner');

await ensureDatabase('hospigo', 'hospigo_owner');
await ensureDatabase('hospigo_test', 'hospigo_owner');

for (const dbName of ['hospigo', 'hospigo_test']) {
  const admin = new URL(superUrl);
  admin.pathname = `/${dbName}`;
  const dbClient = new pg.Client({
    connectionString: admin.toString(),
    connectionTimeoutMillis: 8000,
  });
  await dbClient.connect();
  await dbClient.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await dbClient.query('GRANT USAGE, CREATE ON SCHEMA public TO hospigo_owner');
  await dbClient.query('GRANT USAGE ON SCHEMA public TO hospigo_app');
  await dbClient.query('GRANT USAGE ON SCHEMA public TO hospigo_hq');
  // CREATE required so ALTER FUNCTION ... OWNER TO hospigo_security can succeed.
  await dbClient.query('GRANT USAGE, CREATE ON SCHEMA public TO hospigo_security');
  await dbClient.query('ALTER SCHEMA public OWNER TO hospigo_owner');
  // Future functions: no PUBLIC EXECUTE by default (must be global — schema-scoped REVOKE is a no-op for this).
  await dbClient.query(
    'ALTER DEFAULT PRIVILEGES FOR ROLE hospigo_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  );
  await dbClient.query(
    'ALTER DEFAULT PRIVILEGES FOR ROLE hospigo_security REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  );
  await dbClient.end();
  console.log(`hardened_schema public on ${dbName}`);
}

// CONNECT: revoke PUBLIC; grant only login roles (hospigo_security is NOLOGIN).
for (const dbName of ['hospigo', 'hospigo_test']) {
  await exec(`REVOKE CONNECT ON DATABASE ${quoteIdent(dbName)} FROM PUBLIC`);
  await exec(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO hospigo_owner`);
  await exec(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO hospigo_app`);
  await exec(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO hospigo_hq`);
  console.log(`hardened_connect on ${dbName}`);
}

await client.end();
console.log('create-roles complete (passwords not printed).');
console.log('Firewall note: keep Postgres bound to private networks; do not expose 5432 publicly.');
