/**
 * Optional helper: an ISOLATED stack for the browser tests, so they never touch your dev servers or
 * your dev database. It starts the built API on port 3100 and the web app on port 3101, both
 * pointed at `hospigo_test` (the database that Jest uses). Seed the demo users into it first:
 *
 *   npm run e2e:seed-test      (once; fake demo hospitals only, marked as test hospitals)
 *   npm run build -w @hospigo/api
 *   npm run e2e:stack          (leave it running)
 *   $env:E2E_BASE_URL="http://127.0.0.1:3101"; npm run e2e
 *
 * Passwords and URLs come from `.env`; nothing secret is printed or written anywhere.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '.env') });

function testUrl(key, fallbackKey) {
  const raw = process.env[key] || (fallbackKey ? process.env[fallbackKey] : undefined);
  if (!raw) {
    throw new Error(`${key} is required (set it in .env)`);
  }
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

const root = path.resolve(here, '..');
const common = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: testUrl('DATABASE_URL_TEST', 'DATABASE_URL'),
  DATABASE_URL_HQ: testUrl('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: testUrl('DATABASE_URL_PATIENT'),
};

const api = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
  cwd: path.join(root, 'apps/api'),
  env: { ...common, API_PORT: '3100', CORS_ORIGIN: 'http://127.0.0.1:3101' },
  stdio: 'inherit',
});
const web = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'dev', '--port', '3101'],
  {
    cwd: path.join(root, 'apps/web'),
    env: {
      ...common,
      API_INTERNAL_URL: 'http://127.0.0.1:3100',
      APP_URL: 'http://127.0.0.1:3101',
      NEXT_DIST_DIR: '.next-e2e',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
for (const child of [api, web]) {
  child.on('exit', (code) => {
    console.log(`child exited with ${code}; stopping the test stack`);
    api.kill();
    web.kill();
    process.exit(code ?? 0);
  });
}
process.on('SIGINT', () => {
  api.kill();
  web.kill();
  process.exit(0);
});
