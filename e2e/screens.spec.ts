import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeSessions, sharedSession } from './helpers';

/**
 * Screen check (Step 9): the doctor consultation page, the reception New visit page and the OPD
 * queue at wide, laptop and phone widths. Screenshots go to e2e/.output/screens (never committed;
 * they hold fake demo data only). The one automatic check is "no sideways scrolling"; the rest
 * (wasted space, cut-off labels, misaligned buttons) is judged by looking at the pictures.
 */
test.describe.configure({ mode: 'serial' });
test.afterAll(closeSessions);

const SIZES = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390', width: 390, height: 844 },
];
const OUT = path.resolve(__dirname, '.output', 'screens');

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
}

let visitId = '';
let patientUrl = '';

test('prepare: a patient with a paid visit that the doctor has started', async ({ browser }) => {
  const page = await sharedSession(browser, 'reception');
  const doctor = await sharedSession(browser, 'doctor');
  const stamp = Date.now();
  await page.goto('/app/patients/new');
  await page.getByLabel('Full name *').fill(`E2E Screens ${stamp}`);
  await page.getByRole('button', { name: 'Age (not sure of the date of birth)' }).click();
  await page.getByLabel('Age in years').fill('44');
  await page.getByLabel('Phone *').fill(`9${String(stamp).slice(-9)}`);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.waitForURL(/\/app\/patients\/(?!new)[a-z0-9]+$/);
  patientUrl = page.url();
  await page.getByRole('link', { name: 'New visit' }).click();
  await page.getByRole('radio', { name: /Doctor North 2/ }).check();
  await page
    .getByRole('button', { name: /Take cash/ })
    .first()
    .click();
  await page.waitForURL(/\/receipt$/);
  visitId = page.url().split('/visits/')[1]!.split('/')[0]!;

  await doctor.goto(`/app/opd/visits/${visitId}/consult`);
  await doctor.getByRole('button', { name: 'Start consultation' }).click();
  await doctor.getByRole('button', { name: 'Save draft' }).waitFor();
});

for (const size of SIZES) {
  test(`doctor consultation page at ${size.name}`, async ({ browser }) => {
    const page = await sharedSession(browser, 'doctor');
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`/app/opd/visits/${visitId}/consult`);
    await page.getByRole('button', { name: 'Save draft' }).waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `consult-${size.name}.png`), fullPage: true });
    await noSidewaysScroll(page);
  });

  test(`reception New visit page at ${size.name}`, async ({ browser }) => {
    const page = await sharedSession(browser, 'reception');
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${patientUrl}/visits/new`);
    await page.getByRole('radio', { name: /Doctor North 3/ }).check();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `new-visit-${size.name}.png`), fullPage: true });
    await noSidewaysScroll(page);
  });

  test(`OPD queue at ${size.name}`, async ({ browser }) => {
    const page = await sharedSession(browser, 'reception');
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/app/opd');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, `queue-${size.name}.png`), fullPage: false });
    await noSidewaysScroll(page);
  });
}
