import { test, expect } from '@playwright/test';

test('dashboard loads and shows metrics', async ({ page }) => {
  await page.goto('/signin?next=/dashboard');
  await expect(page.getByText('Dental Ledger Studio')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Outstanding balance')).toBeVisible();
});
