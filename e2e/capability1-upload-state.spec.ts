import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

test('rejected upload preserves the accepted workbook while recording rejection audit history', async ({ page }) => {
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
  const acceptedState = JSON.parse(acceptedSnapshot!);
  const acceptedDataset = {
    sourceSheets: acceptedState.sourceSheets,
    sourceWorkbookHash: acceptedState.sourceWorkbookHash,
    workbookSource: acceptedState.workbookSource,
    datasetVersion: acceptedState.datasetVersion,
    activeSheet: acceptedState.activeSheet,
    activeLineage: acceptedState.lineageHistory?.find((record: { uploadStatus: string }) => record.uploadStatus === 'ACTIVE'),
  };

  await page.locator('#dpFileInput').setInputFiles({
    name: 'rejected_state_source.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU_Code,Calculated_Value\nSKU-REJECTED,=1+1'),
  });

  await expect(page.getByText(/Upload rejected:.*formula cell/i)).toBeVisible();
  await expect(page.getByText(/Source: accepted_state_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: rejected_state_source.csv/i)).not.toBeVisible();
  const afterRejectedUpload = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(afterRejectedUpload).toBeTruthy();
  const rejectedState = JSON.parse(afterRejectedUpload!);
  expect({
    sourceSheets: rejectedState.sourceSheets,
    sourceWorkbookHash: rejectedState.sourceWorkbookHash,
    workbookSource: rejectedState.workbookSource,
    datasetVersion: rejectedState.datasetVersion,
    activeSheet: rejectedState.activeSheet,
    activeLineage: rejectedState.lineageHistory?.find((record: { uploadStatus: string }) => record.uploadStatus === 'ACTIVE'),
  }).toEqual(acceptedDataset);
  expect(rejectedState.lineageHistory).toEqual(expect.arrayContaining([
    expect.objectContaining({ fileName: 'rejected_state_source.csv', uploadStatus: 'REJECTED' }),
  ]));
  expect(rejectedState.auditLog).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'Workbook Upload Rejected', fileName: 'rejected_state_source.csv' }),
  ]));

  await page.reload();
  await expect(page.getByText(/Source: accepted_state_source.csv/i)).toBeVisible();
  await expect(page.getByText(/Source: rejected_state_source.csv/i)).not.toBeVisible();
  const afterReload = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(afterReload).toBeTruthy();
  const reloadedState = JSON.parse(afterReload!);
  expect({
    sourceSheets: reloadedState.sourceSheets,
    sourceWorkbookHash: reloadedState.sourceWorkbookHash,
    workbookSource: reloadedState.workbookSource,
    datasetVersion: reloadedState.datasetVersion,
    activeSheet: reloadedState.activeSheet,
    activeLineage: reloadedState.lineageHistory?.find((record: { uploadStatus: string }) => record.uploadStatus === 'ACTIVE'),
  }).toEqual(acceptedDataset);
  expect(reloadedState.lineageHistory).toEqual(expect.arrayContaining([
    expect.objectContaining({ fileName: 'rejected_state_source.csv', uploadStatus: 'REJECTED' }),
  ]));
});
