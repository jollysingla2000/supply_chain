import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  calcBullwhipRatio,
  calcCumulativeBias,
  calcLeaveOneOutSigma,
  calcRowAccuracyPct,
  calcWeeklyOrderConsumption,
  calcWmapeAccuracy,
  evaluateDemandMetrics,
} from './calculations';
import { runIndependentFormulaTests } from './formulaTests';
import { createSeededEnterpriseSheets } from './schema';
import { escapeHtml, hasUnsafePayload, sanitizeCellText } from './security';
import { ApprovedCorrection } from './types';
import {
  applyApprovedCorrections,
  applySafeTechnicalFixes,
  computeSignOffExpiryIso,
  evaluateReleaseGate,
  parseFlexibleDate,
  validateWorkbook,
} from './validation';
import { buildWorkbookBinary, ingestWorkbookBuffer } from './workbook';

test('all 18 independent formula verification tests pass through real calculation engine', () => {
  const results = runIndependentFormulaTests();
  assert.equal(results.length, 18);
  for (const tc of results) {
    assert.equal(
      tc.passed,
      true,
      `Formula test ${tc.id} (${tc.name}) failed: expected "${tc.expected}", got "${tc.actual}"`
    );
  }
});

test('zero-sales rule enforces N/A accuracy for (0,0) and (0,100), while unit error is exact', () => {
  assert.equal(calcRowAccuracyPct(0, 0), null);
  assert.equal(calcRowAccuracyPct(0, 100), null);
  assert.equal(calcRowAccuracyPct(100, 0), 0);
  assert.equal(calcRowAccuracyPct(100, 100), 100);
  assert.equal(calcWmapeAccuracy([0, 0], [0, 0]), null);

  const evalZeroZero = evaluateDemandMetrics(0, 0, 0, 100);
  assert.equal(evalZeroZero.accuracyPct, null);
  assert.equal(evalZeroZero.accuracyLabel, 'N/A');
  assert.equal(evalZeroZero.unitError, 0);

  const evalZeroPos = evaluateDemandMetrics(0, 100, 0, 100);
  assert.equal(evalZeroPos.accuracyPct, null);
  assert.equal(evalZeroPos.accuracyLabel, 'N/A');
  assert.equal(evalZeroPos.unitError, 100);
});

test('array mismatch, zero-variance outlier, zero-forecast bias, and negative weekly orders behave strictly', () => {
  assert.throws(() => calcWmapeAccuracy([100, 200], [100]), /length mismatch/i);
  assert.throws(() => calcCumulativeBias([100, 200], [100]), /length mismatch/i);
  assert.throws(() => calcBullwhipRatio([100, 200], [100]), /length mismatch/i);
  assert.throws(
    () => calcWeeklyOrderConsumption([{ week: 'W1', forecast: -10, orders: 50 }]),
    /negative/i
  );

  const constOutlier = calcLeaveOneOutSigma([100, 100, 100, 500], 3);
  assert.equal(constOutlier.isConstantBaseline, true);
  assert.equal(constOutlier.isOutlier, true);
  assert.equal(constOutlier.zScore, null);

  const zeroFcstBias = calcCumulativeBias([200, 300], [0, 0]);
  assert.equal(zeroFcstBias.signedErrorSum, -500);
  assert.equal(zeroFcstBias.biasPct, null);
});

test('missing master tables produce MISSING_TABLE critical error and NOT_RUN / PARTIAL status (never PASSED)', () => {
  const sheets = createSeededEnterpriseSheets();
  delete sheets['09_Product_Master_Hierarchy'];
  delete sheets['10_Location_Depot_Network'];
  delete sheets['11_Customer_Channel_Master'];

  const report = validateWorkbook(sheets);
  assert.equal(report.schemaPassed, false);
  const crossCat = report.categories.find((c) => c.key === 'crossTableJoins');
  assert.ok(crossCat);
  assert.equal(crossCat.status, 'NOT_RUN');
  assert.ok(crossCat.missingDependencies.length === 3);

  const gate = evaluateReleaseGate(report, null, true);
  assert.equal(gate.step2Unlocked, false);
  assert.equal(gate.allRequiredValidationsExecuted, false);

  // Partial master omission (Location Master missing while SKU Master present & failing)
  const partialSheets = createSeededEnterpriseSheets();
  delete partialSheets['10_Location_Depot_Network'];
  const partialReport = validateWorkbook(partialSheets);
  const partialCross = partialReport.categories.find((c) => c.key === 'crossTableJoins');
  assert.ok(partialCross);
  assert.ok(partialCross.missingDependencies.includes('10_Location_Depot_Network'));
  assert.equal(partialReport.allRequiredValidationsExecuted, false);
});

