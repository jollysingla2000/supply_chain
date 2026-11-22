import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test('quota failure preserves the last durable workbook and restores it after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('#dpFileInput').setInputFiles({
    name: 'durable_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-DURABLE,25'),
  });
  await expect(page.getByText(/Source: durable_source.csv/i)).toBeVisible();

  const durableSnapshot = await page.evaluate(() =>
    localStorage.getItem('argon_phase1_governance_state_v2')
  );
  expect(durableSnapshot).toBeTruthy();

  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'argon_phase1_governance_state_v2') {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.locator('#dpFileInput').setInputFiles({
    name: 'session_only_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-SESSION,50'),
  });
  await expect(page.getByText(/Source: session_only_source.csv/i)).toBeVisible();
  await expect(page.getByText(/browser storage failed.*may not survive a refresh/i)).toBeVisible();

  const retainedSnapshot = await page.evaluate(() =>
    localStorage.getItem('argon_phase1_governance_state_v2')
  );
  expect(retainedSnapshot).toBe(durableSnapshot);

  await page.reload();
  await expect(page.getByText(/Source: durable_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: session_only_source.csv/i)).not.toBeVisible();
  await expect(page.getByText(/Saved workbook not restored/i)).not.toBeVisible();
});
