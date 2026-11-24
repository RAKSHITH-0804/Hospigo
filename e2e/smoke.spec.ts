import { expect, test, type Page } from '@playwright/test';
import { closeSessions, sharedSession } from './helpers';

/**
 * The main OPD flow, end to end in a real browser, with the seeded DEMO users (fake hospitals).
 * One serial run: every step uses what the step before it made. Each test makes its own patient with
 * a unique name and phone, so the suite can be run again and again. Each role signs in once and the
 * file reuses that page (the login route is rate limited).
 *
 * Screen words are typed here on purpose (a test must break when the words on a screen change by
 * accident); the application itself keeps all its words in the copy file.
 */
test.describe.configure({ mode: 'serial' });
test.afterAll(closeSessions);

const stamp = Date.now();
let seq = 0;

async function registerPatient(page: Page, label: string): Promise<{ name: string; url: string }> {
  seq += 1;
  const name = `E2E ${label} ${stamp}${seq}`;
  await page.goto('/app/patients/new');
  await page.getByLabel('Full name *').fill(name);
  await page.getByLabel('Age in years').fill('34');
  await page.getByLabel('Phone *').fill(`9${String(stamp + seq).slice(-9)}`);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.waitForURL(/\/app\/patients\/(?!new)[a-z0-9]+$/);
  return { name, url: page.url() };
}

/** New visit for the patient page that is open, with cash. Returns the visit id (from the receipt address). */
async function takeVisitWithCash(page: Page, doctor: RegExp): Promise<string> {
  await page.getByRole('link', { name: 'New visit' }).click();
  await page.getByRole('radio', { name: doctor }).check();
  await page
    .getByRole('button', { name: /Take cash/ })
    .first()
    .click();
  await page.waitForURL(/\/receipt$/);
  return page.url().split('/visits/')[1]!.split('/')[0]!;
}

let patientName = '';
let visitId = '';

test('reception registers a patient and takes a visit with cash payment', async ({ browser }) => {
  const page = await sharedSession(browser, 'reception');
  const patient = await registerPatient(page, 'Smoke');
  patientName = patient.name;
  visitId = await takeVisitWithCash(page, /Doctor North 2/);
  const receipt = page.locator('main');
  await expect(receipt).toContainText(patientName);
  await expect(receipt).toContainText('Token: T');
  await expect(receipt).toContainText('Paid');
  await expect(receipt).toContainText('Payment: Cash');
});

test('the nurse records vitals', async ({ browser }) => {
  const nurse = await sharedSession(browser, 'nurse');
  await nurse.goto(`/app/opd/visits/${visitId}/vitals`);
  await nurse.getByLabel('Pulse: New value').fill('82');
  await nurse.getByLabel('Temperature: New value').fill('98.6');
  await nurse.getByRole('button', { name: /Save vitals/ }).click();
  await expect(nurse.locator('main')).toContainText('Current: 82 bpm');
});

test('the doctor writes a consultation, completes it, and the prescription print opens', async ({
  browser,
}) => {
  const doctor = await sharedSession(browser, 'doctor');
  // never open the real print dialog in a test
  await doctor.addInitScript(() => {
    window.print = () => undefined;
  });
  await doctor.goto(`/app/opd/visits/${visitId}/consult`);
  await doctor.getByRole('button', { name: 'Start consultation' }).click();
  await doctor.getByRole('button', { name: 'Save draft' }).waitFor();
  await doctor.getByLabel('Complaints').fill('Fever and cough for two days');
  await doctor.getByLabel('Diagnosis').fill('Viral fever');
  await doctor.getByRole('button', { name: 'Complete consultation' }).click();
  await expect(doctor.locator('main')).toContainText('This consultation is completed');
  const printHref = await doctor
    .getByRole('link', { name: 'Print prescription' })
    .getAttribute('href');
  expect(printHref).toBeTruthy();
  await doctor.goto(printHref!);
  await expect(doctor.locator('body')).toContainText(patientName);
  await expect(doctor.locator('body')).toContainText('Viral fever');
});

test('reception asks to cancel a visit and an Admin approves it', async ({ browser }) => {
  const page = await sharedSession(browser, 'reception');
  const patient = await registerPatient(page, 'Cancel');
  await takeVisitWithCash(page, /Doctor North 3/);
  await page.goto(patient.url);
  await page.getByText('Visits', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Cancel visit' }).first().click();
  await page.getByLabel('Reason').fill('Doctor busy');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('main')).toContainText('Cancellation requested');
  // the visit stays in the queue until an Admin decides
  await expect(page.locator('main')).toContainText('Waiting');

  const admin = await sharedSession(browser, 'superadmin');
  await admin.goto('/app/opd/refunds');
  const row = admin.getByRole('row').filter({ hasText: patient.name });
  await row.getByRole('button', { name: /Approve the request/ }).click();
  // the screen asks once more before the money goes back
  await row.getByRole('button', { name: /^Approve and return/ }).click();
  await expect(admin.getByRole('row').filter({ hasText: patient.name })).toHaveCount(0, {
    timeout: 15_000,
  });

  // the visit is now cancelled and its token shows it
  await page.goto(patient.url);
  await page.getByText('Visits', { exact: true }).first().click();
  await expect(page.locator('main')).toContainText(/cancelled/i);
});

test('the SuperAdmin switches branch and back', async ({ browser }) => {
  const admin = await sharedSession(browser, 'superadmin');
  await admin.goto('/app/opd/refunds');
  const switcher = admin.getByRole('button', { name: 'Switch branch' });
  await expect(switcher).toContainText('Main Branch');
  await switcher.click();
  await admin.getByRole('menu').getByText('East Wing', { exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Switch branch' })).toContainText('East Wing', {
    timeout: 20_000,
  });
  await admin.goto('/app/settings/doctors');
  await expect(admin.getByRole('button', { name: 'Switch branch' })).toContainText('East Wing');
  // and back
  await admin.getByRole('button', { name: 'Switch branch' }).click();
  await admin.getByRole('menu').getByText('Main Branch', { exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Switch branch' })).toContainText('Main Branch', {
    timeout: 20_000,
  });
});
