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
