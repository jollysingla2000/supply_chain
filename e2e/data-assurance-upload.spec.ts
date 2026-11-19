import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('rejects formula-containing CSV and keeps the current workbook active', async ({ page }) => {
  await page.locator('#dpFileInput').waitFor({ state: 'attached' });
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

test('assigns an exception owner, records SLA deadline, and restores assignment after reload', async ({ page }) => {
  const ownerSelect = page.locator('select[aria-label^="Assign owner for"]').first();
  await expect(ownerSelect).toBeVisible();
  await ownerSelect.selectOption('Master Data Steward');

  const statusSelect = page.locator('select[aria-label^="Set assignment status for"]').first();
  await expect(statusSelect).toHaveValue('IN_REVIEW');
  await expect(page.getByText(/Due • .*\(4h SLA\)|Due • .*\(24h SLA\)/).first()).toBeVisible();

  await page.reload();
  await expect(page.locator('select[aria-label^="Assign owner for"]').first()).toHaveValue('Master Data Steward');
  await expect(page.locator('select[aria-label^="Set assignment status for"]').first()).toHaveValue('IN_REVIEW');
});

test('preserves corrupt saved state until explicit workbook recovery', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('argon_phase1_governance_state_v2', '{broken-json'));
  await page.reload();

  await expect(page.getByRole('alert').filter({ hasText: /Saved workbook not restored/i })).toBeVisible();
  await expect(page.getByText(/Source: Built-in Enterprise 12-Table Dataset/i)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: /Saved workbook not restored/i })).toBeVisible();

  await page.locator('#dpFileInput').setInputFiles({
    name: 'recovery_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-RECOVERY,10'),
  });
  await expect(page.getByText(/Ingested 1 rows across 1 worksheet.*recovery_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Saved workbook not restored/i)).not.toBeVisible();
  await expect(page.getByText(/Source: recovery_source.csv/i)).toBeVisible();
});

test('a rejected subsequent upload does not replace the last accepted workbook', async ({ page }) => {
  await page.locator('#dpFileInput').setInputFiles({
    name: 'accepted_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-ACCEPTED,25'),
  });
  await expect(page.getByText(/Source: accepted_source.csv/i)).toBeVisible();

  await page.locator('#dpFileInput').setInputFiles({
    name: 'rejected_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Calculated\nSKU-REJECTED,=1+1'),
  });
  await expect(page.getByText(/Upload rejected:.*formula cell/i)).toBeVisible();
  await expect(page.getByText(/Source: accepted_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: rejected_source.csv/i)).not.toBeVisible();

  await page.reload();
  await expect(page.getByText(/Source: accepted_source.csv/i)).toBeVisible();
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