test('missing mandatory column sets dependent category to NOT_RUN and fails schema assurance', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].cols = sheets[
    '01_Orders_Shipments_History'
  ].cols.filter((c) => c.col !== 'Invoiced_Actual_Qty');
  sheets['01_Orders_Shipments_History'].records = sheets[
    '01_Orders_Shipments_History'
  ].records.map((r) => {
    const copy = { ...r };
    delete copy.Invoiced_Actual_Qty;
    return copy;
  });

  const report = validateWorkbook(sheets);
  assert.equal(report.schemaPassed, false);
  assert.ok(
    report.exceptions.some(
      (e) => e.category === 'SCHEMA' && e.issue.includes('Invoiced_Actual_Qty')
    )
  );
  const timeCat = report.categories.find((c) => c.key === 'timeAndKeyIntegrity');
  assert.ok(timeCat);
  assert.notEqual(timeCat.status, 'PASSED');
});

test('all-pair promotion overlap catches non-adjacent overlapping promotions', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['04_Trade_Promotions_Calendar'].records = [
    { Promo_Event_ID: 'P1', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-01', Promo_End_Date: '2025-10-20', Expected_Uplift_Pct: 20 },
    { Promo_Event_ID: 'P2', SKU_Code: 'SKU_BEV_01', Location_DC: 'Delhi', Promo_Start_Date: '2025-10-05', Promo_End_Date: '2025-10-10', Expected_Uplift_Pct: 15 },
    { Promo_Event_ID: 'P3', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-15', Promo_End_Date: '2025-10-25', Expected_Uplift_Pct: 25 },
  ];
  const report = validateWorkbook(sheets);
  const overlapErrs = report.exceptions.filter((e) => e.fixType === 'RESOLVE_PROMO_OVERLAP');
  assert.equal(overlapErrs.length, 1);
  assert.match(overlapErrs[0].issue, /P3.*Overlaps With.*P1/);
});

test('negative actuals distinguish classified credit returns from unclassified negative billed qty', () => {
  const sheets = createSeededEnterpriseSheets();
  // Classified credit return should NOT trigger FIX_NEGATIVE critical error
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-05-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Mumbai', Channel_Code: 'GT', Ordered_Qty_Units: 1000, Invoiced_Actual_Qty: -200, Returns_Damaged_Qty: 200, Transaction_Type: 'CREDIT_RETURN' },
  ];
  const report = validateWorkbook(sheets);
  assert.equal(report.exceptions.some((e) => e.fixType === 'FIX_NEGATIVE'), false);
});

