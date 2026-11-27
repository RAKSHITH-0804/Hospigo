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

test.describe('HQ sign in (one form, a blank access code)', () => {
  test('an HQ Admin signs in without an access code and sees the hospitals list, with no way into a hospital', async ({
    page,
  }) => {
    const password = process.env.SEED_INDIGO_PASSWORD;
    test.skip(!password, 'SEED_INDIGO_PASSWORD is not set: no demo HQ people');
    await page.goto('/login');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByLabel('Email').fill('hq.admin@indigo.example.org');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // the list of real hospitals, not a sample
    await page.waitForURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Hospitals' })).toBeVisible();
    await expect(page.getByText('Demo North Clinic', { exact: true })).toBeVisible();
    // HQ never enters a hospital: no Enter button, and the hospital area refuses an HQ session
    await expect(page.getByRole('button', { name: /enter hospital/i })).toHaveCount(0);
    await page.goto('/app');
    await expect(page).not.toHaveURL(/\/app(\/|$)/);
  });
});
