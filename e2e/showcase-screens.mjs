/* global document, window */
/**
 * Step 2.1f: screenshots of every role's dashboard and of the sample prints of the two showcase
 * hospitals at 1920x1080, 1366x768 and 390x844. Run it against the dev servers on the database hospigo
 * (npm run dev:reset, then both dev servers), with E2E_BASE_URL=http://127.0.0.1:3001:
 *
 *   node e2e/showcase-screens.mjs
 *
 * Pictures go to e2e/.output/showcase/ (never committed). It also prints a line for every picture
 * where the page scrolls sideways. Passwords come from .env and are never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { config } from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '..', '.env') });
const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';
const OUT = path.resolve(here, '.output', 'showcase');
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1366', width: 1366, height: 768 },
  { name: '390', width: 390, height: 844 },
];
const PASSWORDS = {
  SUPER_ADMIN: process.env.SEED_SUPERADMIN_PASSWORD,
  BRANCH_ADMIN: process.env.SEED_BRANCH_ADMIN_PASSWORD,
  RECEPTIONIST: process.env.SEED_STAFF_PASSWORD,
  NURSE: process.env.SEED_STAFF_PASSWORD,
  DOCTOR: process.env.SEED_STAFF_PASSWORD,
};
const ONLY = (process.env.SHOT_HOSPITALS || 'NANDAVANA,SAGARIKA').split(',');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
await db.connect();

async function people(code) {
  const r = await db.query(
    `SELECT r.code AS role, min(u.email) AS email
       FROM role_assignments ra
       JOIN roles r ON r.id = ra.role_id AND r.tenant_id = ra.tenant_id
       JOIN users u ON u.id = ra.user_id AND u.tenant_id = ra.tenant_id
       JOIN hospitals h ON h.id = ra.tenant_id
      WHERE ra.is_active AND h.code = $1 GROUP BY r.code`,
    [code],
  );
  return Object.fromEntries(r.rows.map((x) => [x.role, x.email]));
}
async function mainAccessCode(code) {
  const r = await db.query(
    `SELECT b.access_code FROM branches b JOIN hospitals h ON h.id = b.tenant_id WHERE h.code = $1 AND b.is_main`,
    [code],
  );
  return r.rows[0].access_code;
}
async function sample(code) {
  const r = await db.query(
    `SELECT v.id AS visit_id, v.patient_id FROM opd_visits v JOIN hospitals h ON h.id = v.tenant_id
      WHERE h.code = $1 AND v.status = 'COMPLETED' ORDER BY v.created_at DESC LIMIT 1`,
    [code],
  );
  return r.rows[0];
}

const browser = await chromium.launch({ channel: 'chrome' });
const sideways = [];

async function shoot(page, label) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(400);
    const file = path.join(OUT, `${label}-${size.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (wide) {
      sideways.push(`${label}-${size.name}`);
    }
  }
}

async function signIn(context, accessCode, email, password) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Access code').fill(accessCode);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 30000 });
  return page;
}

for (const code of ONLY) {
  const access = await mainAccessCode(code);
  const who = await people(code);
  const ids = await sample(code);
  const roles = ['SUPER_ADMIN', 'BRANCH_ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR'];
  for (const role of roles) {
    if (!who[role]) {
      continue;
    }
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await signIn(context, access, who[role], PASSWORDS[role]);
    await page.goto(`${BASE}/app`);
    await page
      .waitForSelector('.kpi-card, [role="alert"]', { timeout: 30000 })
      .catch(() => undefined);
    await shoot(page, `${code}-dash-${role}`);
    if (role === 'SUPER_ADMIN') {
      for (const [name, route] of [
        ['queue', '/app/opd'],
        ['refunds', '/app/opd/refunds'],
        ['report', '/app/opd/reports'],
        ['patients', '/app/patients'],
        ['visit-new', '/app/patients/new'],
        ['settings', '/app/settings'],
      ]) {
        await page.goto(`${BASE}${route}`);
        await page.waitForTimeout(1500);
        await shoot(page, `${code}-page-${name}`);
      }
      const prints = [
        ['slip', `/app/patients/${ids.patient_id}/slip`],
        ['card', `/app/patients/${ids.patient_id}/card`],
        ['receipt', `/app/opd/visits/${ids.visit_id}/receipt`],
        ['prescription', `/app/opd/visits/${ids.visit_id}/prescription`],
        ['report', `/app/opd/visits/${ids.visit_id}/report`],
      ];
      for (const [name, route] of prints) {
        await page.goto(`${BASE}${route}`);
        await page.waitForTimeout(3500);
        await shoot(page, `${code}-print-${name}`);
      }
    }
    await context.close();
  }
}
// HQ pages (Phase 2.2): sign in with an empty access code
if (process.env.SHOT_HQ !== '0' && process.env.SEED_INDIGO_PASSWORD) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('hq.admin@indigo.example.org');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_INDIGO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/admin/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await shoot(page, 'HQ-home');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await page.waitForTimeout(2000);
  await shoot(page, 'HQ-hospital');
  for (const [name, route] of [
    ['onboard', '/admin/onboard'],
    ['staff', '/admin/employees'],
  ]) {
    await page.goto(`${BASE}${route}`);
    await page.waitForTimeout(1500);
    await shoot(page, `HQ-${name}`);
  }
  await context.close();
}
await browser.close();
await db.end();
console.log(
  sideways.length ? `Sideways scrolling in: ${sideways.join(', ')}` : 'No sideways scrolling.',
);
console.log(`Pictures are in ${OUT}`);
