import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  calcLeaveOneOutSigma,
  calcRowAccuracyPct,
  calcWmapeAccuracy,
  evaluateDemandMetrics,
} from './calculations';
import { runIndependentFormulaTests } from './formulaTests';
import { createSeededEnterpriseSheets } from './schema';
import { escapeHtml, hasUnsafePayload, sanitizeCellText } from './security';
import {
  applyFixToSheets,
  evaluateReleaseGate,
  validateWorkbookRecords,
} from './validation';
import { buildWorkbookBinary, ingestWorkbookBuffer } from './workbook';

test('all 12 independent formula verification tests pass through real calculation engine', () => {
  const results = runIndependentFormulaTests();
  assert.equal(results.length, 12);
  for (const tc of results) {
    assert.equal(tc.passed, true, `Formula test ${tc.id} (${tc.name}) failed: expected "${tc.expected}", got "${tc.actual}"`);
  }
});

test('zero-sales rule enforces N/A accuracy even when Actual = 0 and Forecast = 0, while unit error = 0', () => {
  assert.equal(calcRowAccuracyPct(0, 0), null);
  assert.equal(calcRowAccuracyPct(0, 250), null);
  assert.equal(calcWmapeAccuracy([0, 0], [0, 0]), null);

  const evalZeroZero = evaluateDemandMetrics(0, 0, 0, 100);
  assert.equal(evalZeroZero.accuracyPct, null);
  assert.equal(evalZeroZero.accuracyLabel, 'N/A');
  assert.equal(evalZeroZero.unitError, 0);
  assert.equal(evalZeroZero.absError, 0);

  const evalZeroPos = evaluateDemandMetrics(0, 120, 0, 100);
  assert.equal(evalZeroPos.accuracyPct, null);
  assert.equal(evalZeroPos.accuracyLabel, 'N/A');
  assert.equal(evalZeroPos.unitError, 120);
});

test('leave-one-out sigma calculation detects spikes mathematically without hardcoded outputs', () => {
  const baselineSeries = [100, 102, 98, 101, 99, 500, 100];
  const res = calcLeaveOneOutSigma(baselineSeries, 5);
  assert.ok(res.looMean > 99 && res.looMean < 101);
  assert.ok(res.zScore > 100);
});

test('business-key duplicate detection catches same Period|SKU|Depot|Channel even when metadata & quantities differ', () => {
  const sheets = createSeededEnterpriseSheets();
  // Seed already contains INV-1041 and INV-1042-DUP with different Invoice_Line_ID and Ordered_Qty_Units
  const errs = validateWorkbookRecords(sheets);
  const dupErrs = errs.filter((e) => e.fixType === 'REMOVE_DUPLICATE');
  assert.ok(dupErrs.length >= 1);
  assert.equal(dupErrs[0].severity, 'CRITICAL');
  assert.match(dupErrs[0].issue, /Duplicate Business-Key Record/);
});

test('missing period continuity detects both monthly and weekly demand series gaps', () => {
  const sheets = createSeededEnterpriseSheets();
  // Seeded monthly series has 2025-05-01 and 2025-07-01 for SKU_DAIRY_03 | Kolkata | GT -> missing 2025-06-01
  const monthlyErrs = validateWorkbookRecords(sheets).filter(
    (e) => e.fixType === 'IMPUTE_MISSING_PERIOD'
  );
  assert.ok(monthlyErrs.some((e) => e.missingPeriodMeta?.periodDate === '2025-06-01'));

  // Now test weekly continuity detection
  const weeklySheets = createSeededEnterpriseSheets();
  weeklySheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2026-01-05', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoiced_Actual_Qty: 500 },
    { Period_Date: '2026-01-19', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoiced_Actual_Qty: 520 },
    { Period_Date: '2026-01-26', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoiced_Actual_Qty: 510 },
  ];
  const weeklyErrs = validateWorkbookRecords(weeklySheets).filter(
    (e) => e.fixType === 'IMPUTE_MISSING_PERIOD'
  );
  assert.equal(weeklyErrs.length, 1);
  assert.equal(weeklyErrs[0].missingPeriodMeta?.periodDate, '2026-01-12');
  assert.match(weeklyErrs[0].issue, /Missing Weekly Demand Period/);
});

test('cross-table validation detects orphan SKU, orphan Depot, orphan Channel, NPI ref, and UOM mismatch', () => {
  const sheets = createSeededEnterpriseSheets();
  const errs = validateWorkbookRecords(sheets);

  assert.ok(errs.some((e) => e.fixType === 'MAP_SKU' && e.badVal.includes('SKU_LEGACY_999')));
  assert.ok(errs.some((e) => e.fixType === 'MAP_DEPOT' && e.badVal.includes('East_Sub_DC_99')));
  assert.ok(errs.some((e) => e.fixType === 'MAP_CHANNEL' && e.badVal.includes('B2B_EXP')));
  assert.ok(errs.some((e) => e.fixType === 'FIX_NPI_REF'));
  assert.ok(errs.some((e) => e.fixType === 'FIX_UOM'));
});

