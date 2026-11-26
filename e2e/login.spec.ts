import { expect, test } from '@playwright/test';
import { login, type DemoRole } from './helpers';

const ROLES: DemoRole[] = ['reception', 'nurse', 'doctor', 'superadmin'];

test.describe('sign in', () => {
  for (const role of ROLES) {
    test(`${role} signs in and reaches the application`, async ({ page }) => {
      await login(page, role);
      await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    });
  }
});

test.describe('Indigo sign in (one form, a blank access code)', () => {
  test('an Indigo owner signs in without an access code, enters a hospital and works inside it', async ({
    page,
  }) => {
    const password = process.env.SEED_INDIGO_PASSWORD;
    test.skip(!password, 'SEED_INDIGO_PASSWORD is not set: no demo Indigo people');
    await page.goto('/login');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByLabel('Email').fill('owner@indigo-demo.example.test');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // the list of real hospitals, not a sample
    await page.waitForURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Hospitals' })).toBeVisible();
    // a specific hospital by name (the list may hold other hospitals), never "the first one"
    const card = page
      .getByRole('heading', { name: 'Demo North Clinic' })
      .locator('xpath=ancestor::*[.//button[normalize-space()="Enter hospital"]][1]');
    await card.getByRole('button', { name: 'Enter hospital' }).click();
    await page.waitForURL(/\/app/);
    await expect(page.locator('body')).toContainText('(Indigo)');
    // the Indigo owner may change printouts: the Printing page is not read-only
    await page.goto('/app/settings/printing');
    await expect(page.locator('body')).not.toContainText('are set up for you by Indigo');
  });
});
