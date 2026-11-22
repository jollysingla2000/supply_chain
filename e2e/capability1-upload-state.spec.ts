import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test('rejected upload leaves the accepted workbook and persisted governance snapshot unchanged', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('#dpFileInput').setInputFiles({
    name: 'accepted_state_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-STATE,42'),
  });
  await expect(page.getByText(/Source: accepted_state_source.csv/i)).toBeVisible();

  const storageKey = 'argon_phase1_governance_state_v2';
  const acceptedSnapshot = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(acceptedSnapshot).toBeTruthy();

  await page.locator('#dpFileInput').setInputFiles({
    name: 'rejected_state_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Calculated_Value\nSKU-REJECTED,=1+1'),
  });

  await expect(page.getByText(/Upload rejected:.*formula cell/i)).toBeVisible();
  await expect(page.getByText(/Source: accepted_state_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: rejected_state_source.csv/i)).not.toBeVisible();
  const afterRejectedUpload = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(afterRejectedUpload).toBe(acceptedSnapshot);

  await page.reload();
  await expect(page.getByText(/Source: accepted_state_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: rejected_state_source.csv/i)).not.toBeVisible();
  const afterReload = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(afterReload).toBe(acceptedSnapshot);
});