test('non-destructive correction governance leaves source data untouched and enforces mandatory warning sign-off', () => {
  const sourceSheets = createSeededEnterpriseSheets();
  const originalInv1062 = sourceSheets['01_Orders_Shipments_History'].records[6].Invoiced_Actual_Qty;
  assert.equal(originalInv1062, '');

  // Safe technical batch only resolves deterministic non-business-judgement fixes
  const techResult = applySafeTechnicalFixes(sourceSheets, [], 'Test Steward');
  assert.ok(techResult.appliedCount >= 1);
  assert.ok(techResult.afterCount < techResult.beforeCount);

  // Source remains untouched!
  assert.equal(sourceSheets['01_Orders_Shipments_History'].records[6].Invoiced_Actual_Qty, '');

  // Approve all remaining critical exceptions explicitly
  let corrections: ApprovedCorrection[] = [...techResult.nextCorrections];
  let guard = 0;
  while (guard < 50) {
    const working = applyApprovedCorrections(sourceSheets, corrections);
    const report = validateWorkbook(working);
    const nextCrit = report.exceptions.find((e) => e.severity === 'CRITICAL');
    if (!nextCrit) break;

    let approvedValue: string | number = nextCrit.suggestedVal ?? 3180;
    if (nextCrit.fixType === 'MAP_SKU') approvedValue = 'SKU_DAIRY_03';
    if (nextCrit.fixType === 'MAP_DEPOT') approvedValue = 'Kolkata';
    if (nextCrit.fixType === 'MAP_CHANNEL') approvedValue = 'GT';
    if (nextCrit.fixType === 'FIX_NPI_REF') approvedValue = 'SKU_CARE_04';
    if (nextCrit.fixType === 'IMPUTE_MISSING_PERIOD') approvedValue = 3180;

    corrections.push({
      id: `COR-TEST-${guard}`,
      exceptionSignature: nextCrit.signature,
      fixType: nextCrit.fixType,
      table: nextCrit.table,
      rowIndex: nextCrit.rowIndex,
      targetCol: nextCrit.targetCol,
      approvedValue,
      classificationMode: nextCrit.fixType === 'FIX_NEGATIVE' ? 'CREDIT_RETURN' : undefined,
      beforeSummary: nextCrit.badVal,
      afterSummary: String(approvedValue),
      approver: 'Test Steward',
      reason: 'Approved in unit test verification',
      approvedAt: '2026-11-18 10:00',
      missingPeriodMeta: nextCrit.missingPeriodMeta
        ? {
            periodDate: nextCrit.missingPeriodMeta.periodDate,
            sku: nextCrit.missingPeriodMeta.sku,
            depot: nextCrit.missingPeriodMeta.depot,
            channel: nextCrit.missingPeriodMeta.channel,
          }
        : undefined,
    });
    guard++;
  }

  // Original sourceSheets STILL untouched!
  assert.equal(sourceSheets['01_Orders_Shipments_History'].records[6].Invoiced_Actual_Qty, '');

  const cleanWorking = applyApprovedCorrections(sourceSheets, corrections);
  const finalReport = validateWorkbook(cleanWorking);
  assert.equal(finalReport.exceptions.filter((e) => e.severity === 'CRITICAL').length, 0);
  assert.ok(finalReport.exceptions.filter((e) => e.severity === 'WARNING').length > 0);

  // Release gate MUST remain locked until mandatory warning sign-off is provided!
  const gateWithoutSignOff = evaluateReleaseGate(finalReport, null, true);
  assert.equal(gateWithoutSignOff.step2Unlocked, false);
  assert.equal(gateWithoutSignOff.status, 'AWAITING_WARNING_SIGNOFF');

  // Release gate MUST stay locked if formulaTestsPassed is false
  const gateFailedFormula = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18' },
    false
  );
  assert.equal(gateFailedFormula.step2Unlocked, false);

  // With warning sign-off AND formula tests passed -> Step 2 unlocks!
  const gatePassed = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18' },
    true
  );
  assert.equal(gatePassed.step2Unlocked, true);
  assert.equal(gatePassed.status, 'WARNING_ACKNOWLEDGED');
});

test('workbook security escapes HTML/XSS payloads and flags injected cells', () => {
  const xss = `<img src=x onerror="alert(1)"><script>fetch('evil')</script>`;
  const escaped = escapeHtml(xss);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('<img'));
  assert.equal(hasUnsafePayload(xss), true);
  assert.equal(sanitizeCellText('<script>alert(1)</script>SKU_SAFE'), 'SKU_SAFE');

  const sheets = createSeededEnterpriseSheets();
  sheets['09_Product_Master_Hierarchy'].records[0].SKU_Description = xss;
  const report = validateWorkbook(sheets);
  assert.ok(report.exceptions.some((e) => e.fixType === 'SANITIZE_CELL'));
});

