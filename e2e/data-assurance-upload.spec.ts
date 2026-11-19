import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('rejects formula-containing CSV and keeps the current workbook active', async ({ page }) => {
  await expect(page.getByText(/Step 1: Data Assurance/i)).toBeVisible();
  await page.locator('#dpFileInput').setInputFiles({
    name: 'formula_payload.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Calculated_Value\nSKU-1,=1+1'),
  });

  await expect(page.getByText(/Upload rejected:.*formula cell/i)).toBeVisible();
  await expect(page.getByText(/Source: Built-in Enterprise 12-Table Dataset/i)).toBeVisible();
});

test('rejects duplicate headers in CSV instead of silently renaming columns', async ({ page }) => {
  await page.locator('#dpFileInput').setInputFiles({
    name: 'duplicate_headers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,sku code\nSKU-1,SKU-2'),
  });

  await expect(page.getByText(/Upload rejected:.*duplicate column headers/i)).toBeVisible();
  await expect(page.getByText(/Source: Built-in Enterprise 12-Table Dataset/i)).toBeVisible();
});

test('uploads a source CSV and restores its identity after page reload', async ({ page }) => {
  await page.locator('#dpFileInput').setInputFiles({
    name: 'e2e_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-E2E,25'),
  });

  await expect(page.getByText(/Ingested 1 rows across 1 worksheet.*e2e_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: e2e_source.csv/i)).toBeVisible();

  await page.reload();

  await expect(page.getByText(/Source: e2e_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Saved workbook not restored/i)).not.toBeVisible();
});