test('release gate strictly blocks Step 2 whenever critical blockers > 0 and cannot be bypassed', () => {
  const sheets = createSeededEnterpriseSheets();
  const errs = validateWorkbookRecords(sheets);
  const critCount = errs.filter((e) => e.severity === 'CRITICAL').length;
  assert.ok(critCount > 0);

  // Even if a warning sign-off object is passed, Step 2 MUST remain locked when critical blockers exist
  const gateBlocked = evaluateReleaseGate(errs, {
    approver: 'VP Supply Chain',
    reason: 'Trying to bypass critical errors',
    expiry: '24 Hours',
    signedAt: '2026-11-18 10:00',
  });
  assert.equal(gateBlocked.step2Unlocked, false);
  assert.equal(gateBlocked.status, 'BLOCKED');

  // Fix only CRITICAL exceptions; warnings may remain
  let workingSheets = sheets;
  let guard = 0;
  while (guard < 50) {
    const currentErrs = validateWorkbookRecords(workingSheets);
    const nextCrit = currentErrs.find((e) => e.severity === 'CRITICAL');
    if (!nextCrit) break;
    workingSheets = applyFixToSheets(workingSheets, nextCrit);
    guard++;
  }
  const afterCritFix = validateWorkbookRecords(workingSheets);
  assert.equal(afterCritFix.filter((e) => e.severity === 'CRITICAL').length, 0);

  const gateUnlocked = evaluateReleaseGate(afterCritFix, null);
  assert.equal(gateUnlocked.step2Unlocked, true);
});

test('auto-healing all anomalies resolves 100% of exceptions cleanly without infinite loops', () => {
  let workingSheets = createSeededEnterpriseSheets();
  let guard = 0;
  while (guard < 100) {
    const errs = validateWorkbookRecords(workingSheets);
    if (errs.length === 0) break;
    workingSheets = applyFixToSheets(workingSheets, errs[0]);
    guard++;
  }
  const remaining = validateWorkbookRecords(workingSheets);
  assert.equal(remaining.length, 0);
});

test('workbook security escapes HTML/XSS payloads and flags injected cells', () => {
  const xss = `<img src=x onerror="alert(1)"><script>fetch('evil')</script>`;
  const escaped = escapeHtml(xss);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('<img'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.equal(hasUnsafePayload(xss), true);
  assert.equal(sanitizeCellText('<script>alert(1)</script>SKU_SAFE'), 'SKU_SAFE');

  const sheets = createSeededEnterpriseSheets();
  sheets['09_Product_Master_Hierarchy'].records[0].SKU_Description = xss;
  const errs = validateWorkbookRecords(sheets);
  const secErr = errs.find((e) => e.fixType === 'SANITIZE_CELL');
  assert.ok(secErr);
  assert.equal(secErr.severity, 'CRITICAL');

  const cleaned = applyFixToSheets(sheets, secErr);
  assert.equal(hasUnsafePayload(cleaned['09_Product_Master_Hierarchy'].records[0].SKU_Description), false);
});

test('multi-sheet workbook export and ingestion preserves ALL worksheets in schema', () => {
  const seeded = createSeededEnterpriseSheets();
  const binary = buildWorkbookBinary(seeded);
  const ingested = ingestWorkbookBuffer(binary, 'Full_12_Table_Export.xlsx');

  assert.equal(ingested.sheetCount, 12);
  assert.equal(Object.keys(ingested.sheets).length, 12);
  assert.ok(ingested.sheets['01_Orders_Shipments_History']);
  assert.ok(ingested.sheets['09_Product_Master_Hierarchy']);
  assert.ok(ingested.sheets['12_NPI_Lifecycle_Transitions']);

  // Also test custom multi-sheet workbook where sheet 2 & 3 are non-canonical names
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Period_Date: '2026-01-01', SKU_Code: 'A1', Invoiced_Actual_Qty: 100 }]), 'Orders_Sheet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ SKU_Code: 'A1', Base_UOM: 'EA' }]), 'Product_Sheet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Location_DC: 'Mumbai' }]), 'Depot_Sheet');
  const customBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const customIngested = ingestWorkbookBuffer(customBuf, 'Custom_3_Sheets.xlsx');
  assert.equal(customIngested.sheetCount, 3);
  assert.deepEqual(Object.keys(customIngested.sheets), ['Orders_Sheet', 'Product_Sheet', 'Depot_Sheet']);
});