test('multi-sheet workbook export and ingestion preserves ALL worksheets in schema', () => {
  const seeded = createSeededEnterpriseSheets();
  const binary = buildWorkbookBinary(seeded);
  const ingested = ingestWorkbookBuffer(binary, 'Full_12_Table_Export.xlsx');

  assert.equal(ingested.sheetCount, 12);
  assert.equal(Object.keys(ingested.sheets).length, 12);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Period_Date: '2026-01-01', SKU_Code: 'A1', Invoiced_Actual_Qty: 100 }]), 'Orders_Sheet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ SKU_Code: 'A1', Base_UOM: 'EA' }]), 'Product_Sheet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Location_DC: 'Mumbai' }]), 'Depot_Sheet');
  const customBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const customIngested = ingestWorkbookBuffer(customBuf, 'Custom_3_Sheets.xlsx');
  assert.equal(customIngested.sheetCount, 3);
  assert.deepEqual(Object.keys(customIngested.sheets), ['Orders_Sheet', 'Product_Sheet', 'Depot_Sheet']);
});

test('Excel serial dates and DD-MMM-YYYY strings pass schema date checks and drive continuity', () => {
  // 45658 = 2025-01-01, 45717 = 2025-03-01 (Excel 1900 date serials)
  const d1 = parseFlexibleDate(45658);
  const d2 = parseFlexibleDate('01-Mar-2025');
  assert.ok(d1 && d1.toISOString().startsWith('2025-01-01'));
  assert.ok(d2 && d2.toISOString().startsWith('2025-03-01'));
  assert.equal(parseFlexibleDate('2025-02-30'), null);
  assert.equal(parseFlexibleDate('bad-date'), null);

  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: 45658, SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
    { Period_Date: '01-Mar-2025', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3100, Invoiced_Actual_Qty: 3100, Returns_Damaged_Qty: 0 },
  ];
  const report = validateWorkbook(sheets);
  assert.equal(
    report.exceptions.some((e) => e.signature.includes('INVALID_DATE')),
    false
  );
  assert.ok(
    report.exceptions.some(
      (e) =>
        e.fixType === 'IMPUTE_MISSING_PERIOD' &&
        e.missingPeriodMeta?.periodDate === '2025-02-01'
    )
  );

  // Also test Excel date-formatted cells through xlsx ingestion
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    [{ Period_Date: new Date(Date.UTC(2025, 0, 1)), SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 }],
    { cellDates: true }
  );
  XLSX.utils.book_append_sheet(wb, ws, '01_Orders_Shipments_History');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const ingested = ingestWorkbookBuffer(buf, 'Excel_Dates.xlsx');
  assert.equal(
    ingested.sheets['01_Orders_Shipments_History'].records[0].Period_Date,
    '2025-01-01'
  );
});

test('refined business keys allow multi-SKU promos and multi-zone festivals without false duplicates', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['04_Trade_Promotions_Calendar'].records = [
    { Promo_Event_ID: 'PRM_DIW_01', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-10', Promo_End_Date: '2025-10-25', Expected_Uplift_Pct: 25 },
    { Promo_Event_ID: 'PRM_DIW_01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Delhi', Promo_Start_Date: '2025-10-10', Promo_End_Date: '2025-10-25', Expected_Uplift_Pct: 20 },
  ];
  sheets['05_Festivals_Holidays_Events'].records = [
    { Festival_Event_Code: 'FEST_DIWALI', Event_Name: 'Diwali East', Zone_Region_Scope: 'East', Festival_Peak_Date: '2025-10-20', Expected_Festival_Lift_Pct: 24 },
    { Festival_Event_Code: 'FEST_DIWALI', Event_Name: 'Diwali North', Zone_Region_Scope: 'North', Festival_Peak_Date: '2025-10-20', Expected_Festival_Lift_Pct: 28 },
  ];
  const report = validateWorkbook(sheets);
  assert.equal(
    report.exceptions.some(
      (e) =>
        e.category === 'DUPLICATE_KEY' &&
        (e.table === '04_Trade_Promotions_Calendar' ||
          e.table === '05_Festivals_Holidays_Events')
    ),
    false
  );
});

