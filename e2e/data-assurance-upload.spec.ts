import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';
import { readFile } from 'node:fs/promises';

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

test('restores the selected worksheet in a multi-sheet workbook after reload', async ({ page }) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ SKU_Code: 'SKU-ALPHA', Ordered_Qty_Units: 10 }]),
    '01_Orders_Shipments_History'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ SKU_Code: 'SKU-BETA', Ordered_Qty_Units: 20 }]),
    '09_Product_Master_Hierarchy'
  );
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  await page.locator('#dpFileInput').setInputFiles({
    name: 'two_sheet_source.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: fileBuffer,
  });
  await expect(page.getByText(/Ingested 2 rows across 2 worksheet.*two_sheet_source.xlsx/i)).toBeVisible();

  const savedTableKeys = await page.evaluate(() => {
    const raw = localStorage.getItem('argon_phase1_governance_state_v2');
    return raw ? Object.keys(JSON.parse(raw).sourceSheets ?? {}) : [];
  });
  await page.getByRole('tab').filter({ hasText: /1E\. Enterprise Schema, Lineage & Preview/i }).click();
  const productMasterButton = page.locator('button').filter({ hasText: '09_Product_Master_Hierarchy' }).first();
  await expect(productMasterButton).toBeVisible();
  await productMasterButton.click();
  await expect(productMasterButton).toHaveClass(/bg-blue-50/);

  await page.reload();
  await page.getByRole('tab').filter({ hasText: /1E\. Enterprise Schema, Lineage & Preview/i }).click();
  const restoredProductMasterButton = page.locator('button').filter({ hasText: '09_Product_Master_Hierarchy' }).first();
  await expect(restoredProductMasterButton).toBeVisible();
  await expect(restoredProductMasterButton).toHaveClass(/bg-blue-50/);
  await expect(page.getByText(/Source: two_sheet_source.xlsx/i)).toBeVisible();
});

test('warns visibly when browser persistence fails after an accepted upload', async ({ page }) => {
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
    name: 'storage_failure_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Ordered_Qty_Units\nSKU-STORAGE,25'),
  });

  await expect(page.getByText(/Source: storage_failure_source.csv/i)).toBeVisible();
  await expect(page.getByText(/browser storage failed.*may not survive a refresh/i)).toBeVisible();
});

test('exports retained audit trail as a clearly labelled JSON file', async ({ page }) => {
  const step6Nav = page.getByRole('button', { name: /Step 6.*Value KPIs & Audit Trail/i }).last();
  await step6Nav.click();
  await expect(page.getByRole('region', { name: 'Step 6 Audit Trail' })).toBeVisible();
  const exportButton = page.getByRole('button', { name: /Export retained audit log as JSON/i });
  await expect(exportButton).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^argon_audit_log_.*\.json$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const payload = JSON.parse(await readFile(filePath!, 'utf8')) as {
    recordCount: number;
    retentionNote: string;
    records: Array<{ user: string; evt: string }>;
  };
  expect(payload.recordCount).toBeGreaterThan(0);
  expect(payload.records.length).toBe(payload.recordCount);
  expect(payload.retentionNote).toMatch(/not a server-authenticated/i);
  expect(payload.records[0].user).toMatch(/UNAUTHENTICATED|SYSTEM/i);
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
