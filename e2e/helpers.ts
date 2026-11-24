import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { staffCopy } from '../apps/web/src/config/staff-copy';

/** The seeded demo users (fake hospitals; see docs/guides/dev-accounts.md). Passwords come from .env. */
export type DemoRole = 'reception' | 'nurse' | 'doctor' | 'superadmin' | 'branchadmin';

const ACCOUNTS: Record<
  DemoRole,
  {
    email: string;
    accessCode: string;
    passwordEnv: 'SEED_STAFF_PASSWORD' | 'SEED_SUPERADMIN_PASSWORD' | 'SEED_BRANCH_ADMIN_PASSWORD';
  }
> = {
  reception: {
    email: 'receptionist1@demo-north.example.test',
    accessCode: 'demo-north-main',
    passwordEnv: 'SEED_STAFF_PASSWORD',
  },
  nurse: {
    email: 'nurse1@demo-north.example.test',
    accessCode: 'demo-north-main',
    passwordEnv: 'SEED_STAFF_PASSWORD',
  },
  doctor: {
    email: 'doctor2@demo-north.example.test',
    accessCode: 'demo-north-main',
    passwordEnv: 'SEED_STAFF_PASSWORD',
  },
  superadmin: {
    email: 'superadmin@demo-north.example.test',
    accessCode: 'demo-north-main',
    passwordEnv: 'SEED_SUPERADMIN_PASSWORD',
  },
  branchadmin: {
    email: 'branchadmin@demo-north.example.test',
    accessCode: 'demo-north-main',
    passwordEnv: 'SEED_BRANCH_ADMIN_PASSWORD',
  },
};

export const copy = staffCopy;

/** Sign in through the real login page and wait for the application shell. */
export async function login(page: Page, role: DemoRole): Promise<void> {
  const account = ACCOUNTS[role];
  const password = process.env[account.passwordEnv];
  if (!password) {
    throw new Error(`${account.passwordEnv} is missing in .env (needed for the demo logins)`);
  }
  await page.goto('/login');
  await page.getByLabel(copy.auth.accessCode).fill(account.accessCode);
  await page.getByLabel(copy.auth.email).fill(account.email);
  await page.getByLabel(copy.auth.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: copy.auth.signIn, exact: true }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });
}

/** A fresh browser context per role, so each role has its own cookies. */
export async function signedIn(
  browser: import('@playwright/test').Browser,
  role: DemoRole,
  viewport?: { width: number; height: number },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await login(page, role);
  return { page, close: () => context.close() };
}

const sessions = new Map<DemoRole, { page: Page; close: () => Promise<void> }>();

/**
 * One signed-in browser page per role for the whole file. The login route is rate limited (20 a
 * minute per address), and a rotating refresh token must not be shared between pages, so a file signs
 * each role in ONCE and every test of the file reuses that page.
 */
export async function sharedSession(
  browser: import('@playwright/test').Browser,
  role: DemoRole,
): Promise<Page> {
  const existing = sessions.get(role);
  if (existing) {
    return existing.page;
  }
  const made = await signedIn(browser, role);
  sessions.set(role, made);
  return made.page;
}

export async function closeSessions(): Promise<void> {
  for (const s of sessions.values()) {
    await s.close();
  }
  sessions.clear();
}