test('month-end series continuity detects missing February without rolling Jan 31 into March', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-01-31', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
    { Period_Date: '2025-03-31', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3100, Invoiced_Actual_Qty: 3100, Returns_Damaged_Qty: 0 },
  ];
  const report = validateWorkbook(sheets);
  const missingFeb = report.exceptions.filter((e) => e.fixType === 'IMPUTE_MISSING_PERIOD');
  assert.equal(missingFeb.length, 1);
  assert.equal(missingFeb[0].missingPeriodMeta?.periodDate, '2025-02-28');

  // Also verify Feb 28 -> Apr 30 month-end series identifies 2025-03-31
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-02-28', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
    { Period_Date: '2025-04-30', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3100, Invoiced_Actual_Qty: 3100, Returns_Damaged_Qty: 0 },
  ];
  const reportMar = validateWorkbook(sheets);
  const missingMar = reportMar.exceptions.filter((e) => e.fixType === 'IMPUTE_MISSING_PERIOD');
  assert.equal(missingMar.length, 1);
  assert.equal(missingMar[0].missingPeriodMeta?.periodDate, '2025-03-31');
});

test('non-numeric actuals and empty mandatory PK/DATE/NUMERIC cells raise CRITICAL errors', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: '', Invoiced_Actual_Qty: '120abc', Returns_Damaged_Qty: 0 },
    { Period_Date: '', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3100, Invoiced_Actual_Qty: 'N/A', Returns_Damaged_Qty: 0 },
  ];
  const report = validateWorkbook(sheets);
  assert.ok(
    report.exceptions.some(
      (e) => e.severity === 'CRITICAL' && e.signature.startsWith('SCHEMA|EMPTY_MANDATORY|01_Orders_Shipments_History|0|Ordered_Qty_Units')
    )
  );
  assert.ok(
    report.exceptions.some(
      (e) => e.severity === 'CRITICAL' && e.signature.startsWith('SCHEMA|EMPTY_MANDATORY|01_Orders_Shipments_History|1|Period_Date')
    )
  );
  assert.ok(
    report.exceptions.some(
      (e) => e.severity === 'CRITICAL' && e.signature === 'IMPUTE_ACTUAL|NON_NUMERIC|01_Orders_Shipments_History|0'
    )
  );
  assert.ok(
    report.exceptions.some(
      (e) => e.severity === 'CRITICAL' && e.signature === 'IMPUTE_ACTUAL|NON_NUMERIC|01_Orders_Shipments_History|1'
    )
  );
});

test('CASE UOM factor < 12 raises WARNING until verified and <= 1 raises CRITICAL', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['09_Product_Master_Hierarchy'].records = [
    { SKU_Code: 'SKU_BEV_01', SKU_Description: 'Bev 1', Base_UOM: 'CASE', UOM_Conversion_Factor: 1 },
    { SKU_Code: 'SKU_DAIRY_03', SKU_Description: 'Dairy 3', Base_UOM: 'CASE', UOM_Conversion_Factor: 6 },
  ];
  const report = validateWorkbook(sheets);
  const critUom = report.exceptions.find((e) => e.signature.startsWith('FIX_UOM|09_Product_Master_Hierarchy|0'));
  const warnUom = report.exceptions.find((e) => e.signature.startsWith('FIX_UOM_PACK|09_Product_Master_Hierarchy|1'));
  assert.ok(critUom && critUom.severity === 'CRITICAL');
  assert.ok(warnUom && warnUom.severity === 'WARNING');

  // Explicit approval of custom pack size (6) clears the warning via _uomPackVerified
  const working = applyApprovedCorrections(sheets, [
    {
      id: 'COR-UOM-6',
      exceptionSignature: warnUom!.signature,
      fixType: 'FIX_UOM',
      table: '09_Product_Master_Hierarchy',
      rowIndex: 1,
      approvedValue: 6,
      beforeSummary: 'CASE = 6 EA/CASE',
      afterSummary: '6',
      approver: 'Master Steward',
      reason: 'Verified 6-pack case configuration',
      approvedAt: '2026-11-18 10:00',
    },
  ]);
  const afterReport = validateWorkbook(working);
  assert.equal(
    afterReport.exceptions.some((e) => e.signature.startsWith('FIX_UOM_PACK|')),
    false
  );
});

