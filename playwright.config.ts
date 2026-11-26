import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@playwright/test';

loadEnv({ path: path.resolve(__dirname, '.env') });

/**
 * Browser smoke tests (Step 9). Run locally, NOT in CI:
 *
 *   npm run e2e                       against the dev servers (web http://127.0.0.1:3001)
 *   $env:E2E_BASE_URL="http://127.0.0.1:3101"; npm run e2e    against the isolated stack (e2e/test-stack.cjs)
 *
 * They sign in with the seeded DEMO users only (fake hospitals). Passwords come from `.env`
 * (SEED_STAFF_PASSWORD, SEED_SUPERADMIN_PASSWORD); nothing secret is written anywhere. The tests use
 * the installed Google Chrome, so no browser download is needed. See docs/guides/e2e.md.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e'),
  testMatch: /.*\.spec\.ts/,
  outputDir: path.resolve(__dirname, 'e2e/.output'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3001',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 768 },
  },
});