test('promotion overlap respects Channel_Code while overlapping ALL/matching channels', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['04_Trade_Promotions_Calendar'].records = [
    { Promo_Event_ID: 'P_GT', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Channel_Code: 'GT', Promo_Start_Date: '2025-10-01', Promo_End_Date: '2025-10-20', Expected_Uplift_Pct: 20 },
    { Promo_Event_ID: 'P_MT', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Channel_Code: 'MT', Promo_Start_Date: '2025-10-05', Promo_End_Date: '2025-10-15', Expected_Uplift_Pct: 15 },
    { Promo_Event_ID: 'P_ALL', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Channel_Code: 'ALL', Promo_Start_Date: '2025-10-10', Promo_End_Date: '2025-10-18', Expected_Uplift_Pct: 10 },
  ];
  const report = validateWorkbook(sheets);
  const overlaps = report.exceptions.filter((e) => e.fixType === 'RESOLVE_PROMO_OVERLAP');
  // P_GT vs P_MT should NOT collide; P_ALL collides with P_GT and P_MT
  assert.equal(overlaps.some((e) => e.issue.includes('P_MT') && e.issue.includes('P_GT')), false);
  assert.ok(overlaps.some((e) => e.issue.includes('P_ALL')));
});

test('expired warning sign-off blocks Step 2 and transitions gate to AWAITING_WARNING_SIGNOFF', () => {
  const sheets = createSeededEnterpriseSheets();
  // Keep clean rows except one stockout warning
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
  ];
  sheets['02_Forecast_Vintages_Lag'].records = [
    { Target_Delivery_Month: '2026-01-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Stat_Baseline_Unconstrained: 3000, Stat_Forecast_Lag1_Qty: 3100 },
  ];
  sheets['03_Commercial_Sales_Inputs'].records = [];
  sheets['04_Trade_Promotions_Calendar'].records = [];
  sheets['06_Pricing_Elasticity_Catalog'].records = [];
  sheets['09_Product_Master_Hierarchy'].records = [
    { SKU_Code: 'SKU_DAIRY_03', SKU_Description: 'Dairy', Base_UOM: 'EA', UOM_Conversion_Factor: 12 },
    { SKU_Code: 'SKU_SNK_02', SKU_Description: 'Snacks', Base_UOM: 'EA', UOM_Conversion_Factor: 24 },
  ];
  sheets['12_NPI_Lifecycle_Transitions'].records = [];

  const report = validateWorkbook(sheets);
  assert.equal(report.exceptions.filter((e) => e.severity === 'CRITICAL').length, 0);
  assert.ok(report.exceptions.filter((e) => e.severity === 'WARNING').length > 0);

  const issuedMs = Date.UTC(2026, 10, 1, 12, 0, 0);
  const expiresAt = computeSignOffExpiryIso('24 Hours', issuedMs);

  const validGate = evaluateReleaseGate(
    report,
    { approver: 'VP Supply', reason: 'Reviewed', expiry: '24 Hours', signedAt: '2026-11-01', expiresAt },
    true,
    issuedMs + 60_000
  );
  assert.equal(validGate.step2Unlocked, true);
  assert.equal(validGate.status, 'WARNING_ACKNOWLEDGED');

  const expiredGate = evaluateReleaseGate(
    report,
    { approver: 'VP Supply', reason: 'Reviewed', expiry: '24 Hours', signedAt: '2026-11-01', expiresAt },
    true,
    issuedMs + 25 * 60 * 60 * 1000
  );
  assert.equal(expiredGate.step2Unlocked, false);
  assert.equal(expiredGate.warningPolicySatisfied, false);
  assert.equal(expiredGate.status, 'AWAITING_WARNING_SIGNOFF');
});
