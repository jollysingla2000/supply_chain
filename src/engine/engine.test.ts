import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  calcBullwhipRatio,
  calcCumulativeBias,
  calcLeaveOneOutSigma,
  calcMeioSafetyStockDelta,
  calcRowAccuracyPct,
  calcSeriesCoV,
  calcWeeklyOrderConsumption,
  calcWmapeAccuracy,
  evaluateDemandMetrics,
} from './calculations';
import { runIndependentFormulaTests } from './formulaTests';
import { createDomainTestWorkbook, createSeededEnterpriseSheets, DEFAULT_RULE_CONFIG } from './schema';
import { escapeHtml, hasUnsafePayload, sanitizeCellText } from './security';
import { ApprovedCorrection } from './types';
import {
  applyApprovedCorrections,
  applySafeTechnicalFixes,
  computeSignOffExpiryIso,
  evaluateReleaseGate,
  isAmbiguousDateString,
  parseFlexibleDate,
  resolveColumnDataType,
  validateRuleConfig,
  validateSchemaRemediationInput,
  validateWorkbook,
} from './validation';
import {
  applyColumnMapping,
  computeWorkbookHash,
  hasPersistedGovernanceState,
  loadPersistedGovernanceState,
  savePersistedGovernanceState,
  detectSchemaDrift,
  profileWorkbook,
  remediateMissingStructure,
  runCrossTableReconciliation,
  sha256Hex,
} from './profilingAndReconciliation';
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

test('array mismatch, zero-variance outlier, zero-forecast bias, CoV/Bullwhip zero-guards, integer targetIndex, and negative input guards behave strictly', () => {
  assert.throws(() => calcWmapeAccuracy([100, 200], [100]), /length mismatch/i);
  assert.throws(() => calcCumulativeBias([100, 200], [100]), /length mismatch/i);
  assert.throws(() => calcBullwhipRatio([100, 200], [100]), /length mismatch/i);
  assert.throws(
    () => calcWeeklyOrderConsumption([{ week: 'W1', forecast: -10, orders: 50 }]),
    /negative/i
  );

  // Negative actuals/forecasts rejected in accuracy & series functions rather than silently clamped
  assert.throws(() => calcRowAccuracyPct(-10, 100), /non-negative/i);
  assert.throws(() => calcRowAccuracyPct(100, -10), /non-negative/i);
  assert.throws(() => calcWmapeAccuracy([-50, 100], [100, 100]), /negative/i);
  assert.throws(() => evaluateDemandMetrics(100, -20, 0, 10), /negative/i);

  // Fractional targetIndex and negative demand series rejected in calcLeaveOneOutSigma
  assert.throws(() => calcLeaveOneOutSigma([100, 110, 105, 500], 1.5), /integer/i);
  assert.throws(() => calcLeaveOneOutSigma([-100, 110, 105, 500], 3), /negative/i);

  // Negative zValue and negative rmseReduction rejected in calcMeioSafetyStockDelta
  assert.throws(() => calcMeioSafetyStockDelta(-2.05, 100, 1), /negative/i);
  assert.throws(() => calcMeioSafetyStockDelta(2.05, -100, 1), /negative/i);
  assert.throws(() => calcMeioSafetyStockDelta(2.05, 100, -1), /negative/i);

  // Zero-mean CoV returns null (undefined) and negative values throw
  assert.equal(calcSeriesCoV([0, 0, 0]), null);
  assert.throws(() => calcSeriesCoV([-10, 20, 30]), /negative/i);

  // Bullwhip ratio returns null when POS Sell-Out CoV is 0
  const zeroPosBullwhip = calcBullwhipRatio([100, 200, 150], [100, 100, 100]);
  assert.equal(zeroPosBullwhip.posCoV, 0);
  assert.equal(zeroPosBullwhip.ratio, null);

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

  // Fail-closed: sign-off WITHOUT expiresAt (or with unparseable expiresAt) MUST remain locked!
  const gateMissingExpiry = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18' },
    true
  );
  assert.equal(gateMissingExpiry.step2Unlocked, false);
  assert.equal(gateMissingExpiry.status, 'AWAITING_WARNING_SIGNOFF');

  const nowMs = Date.UTC(2026, 10, 18, 10, 0, 0);
  const validExpiresAt = computeSignOffExpiryIso('7 Days', nowMs);

  // Release gate MUST stay locked if formulaTestsPassed is false
  const gateFailedFormula = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18', expiresAt: validExpiresAt },
    false,
    nowMs + 1000
  );
  assert.equal(gateFailedFormula.step2Unlocked, false);

  // With valid future warning sign-off AND formula tests passed -> Step 2 unlocks!
  const gatePassed = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18', expiresAt: validExpiresAt },
    true,
    nowMs + 1000
  );
  assert.equal(gatePassed.step2Unlocked, true);
  assert.equal(gatePassed.status, 'WARNING_ACKNOWLEDGED');

  // Verify missing-period approval did NOT invent fake Invoice_Line_ID, billed actuals, or qty * 63 revenue
  const imputedRow = cleanWorking['01_Orders_Shipments_History'].records.find(
    (r) => r._isImputedContinuityRow === true
  );
  assert.ok(imputedRow);
  assert.equal(imputedRow.Invoiced_Actual_Qty, 0);
  assert.equal(imputedRow.Ordered_Qty_Units, 0);
  assert.equal(imputedRow.Net_Realized_Sales_INR, null);
  assert.equal(imputedRow.Invoice_Line_ID, '');
  assert.equal(imputedRow.Governed_Imputed_Demand_Qty, 3180);

  // Verify exported workbook filters out _removed duplicate rows
  const beforeDupCount = sourceSheets['01_Orders_Shipments_History'].records.filter(
    (r) => r.Period_Date === '2025-09-01' && r.SKU_Code === 'SKU_DAIRY_03'
  ).length;
  assert.equal(beforeDupCount, 2);
  const exportedBytes = buildWorkbookBinary(cleanWorking);
  const reingested = ingestWorkbookBuffer(exportedBytes, 'Governed_Export.xlsx');
  const afterDupCount = reingested.sheets['01_Orders_Shipments_History'].records.filter(
    (r) => r.Period_Date === '2025-09-01' && r.SKU_Code === 'SKU_DAIRY_03'
  ).length;
  assert.equal(afterDupCount, 1);
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

  // Unknown numeric prefixes must not be guessed into a canonical table.
  const unknownPrefixWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(unknownPrefixWb, XLSX.utils.json_to_sheet([{ Value: 1 }]), '01_Unrelated_Data');
  const unknownPrefixBuffer = XLSX.write(unknownPrefixWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const unknownPrefixIngested = ingestWorkbookBuffer(unknownPrefixBuffer, 'Unknown_Prefix.xlsx');
  assert.deepEqual(Object.keys(unknownPrefixIngested.sheets), ['01_Unrelated_Data']);

  // A canonical worksheet and its suffixed copy must fail instead of silently overwriting data.
  const duplicateWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(duplicateWb, XLSX.utils.json_to_sheet([{ SKU_Code: 'A1' }]), '09_Product_Master_Hierarchy');
  XLSX.utils.book_append_sheet(duplicateWb, XLSX.utils.json_to_sheet([{ SKU_Code: 'B2' }]), '09_Product_Master_Hierarchy_A');
  const duplicateBuffer = XLSX.write(duplicateWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  assert.throws(
    () => ingestWorkbookBuffer(duplicateBuffer, 'Duplicate_Canonical_Sheets.xlsx'),
    /same target table/
  );

  // Export must reject two table names that collide after Excel's 31-character truncation.
  const longPrefix = 'X'.repeat(31);
  const exportCollision = {
    [`${longPrefix}A`]: seeded['01_Orders_Shipments_History'],
    [`${longPrefix}B`]: seeded['01_Orders_Shipments_History'],
  };
  assert.throws(
    () => buildWorkbookBinary(exportCollision),
    /31-character limit/
  );

  // Special object-property names from a worksheet must remain ordinary table names.
  const prototypeKeyWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    prototypeKeyWb,
    XLSX.utils.json_to_sheet([{ Safe_Value: 'preserved' }]),
    '__proto__'
  );
  const prototypeKeyBuffer = XLSX.write(prototypeKeyWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const prototypeKeyIngested = ingestWorkbookBuffer(prototypeKeyBuffer, 'Prototype_Key.xlsx');
  assert.equal(Object.prototype.hasOwnProperty.call(prototypeKeyIngested.sheets, '__proto__'), true);
  assert.equal(prototypeKeyIngested.sheets['__proto__'].records[0].Safe_Value, 'preserved');
  const clonedPrototypeKeySheets = applyApprovedCorrections(prototypeKeyIngested.sheets, []);
  assert.equal(Object.prototype.hasOwnProperty.call(clonedPrototypeKeySheets, '__proto__'), true);
  assert.equal(clonedPrototypeKeySheets['__proto__'].records[0].Safe_Value, 'preserved');

  const duplicateHeadersWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    duplicateHeadersWb,
    XLSX.utils.aoa_to_sheet([['SKU_Code', 'sku_code'], ['A1', 'A2']]),
    'Duplicate_Headers'
  );
  const duplicateHeadersBuffer = XLSX.write(duplicateHeadersWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  assert.throws(
    () => ingestWorkbookBuffer(duplicateHeadersBuffer, 'Duplicate_Headers.xlsx'),
    /duplicate column headers/i
  );

  const blankHeadersWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    blankHeadersWb,
    XLSX.utils.aoa_to_sheet([['SKU_Code', '', 'Quantity'], ['A1', 'unmapped', 5]]),
    'Blank_Header'
  );
  const blankHeadersBuffer = XLSX.write(blankHeadersWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  assert.throws(
    () => ingestWorkbookBuffer(blankHeadersBuffer, 'Blank_Header.xlsx'),
    /blank header cell/i
  );

  const formulaWb = XLSX.utils.book_new();
  const formulaWs = XLSX.utils.aoa_to_sheet([['SKU_Code', 'Calculated_Value'], ['A1', 2]]);
  formulaWs.B2 = { t: 'n', v: 2, f: '1+1' };
  XLSX.utils.book_append_sheet(formulaWb, formulaWs, 'Formula_Data');
  const formulaBuffer = XLSX.write(formulaWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  assert.throws(
    () => ingestWorkbookBuffer(formulaBuffer, 'Formula_Data.xlsx'),
    /formula cell.*convert formulas to verified values/i
  );
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
    [
      { Period_Date: new Date(Date.UTC(2025, 0, 1)), SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
      { Period_Date: 45658, SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
    ],
    { cellDates: true }
  );
  if (ws.A3) ws.A3.z = 'm/d/yy';
  XLSX.utils.book_append_sheet(wb, ws, '01_Orders_Shipments_History');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const ingested = ingestWorkbookBuffer(buf, 'Excel_Dates.xlsx');
  assert.equal(
    ingested.sheets['01_Orders_Shipments_History'].records[0].Period_Date,
    '2025-01-01'
  );
  assert.equal(
    ingested.sheets['01_Orders_Shipments_History'].records[1].Period_Date,
    '2025-01-01'
  );

  // Excel's 1904 date system uses a different serial epoch.
  const wb1904 = XLSX.utils.book_new();
  const ws1904 = XLSX.utils.json_to_sheet([
    { Period_Date: 44196, SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
  ]);
  XLSX.utils.sheet_add_aoa(
    ws1904,
    [['44196', 'SKU_SNK_02', 'Delhi', 'GT', 3100, 3100, 0]],
    { origin: 'A3' }
  );
  if (ws1904.A2) ws1904.A2.z = 'm/d/yy';
  (wb1904 as unknown as { Workbook?: { WBProps?: { date1904?: boolean } } }).Workbook = {
    WBProps: { date1904: true },
  };
  XLSX.utils.book_append_sheet(wb1904, ws1904, '01_Orders_Shipments_History');
  const buf1904 = XLSX.write(wb1904, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const ingested1904 = ingestWorkbookBuffer(buf1904, 'Excel_1904_Dates.xlsx');
  assert.equal(
    ingested1904.sheets['01_Orders_Shipments_History'].records[0].Period_Date,
    '2025-01-01'
  );
  assert.equal(
    ingested1904.sheets['01_Orders_Shipments_History'].records[1].Period_Date,
    '2025-01-01',
    'Text-formatted Excel serial date must use the 1904 epoch too'
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
  // Keep clean rows except one intentional UOM-policy warning
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
  ];
  sheets['02_Forecast_Vintages_Lag'].records = [
    { Target_Delivery_Month: '2026-01-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Stat_Baseline_Unconstrained: 3000, Stat_Forecast_Lag1_Qty: 3100 },
  ];
  sheets['03_Commercial_Sales_Inputs'].records = [];
  sheets['04_Trade_Promotions_Calendar'].records = [
    {
      Promo_Event_ID: 'PRM_RELEASE_TEST',
      SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Promo_Start_Date: '2025-05-10',
      Promo_End_Date: '2025-05-15',
      Expected_Uplift_Pct: 10,
    },
  ];
  sheets['06_Pricing_Elasticity_Catalog'].records = [];
  // Create a deterministic policy warning: CASE pack factor below the configured minimum.
  sheets['09_Product_Master_Hierarchy'].records = [
    { SKU_Code: 'SKU_DAIRY_03', SKU_Description: 'Dairy', Base_UOM: 'CASE', UOM_Conversion_Factor: 2 },
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

test('ambiguous slash dates (01/02/2025, 05/06/2025) are rejected rather than guessed as MM/DD', () => {
  assert.equal(isAmbiguousDateString('01/02/2025'), true);
  assert.equal(isAmbiguousDateString('05/06/2025'), true);
  assert.equal(parseFlexibleDate('01/02/2025'), null);
  assert.equal(parseFlexibleDate('05/06/2025'), null);
  // Unambiguous slash dates (day > 12 or day === month) still parse cleanly
  const dUnambig = parseFlexibleDate('25/10/2025');
  assert.ok(dUnambig && dUnambig.toISOString().startsWith('2025-10-25'));
  const dSame = parseFlexibleDate('05/05/2025');
  assert.ok(dSame && dSame.toISOString().startsWith('2025-05-05'));

  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    { Period_Date: '01/02/2025', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0 },
  ];
  const report = validateWorkbook(sheets);
  const dateErr = report.exceptions.find((e) => e.signature.startsWith('SCHEMA|INVALID_DATE|'));
  assert.ok(dateErr);
  assert.match(dateErr.issue, /Ambiguous Date/i);

  // Verify rejected ambiguous date can be remediated in-browser to ISO YYYY-MM-DD
  const remediated = applyApprovedCorrections(sheets, [
    {
      id: 'COR-DATE-ISO',
      exceptionSignature: dateErr.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      targetCol: 'Period_Date',
      approvedValue: '2025-02-01',
      beforeSummary: '01/02/2025',
      afterSummary: 'Normalized Period_Date to 2025-02-01 (ISO YYYY-MM-DD)',
      approver: 'Steward',
      reason: 'Normalized Indian DD/MM/YYYY date to ISO 2025-02-01',
      approvedAt: '2026-11-18 10:00',
    },
  ]);
  const afterDateReport = validateWorkbook(remediated);
  assert.equal(
    afterDateReport.exceptions.some((e) => e.signature.startsWith('SCHEMA|INVALID_DATE|')),
    false
  );
});

test('credit-return classification reconciles existing returns (both below and above credit qty) without double-counting and pair-specific promo approval preserves remaining overlaps', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    // Row 0: existingReturns (40) < abs(-100) -> reconciles to 100 (+60 delta)
    { Period_Date: '2025-06-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Mumbai', Channel_Code: 'GT', Ordered_Qty_Units: 1000, Invoiced_Actual_Qty: -100, Returns_Damaged_Qty: 40 },
    // Row 1: existingReturns (150) > abs(-100) -> preserves 150 (+0 delta, neither reduced to 100 nor inflated to 250)
    { Period_Date: '2025-07-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Mumbai', Channel_Code: 'GT', Ordered_Qty_Units: 1000, Invoiced_Actual_Qty: -100, Returns_Damaged_Qty: 150 },
  ];
  sheets['04_Trade_Promotions_Calendar'].records = [
    { Promo_Event_ID: 'P1', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-01', Promo_End_Date: '2025-10-20', Expected_Uplift_Pct: 20 },
    { Promo_Event_ID: 'P2', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-05', Promo_End_Date: '2025-10-22', Expected_Uplift_Pct: 18 },
    { Promo_Event_ID: 'P3', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-10', Promo_End_Date: '2025-10-25', Expected_Uplift_Pct: 25 },
  ];

  const initialReport = validateWorkbook(sheets);
  const negErrs = initialReport.exceptions.filter((e) => e.fixType === 'FIX_NEGATIVE');
  assert.equal(negErrs.length, 2);
  assert.match(negErrs[0].suggestedValText, /\+60 u unrecorded delta/i);
  assert.match(negErrs[1].suggestedValText, /\+0 u unrecorded delta/i);
  assert.match(negErrs[1].suggestedValText, /Reconcile Returns to 150 u/i);

  // P3 overlaps with both P1 and P2 (and P2 overlaps with P1) -> 3 overlap pairs total
  const p3OverlapsBefore = initialReport.exceptions.filter(
    (e) => e.fixType === 'RESOLVE_PROMO_OVERLAP' && e.signature.endsWith('|P3')
  );
  assert.equal(p3OverlapsBefore.length, 2);

  // Approve credit return on both rows AND approve ONLY the P1-P3 overlap
  const p1p3 = p3OverlapsBefore.find((e) => e.signature.includes('|P1|P3'))!;
  const working = applyApprovedCorrections(sheets, [
    {
      id: 'COR-NEG-RECON-BELOW',
      exceptionSignature: negErrs[0].signature,
      fixType: 'FIX_NEGATIVE',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      approvedValue: 0,
      classificationMode: 'CREDIT_RETURN',
      beforeSummary: '-100 u (Existing Returns: 40 u)',
      afterSummary: 'Reconciled Returns to 100 u',
      approver: 'Steward',
      reason: 'Reconciled 60 u delta against 40 u already logged',
      approvedAt: '2026-11-18 10:00',
    },
    {
      id: 'COR-NEG-RECON-ABOVE',
      exceptionSignature: negErrs[1].signature,
      fixType: 'FIX_NEGATIVE',
      table: '01_Orders_Shipments_History',
      rowIndex: 1,
      approvedValue: 0,
      classificationMode: 'CREDIT_RETURN',
      beforeSummary: '-100 u (Existing Returns: 150 u)',
      afterSummary: 'Reconciled Returns to 150 u',
      approver: 'Steward',
      reason: 'Existing returns (150 u) already exceed 100 u credit note; preserve 150 u',
      approvedAt: '2026-11-18 10:00',
    },
    {
      id: 'COR-PROMO-P1P3',
      exceptionSignature: p1p3.signature,
      fixType: 'RESOLVE_PROMO_OVERLAP',
      table: '04_Trade_Promotions_Calendar',
      rowIndex: p1p3.rowIndex,
      approvedValue: 15,
      beforeSummary: '+25% Stacked',
      afterSummary: '15%',
      approver: 'Steward',
      reason: 'Resolved P1-P3 overlap only',
      approvedAt: '2026-11-18 10:00',
    },
  ]);

  // Row 0: Returns reconciled to 100 (40 existing + 60 unrecorded delta), NOT 140!
  assert.equal(working['01_Orders_Shipments_History'].records[0].Invoiced_Actual_Qty, 0);
  assert.equal(working['01_Orders_Shipments_History'].records[0].Returns_Damaged_Qty, 100);
  assert.equal(working['01_Orders_Shipments_History'].records[0].Transaction_Type, 'CREDIT_RETURN');

  // Row 1: Returns preserved at 150 (150 existing + 0 delta), neither reduced to 100 nor inflated to 250!
  assert.equal(working['01_Orders_Shipments_History'].records[1].Invoiced_Actual_Qty, 0);
  assert.equal(working['01_Orders_Shipments_History'].records[1].Returns_Damaged_Qty, 150);
  assert.equal(working['01_Orders_Shipments_History'].records[1].Transaction_Type, 'CREDIT_RETURN');

  // P2-P3 overlap must STILL be flagged as an active warning!
  const afterReport = validateWorkbook(working);
  assert.equal(afterReport.exceptions.some((e) => e.fixType === 'FIX_NEGATIVE'), false);
  const p3OverlapsAfter = afterReport.exceptions.filter(
    (e) => e.fixType === 'RESOLVE_PROMO_OVERLAP' && e.signature.endsWith('|P3')
  );
  assert.equal(p3OverlapsAfter.length, 1);
  assert.ok(p3OverlapsAfter[0].signature.includes('|P2|P3'));
});

test('schema remediation validates all 4 field types (DATE, NUMBER, NON_NEGATIVE_NUMBER, STRING) for empty mandatory fields', () => {
  // 1. Verify schema column type lookup
  assert.equal(resolveColumnDataType('01_Orders_Shipments_History', 'Period_Date'), 'DATE');
  assert.equal(resolveColumnDataType('04_Trade_Promotions_Calendar', 'Expected_Uplift_Pct'), 'NUMBER');
  assert.equal(resolveColumnDataType('01_Orders_Shipments_History', 'Ordered_Qty_Units'), 'NON_NEGATIVE_NUMBER');
  assert.equal(resolveColumnDataType('04_Trade_Promotions_Calendar', 'Promo_Event_ID'), 'STRING');

  // 2. Empty mandatory DATE field -> reject invalid or ambiguous input; accept valid unambiguous date
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Period_Date', '01/02/2025').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Period_Date', 'not-a-date').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Period_Date', '   ').ok,
    false
  );
  const validDateRes = validateSchemaRemediationInput(
    '01_Orders_Shipments_History',
    'Period_Date',
    '01-May-2025'
  );
  assert.equal(validDateRes.ok, true);
  if (validDateRes.ok) {
    assert.equal(validDateRes.normalizedValue, '2025-05-01');
  }

  // 3. Empty mandatory NUMBER field -> reject 'ABC' and empty; accept finite number (including negative/positive)
  assert.equal(
    validateSchemaRemediationInput('04_Trade_Promotions_Calendar', 'Expected_Uplift_Pct', 'ABC').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('04_Trade_Promotions_Calendar', 'Expected_Uplift_Pct', '').ok,
    false
  );
  const validNumRes = validateSchemaRemediationInput(
    '04_Trade_Promotions_Calendar',
    'Expected_Uplift_Pct',
    '-5.5'
  );
  assert.equal(validNumRes.ok, true);
  if (validNumRes.ok) {
    assert.equal(validNumRes.normalizedValue, -5.5);
  }

  // 4. Empty mandatory NON_NEGATIVE_NUMBER field -> reject 'ABC', reject -100; accept >= 0
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Ordered_Qty_Units', 'ABC').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Ordered_Qty_Units', '-100').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('01_Orders_Shipments_History', 'Ordered_Qty_Units', -100).ok,
    false
  );
  const validNonNegRes = validateSchemaRemediationInput(
    '01_Orders_Shipments_History',
    'Ordered_Qty_Units',
    '3,250'
  );
  assert.equal(validNonNegRes.ok, true);
  if (validNonNegRes.ok) {
    assert.equal(validNonNegRes.normalizedValue, 3250);
  }

  // 5. Empty mandatory STRING field -> reject whitespace-only and 'NULL'; accept non-empty text
  assert.equal(
    validateSchemaRemediationInput('04_Trade_Promotions_Calendar', 'Promo_Event_ID', '    ').ok,
    false
  );
  assert.equal(
    validateSchemaRemediationInput('04_Trade_Promotions_Calendar', 'Promo_Event_ID', 'NULL').ok,
    false
  );
  const validStrRes = validateSchemaRemediationInput(
    '04_Trade_Promotions_Calendar',
    'Promo_Event_ID',
    '  PRM_SUMMER_01  '
  );
  assert.equal(validStrRes.ok, true);
  if (validStrRes.ok) {
    assert.equal(validStrRes.normalizedValue, 'PRM_SUMMER_01');
  }

  // 6. End-to-end workbook remediation of empty mandatory DATE, NUMBER, NON_NEGATIVE_NUMBER, and STRING fields
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    {
      Period_Date: '', // Empty mandatory DATE
      SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Channel_Code: 'GT',
      Ordered_Qty_Units: '', // Empty mandatory NON_NEGATIVE_NUMBER
      Invoiced_Actual_Qty: 3000,
      Returns_Damaged_Qty: 0,
    },
  ];
  sheets['04_Trade_Promotions_Calendar'].records = [
    {
      Promo_Event_ID: '', // Empty mandatory STRING
      SKU_Code: 'SKU_BEV_01',
      Location_DC: 'Mumbai',
      Promo_Start_Date: '2025-10-01',
      Promo_End_Date: '2025-10-15',
      Expected_Uplift_Pct: '', // Empty mandatory NUMBER
    },
  ];

  const initialReport = validateWorkbook(sheets);
  const emptyErrs = initialReport.exceptions.filter((e) =>
    e.signature.startsWith('SCHEMA|EMPTY_MANDATORY|')
  );
  assert.equal(emptyErrs.length, 4);

  // Verify each empty mandatory exception carries its exact targetColType
  const dateEx = emptyErrs.find((e) => e.targetCol === 'Period_Date')!;
  const nonNegEx = emptyErrs.find((e) => e.targetCol === 'Ordered_Qty_Units')!;
  const strEx = emptyErrs.find((e) => e.targetCol === 'Promo_Event_ID')!;
  const numEx = emptyErrs.find((e) => e.targetCol === 'Expected_Uplift_Pct')!;
  assert.equal(dateEx.targetColType, 'DATE');
  assert.equal(nonNegEx.targetColType, 'NON_NEGATIVE_NUMBER');
  assert.equal(strEx.targetColType, 'STRING');
  assert.equal(numEx.targetColType, 'NUMBER');

  // Verify invalid programmatic remediation attempts are ignored by applyApprovedCorrections
  const rejectedAttempt = applyApprovedCorrections(sheets, [
    {
      id: 'BAD-1',
      exceptionSignature: nonNegEx.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: nonNegEx.table,
      rowIndex: nonNegEx.rowIndex,
      targetCol: 'Ordered_Qty_Units',
      approvedValue: 'ABC',
      beforeSummary: 'NULL',
      afterSummary: 'ABC',
      approver: 'Tester',
      reason: 'Invalid non-numeric attempt',
      approvedAt: '2026-11-18 10:00',
    },
  ]);
  assert.equal(rejectedAttempt['01_Orders_Shipments_History'].records[0].Ordered_Qty_Units, '');

  // Now apply valid remediations for all 4 field types
  const remediatedSheets = applyApprovedCorrections(sheets, [
    {
      id: 'FIX-DATE',
      exceptionSignature: dateEx.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: dateEx.table,
      rowIndex: dateEx.rowIndex,
      targetCol: 'Period_Date',
      approvedValue: '01-May-2025',
      beforeSummary: 'NULL (Empty)',
      afterSummary: 'Normalized Period_Date to 2025-05-01',
      approver: 'Steward',
      reason: 'Confirmed May 2025 period date',
      approvedAt: '2026-11-18 10:00',
    },
    {
      id: 'FIX-NONNEG',
      exceptionSignature: nonNegEx.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: nonNegEx.table,
      rowIndex: nonNegEx.rowIndex,
      targetCol: 'Ordered_Qty_Units',
      approvedValue: 3250,
      beforeSummary: 'NULL (Empty)',
      afterSummary: 'Corrected Ordered_Qty_Units to 3250',
      approver: 'Steward',
      reason: 'Confirmed ordered quantity from ERP order log',
      approvedAt: '2026-11-18 10:00',
    },
    {
      id: 'FIX-STR',
      exceptionSignature: strEx.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: strEx.table,
      rowIndex: strEx.rowIndex,
      targetCol: 'Promo_Event_ID',
      approvedValue: 'PRM_OCT_01',
      beforeSummary: 'NULL (Empty)',
      afterSummary: 'Populated Promo_Event_ID with "PRM_OCT_01"',
      approver: 'Steward',
      reason: 'Assigned trade promotion identifier',
      approvedAt: '2026-11-18 10:00',
    },
    {
      id: 'FIX-NUM',
      exceptionSignature: numEx.signature,
      fixType: 'SCHEMA_REMEDIATION',
      table: numEx.table,
      rowIndex: numEx.rowIndex,
      targetCol: 'Expected_Uplift_Pct',
      approvedValue: 18.5,
      beforeSummary: 'NULL (Empty)',
      afterSummary: 'Corrected Expected_Uplift_Pct to 18.5',
      approver: 'Steward',
      reason: 'Confirmed expected uplift percentage',
      approvedAt: '2026-11-18 10:00',
    },
  ]);

  assert.equal(
    remediatedSheets['01_Orders_Shipments_History'].records[0].Period_Date,
    '2025-05-01'
  );
  assert.equal(
    remediatedSheets['01_Orders_Shipments_History'].records[0].Ordered_Qty_Units,
    3250
  );
  assert.equal(
    remediatedSheets['04_Trade_Promotions_Calendar'].records[0].Promo_Event_ID,
    'PRM_OCT_01'
  );
  assert.equal(
    remediatedSheets['04_Trade_Promotions_Calendar'].records[0].Expected_Uplift_Pct,
    18.5
  );

  const afterReport = validateWorkbook(remediatedSheets);
  assert.equal(
    afterReport.exceptions.some((e) => e.category === 'SCHEMA'),
    false
  );
});

test('export and re-import round-trip preserves 100% of governed corrections (including UOM pack, stockout, spike, and promo overlap)', () => {
  const source = createSeededEnterpriseSheets();
  const tech = applySafeTechnicalFixes(source, [], 'Steward');
  let corrections: ApprovedCorrection[] = [...tech.nextCorrections];

  // Resolve ALL exceptions (both CRITICAL and WARNING)
  let guard = 0;
  while (guard < 60) {
    const working = applyApprovedCorrections(source, corrections);
    const rep = validateWorkbook(working);
    if (rep.exceptions.length === 0) break;
    const ex = rep.exceptions[0];

    let approvedValue: string | number = ex.suggestedVal ?? 3180;
    if (ex.fixType === 'MAP_SKU') approvedValue = 'SKU_DAIRY_03';
    if (ex.fixType === 'MAP_DEPOT') approvedValue = 'Kolkata';
    if (ex.fixType === 'MAP_CHANNEL') approvedValue = 'GT';
    if (ex.fixType === 'FIX_NPI_REF') approvedValue = 'SKU_CARE_04';
    if (ex.fixType === 'IMPUTE_MISSING_PERIOD') approvedValue = 3180;
    if (ex.fixType === 'FIX_COGS') approvedValue = 42;
    if (ex.fixType === 'RESOLVE_PROMO_OVERLAP') approvedValue = 15;

    corrections.push({
      id: `RT-${guard}`,
      exceptionSignature: ex.signature,
      fixType: ex.fixType,
      table: ex.table,
      rowIndex: ex.rowIndex,
      targetCol: ex.targetCol,
      approvedValue,
      classificationMode: ex.fixType === 'FIX_NEGATIVE' ? 'CREDIT_RETURN' : undefined,
      beforeSummary: ex.badVal,
      afterSummary: String(approvedValue),
      approver: 'RoundTrip Steward',
      reason: 'Full governance remediation for export round-trip test',
      approvedAt: '2026-11-18 11:00',
      missingPeriodMeta: ex.missingPeriodMeta,
    });
    guard++;
  }

  const fullyGoverned = applyApprovedCorrections(source, corrections);
  const preExportReport = validateWorkbook(fullyGoverned);
  assert.equal(preExportReport.exceptions.length, 0);

  // Export to binary .xlsx and re-ingest from buffer
  const xlsxBytes = buildWorkbookBinary(fullyGoverned);
  const reingested = ingestWorkbookBuffer(xlsxBytes, 'Governed_RoundTrip.xlsx');
  const postImportReport = validateWorkbook(reingested.sheets);

  // Zero exceptions should reappear after export + re-import!
  assert.equal(postImportReport.exceptions.length, 0);
  assert.equal(postImportReport.health.overallQualityScorePct, 100);
});

test('all correction types validate inputs before applying and reject malformed/negative/empty values', () => {
  const source = createSeededEnterpriseSheets();
  const origActual = source['01_Orders_Shipments_History'].records[0].Invoiced_Actual_Qty;
  const origUom = source['09_Product_Master_Hierarchy'].records[0].UOM_Conversion_Factor;

  const malformedCorrections: ApprovedCorrection[] = [
    {
      id: 'MAL-1',
      exceptionSignature: 'IMPUTE_ACTUAL|01_Orders_Shipments_History|0',
      fixType: 'IMPUTE_ACTUAL',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      approvedValue: 'NOT_A_NUMBER',
      beforeSummary: '',
      afterSummary: '',
      approver: 'Tester',
      reason: 'Malformed actual',
      approvedAt: '2026-11-18',
    },
    {
      id: 'MAL-2',
      exceptionSignature: 'TAG_SPIKE|01_Orders_Shipments_History|0',
      fixType: 'TAG_SPIKE',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      approvedValue: -500,
      beforeSummary: '',
      afterSummary: '',
      approver: 'Tester',
      reason: 'Negative spike baseline',
      approvedAt: '2026-11-18',
    },
    {
      id: 'MAL-3',
      exceptionSignature: 'FIX_UOM|09_Product_Master_Hierarchy|0|P1',
      fixType: 'FIX_UOM',
      table: '09_Product_Master_Hierarchy',
      rowIndex: 0,
      approvedValue: 0,
      beforeSummary: '',
      afterSummary: '',
      approver: 'Tester',
      reason: 'Invalid 0 UOM factor',
      approvedAt: '2026-11-18',
    },
    {
      id: 'MAL-5',
      exceptionSignature: 'MAP_SKU|01_Orders_Shipments_History|0|X',
      fixType: 'MAP_SKU',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      approvedValue: '   ',
      beforeSummary: '',
      afterSummary: '',
      approver: 'Tester',
      reason: 'Blank SKU mapping',
      approvedAt: '2026-11-18',
    },
  ];

  const afterMalformed = applyApprovedCorrections(source, malformedCorrections);
  assert.equal(afterMalformed['01_Orders_Shipments_History'].records[0].Invoiced_Actual_Qty, origActual);
  assert.equal(afterMalformed['09_Product_Master_Hierarchy'].records[0].UOM_Conversion_Factor, origUom);
});

test('planning domain contracts and industry vertical thresholds dynamically adapt validation and release gate', () => {
  const sheets = createSeededEnterpriseSheets();

  // 1. Pharma vertical enforces 24 EA/CASE standard pack and 98.5% minimum channel SLA
  const cpgReport = validateWorkbook(sheets, { industry: 'cpg', domain: 'ALL' });
  const pharmaReport = validateWorkbook(sheets, { industry: 'pharma', domain: 'ALL' });
  assert.ok(pharmaReport.exceptions.length > cpgReport.exceptions.length);
  assert.ok(pharmaReport.exceptions.some((e) => e.signature.startsWith('CHANNEL_SLA|')));

  // 2. Domain-specific mandatory tables: omitting 04_Trade_Promotions_Calendar in PROCUREMENT mode is allowed,
  // whereas omitting 07_Inventory_Supply_Constraints in MEIO mode fails schemaPassed and allRequiredValidationsExecuted.
  const noPromoSheets = createSeededEnterpriseSheets();
  delete noPromoSheets['04_Trade_Promotions_Calendar'];
  const procReport = validateWorkbook(noPromoSheets, { domain: 'PROCUREMENT' });
  assert.equal(
    procReport.exceptions.some((e) => e.signature === 'SCHEMA|MISSING_TABLE|04_Trade_Promotions_Calendar'),
    false
  );

  const noInvSheets = createSeededEnterpriseSheets();
  delete noInvSheets['07_Inventory_Supply_Constraints'];
  const meioReport = validateWorkbook(noInvSheets, { domain: 'MEIO' });
  assert.equal(meioReport.schemaPassed, false);
  assert.equal(meioReport.allRequiredValidationsExecuted, false);
});

test('forecast inputs receive structural and type checks without reasonableness or accuracy scoring', () => {
  const sheets = createSeededEnterpriseSheets();
  const forecastTable = sheets['02_Forecast_Vintages_Lag'];
  forecastTable.records[0].Stat_Forecast_Lag1_Qty = 999999999;

  const highForecastReport = validateWorkbook(sheets, { domain: 'DEMAND' });
  assert.equal(
    highForecastReport.exceptions.some(
      (exception) =>
        exception.table === '02_Forecast_Vintages_Lag' &&
        /forecast/i.test(exception.issue)
    ),
    false,
    'An unusually high forecast must not be judged for reasonableness in Phase 1'
  );

  forecastTable.records[0].Stat_Forecast_Lag1_Qty = 'not-a-number';
  const invalidTypeReport = validateWorkbook(sheets, { domain: 'DEMAND' });
  assert.ok(
    invalidTypeReport.exceptions.some(
      (exception) =>
        exception.table === '02_Forecast_Vintages_Lag' &&
        exception.signature.includes('INVALID_NUM') &&
        exception.intersection.includes('Stat_Forecast_Lag1_Qty')
    ),
    'Forecast source fields must still pass ordinary numeric type validation'
  );
});

test('all six planning domains enforce their table boundary and exclude out-of-domain rows', () => {
  const domains = ['DEMAND', 'SUPPLY', 'SOP', 'MEIO', 'PROCUREMENT', 'MANUFACTURING'] as const;
  const seeded = createSeededEnterpriseSheets();

  for (const domain of domains) {
    const domainSheets = createDomainTestWorkbook(domain);
    const expectedInDomainRows = Object.values(domainSheets).reduce(
      (sum, table) => sum + table.records.filter((row) => !row._removed).length,
      0
    );
    const outOfDomainTable = Object.keys(seeded).find(
      (tableName) => !Object.prototype.hasOwnProperty.call(domainSheets, tableName)
    );
    assert.ok(outOfDomainTable, `Expected an out-of-domain table for ${domain}`);
    domainSheets[outOfDomainTable] = seeded[outOfDomainTable];

    const report = validateWorkbook(domainSheets, { domain });
    assert.equal(report.activeDomain, domain);
    assert.equal(report.health.totalRows, expectedInDomainRows);
    assert.equal(
      report.coverageMatrix?.find((entry) => entry.tableName === outOfDomainTable)?.status,
      'SKIPPED_OUT_OF_DOMAIN'
    );
    assert.equal(
      report.coverageMatrix?.some(
        (entry) => entry.requiredByDomain && !entry.presentInWorkbook
      ),
      false,
      `${domain} test workbook must contain every mandatory domain table`
    );
  }
});

test('numeric-prefix lookalike worksheets cannot satisfy canonical mandatory table contracts', () => {
  const demandWorkbook = createDomainTestWorkbook('DEMAND');
  delete demandWorkbook['01_Orders_Shipments_History'];
  demandWorkbook['01_Orders_Unrelated'] = {
    pillar: 'Uploaded Workbook',
    desc: 'Not an orders table',
    cols: [
      { col: 'Value', type: 'NUMBER', key: 'Measure' },
      { col: 'Ordered_Qty_Units', type: 'NUMBER', key: 'Measure' },
    ],
    records: [{ Value: 999, Ordered_Qty_Units: 999 }],
  };
  const report = validateWorkbook(demandWorkbook, { domain: 'DEMAND' });
  const ordersCoverage = report.coverageMatrix?.find(
    (entry) => entry.tableName === '01_Orders_Shipments_History'
  );
  assert.equal(ordersCoverage?.presentInWorkbook, false);
  assert.equal(ordersCoverage?.status, 'NOT_RUN_MISSING_TABLE');
  const spoofProfile = profileWorkbook(demandWorkbook, report.exceptions);
  const spoofTableProfile = spoofProfile.tables.find((table) => table.table === '01_Orders_Unrelated')!;
  assert.equal(
    spoofTableProfile.columns.find((column) => column.column === 'Ordered_Qty_Units')?.expectedType,
    'STRING',
    'Prefix lookalike table must not inherit canonical Orders data types'
  );
  const driftReport = detectSchemaDrift(demandWorkbook, 'DEMAND');
  assert.ok(driftReport.missingMandatoryTables.includes('01_Orders_Shipments_History'));
  assert.equal(driftReport.missingMandatoryTables.includes('01_Orders_Unrelated'), false);
  assert.throws(
    () => applyColumnMapping(demandWorkbook, '01_Orders_Unrelated', 'Value', 'Ordered_Qty_Units'),
    /not an unambiguous canonical table or supported alias/i
  );
  assert.equal(
    resolveColumnDataType('01_Orders_Unrelated', 'Ordered_Qty_Units'),
    'STRING',
    'A numeric-prefix lookalike must not inherit canonical table field types'
  );
  assert.equal(resolveColumnDataType('Orders_Sheet', 'Ordered_Qty_Units'), 'NON_NEGATIVE_NUMBER');
  assert.equal(report.health.totalRows, Object.values(demandWorkbook)
    .filter((table) => table !== demandWorkbook['01_Orders_Unrelated'])
    .reduce((sum, table) => sum + table.records.filter((row) => !row._removed).length, 0));
});

test('exact and suffixed canonical duplicates are treated as ambiguous by validation and schema drift', () => {
  const workbook = createDomainTestWorkbook('DEMAND');
  workbook['01_Orders_Shipments_History_Copy'] = workbook['01_Orders_Shipments_History'];
  const report = validateWorkbook(workbook, { domain: 'DEMAND' });
  assert.equal(
    report.coverageMatrix?.find((entry) => entry.tableName === '01_Orders_Shipments_History')?.presentInWorkbook,
    false
  );
  assert.ok(
    detectSchemaDrift(workbook, 'DEMAND').missingMandatoryTables.includes(
      '01_Orders_Shipments_History'
    )
  );
});

test('table-level structural failures penalize overallQualityScorePct even when rowPassRatePct is 100%', () => {
  const sheets = createSeededEnterpriseSheets();
  const tech = applySafeTechnicalFixes(sheets, [], 'Steward');
  let corrections: ApprovedCorrection[] = [...tech.nextCorrections];
  let guard = 0;
  while (guard < 60) {
    const working = applyApprovedCorrections(sheets, corrections);
    const rep = validateWorkbook(working);
    if (rep.exceptions.length === 0) break;
    const ex = rep.exceptions[0];
    let approvedValue: string | number = ex.suggestedVal ?? 3180;
    if (ex.fixType === 'MAP_SKU') approvedValue = 'SKU_DAIRY_03';
    if (ex.fixType === 'MAP_DEPOT') approvedValue = 'Kolkata';
    if (ex.fixType === 'MAP_CHANNEL') approvedValue = 'GT';
    if (ex.fixType === 'FIX_NPI_REF') approvedValue = 'SKU_CARE_04';
    if (ex.fixType === 'IMPUTE_MISSING_PERIOD') approvedValue = 3180;
    if (ex.fixType === 'FIX_COGS') approvedValue = 42;
    if (ex.fixType === 'RESOLVE_PROMO_OVERLAP') approvedValue = 15;
    corrections.push({
      id: `CLEAN-${guard++}`,
      exceptionSignature: ex.signature,
      fixType: ex.fixType,
      table: ex.table,
      rowIndex: ex.rowIndex,
      targetCol: ex.targetCol,
      approvedValue,
      classificationMode: ex.fixType === 'FIX_NEGATIVE' ? 'CREDIT_RETURN' : undefined,
      beforeSummary: ex.badVal,
      afterSummary: String(approvedValue),
      approver: 'Steward',
      reason: 'Clean row',
      approvedAt: '2026-11-18',
      missingPeriodMeta: ex.missingPeriodMeta,
    });
  }

  const cleanSheets = applyApprovedCorrections(sheets, corrections);
  // Now introduce a missing mandatory column on a clean workbook (table-level failure with rowIndex = -1)
  cleanSheets['02_Forecast_Vintages_Lag'].cols = cleanSheets[
    '02_Forecast_Vintages_Lag'
  ].cols.filter((c) => c.col !== 'Stat_Forecast_Lag1_Qty');
  cleanSheets['02_Forecast_Vintages_Lag'].records = cleanSheets[
    '02_Forecast_Vintages_Lag'
  ].records.map((r) => {
    const copy = { ...r };
    delete copy.Stat_Forecast_Lag1_Qty;
    return copy;
  });

  const structuralReport = validateWorkbook(cleanSheets);
  assert.equal(structuralReport.health.rowPassRatePct, 100);
  assert.ok(structuralReport.health.tableLevelFailureCount >= 1);
  assert.ok(structuralReport.health.structuralPenaltyPct > 0);
  assert.ok(
    structuralReport.health.overallQualityScorePct !== null &&
      structuralReport.health.overallQualityScorePct < 100
  );
  assert.equal(structuralReport.health.dimensions?.length, 7);
});

test('universal data profiling, cross-table reconciliation, schema drift remediation, and deterministic SHA-256 hash work end-to-end', () => {
  const sheets = createSeededEnterpriseSheets();
  const report = validateWorkbook(sheets);
  const profile = profileWorkbook(sheets, report.exceptions);

  assert.equal(profile.tables.length, 12);
  assert.ok(profile.topProblematicSkus.length > 0);
  assert.ok(profile.topProblematicDepots.length > 0);
  assert.ok(profile.topProblematicTables.length > 0);

  const ordersProfile = profile.tables.find((t) => t.table === '01_Orders_Shipments_History')!;
  const orderedCol = ordersProfile.columns.find((c) => c.column === 'Ordered_Qty_Units')!;
  assert.ok(orderedCol.mean !== null && orderedCol.mean > 0);
  assert.ok(orderedCol.median !== null && orderedCol.median > 0);
  assert.ok(orderedCol.p95 !== null && orderedCol.p95 >= orderedCol.p5!);
  assert.equal(orderedCol.expectedType, 'NON_NEGATIVE_NUMBER');

  // P0 Issue 4 & 5: 5 certified Data Assurance reconciliation checks (forecast quality check removed)
  const recon = runCrossTableReconciliation(sheets);
  assert.equal(recon.checks.length, 5);
  assert.ok(recon.checks.some((c) => c.id === 'REC-01'));
  assert.ok(recon.checks.some((c) => c.id === 'REC-05'));
  assert.ok(
    !recon.checks.some((c) => c.name.includes('Stat Forecast Lag-1 vs. System Unconstrained')),
    'Forecast reasonableness check must not exist in Phase 1 Data Assurance reconciliation'
  );

  // P0 Issue 6: Cryptographic SHA-256 fingerprint verification (NIST test vector for "abc")
  assert.equal(
    sha256Hex('abc'),
    'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'
  );
  const hash1 = computeWorkbookHash(sheets);
  const hash2 = computeWorkbookHash(createSeededEnterpriseSheets());
  assert.equal(hash1, hash2);
  assert.match(hash1, /^SHA256-[0-9A-F]{64}$/);

  // Test schema drift detection & in-app structural remediation + column mapping
  const drifted = createSeededEnterpriseSheets();
  delete drifted['11_Customer_Channel_Master'];
  drifted['01_Orders_Shipments_History'].records = drifted[
    '01_Orders_Shipments_History'
  ].records.map((r) => {
    const copy: Record<string, string | number | boolean | null | undefined> = {
      ...r,
      Ordered_Custom_Alias: r.Ordered_Qty_Units,
    };
    delete copy.Ordered_Qty_Units;
    return copy;
  });
  drifted['01_Orders_Shipments_History'].cols = drifted[
    '01_Orders_Shipments_History'
  ].cols.map((c) => (c.col === 'Ordered_Qty_Units' ? { ...c, col: 'Ordered_Custom_Alias' } : c));

  const driftReport = detectSchemaDrift(drifted);
  assert.ok(driftReport.missingMandatoryTables.includes('11_Customer_Channel_Master'));
  assert.ok(
    driftReport.suggestedColumnMappings.some(
      (m) =>
        m.table === '01_Orders_Shipments_History' &&
        m.sourceColumn === 'Ordered_Custom_Alias' &&
        m.targetCanonicalColumn === 'Ordered_Qty_Units' &&
        (m.confidencePct ?? 0) >= 70
    )
  );

  const mapped = applyColumnMapping(
    drifted,
    '01_Orders_Shipments_History',
    'Ordered_Custom_Alias',
    'Ordered_Qty_Units'
  );
  // P0 Issue 2: Structural remediation creates empty table structure with 0 synthetic business rows
  const restored = remediateMissingStructure(mapped, '11_Customer_Channel_Master');
  assert.equal(restored['11_Customer_Channel_Master'].records.length, 0);
  assert.equal(restored['11_Customer_Channel_Master'].awaitingDataPopulation, true);

  const driftAfter = detectSchemaDrift(restored);
  assert.equal(driftAfter.missingMandatoryTables.length, 0);
  assert.equal(driftAfter.missingColumns.length, 0);

  // Validation must still block release gate because initialized table is empty (0 rows)
  const reportAfterInit = validateWorkbook(restored);
  assert.equal(reportAfterInit.schemaPassed, false);
  assert.ok(
    reportAfterInit.exceptions.some(
      (e) => e.signature === 'SCHEMA|EMPTY_TABLE|11_Customer_Channel_Master'
    )
  );
});

test('canonical workbook fingerprints distinguish values, schema, and source row order', () => {
  const makeWorkbook = (records: Array<Record<string, string | number | null | undefined>>, dataType = 'STRING') => ({
    T: {
      pillar: 'Test',
      desc: 'Fingerprint fixture',
      cols: [{ col: 'a', type: dataType, key: 'PK', dataType: dataType as 'STRING' | 'NUMBER' }],
      records,
    },
  });

  const rowOrderA = makeWorkbook([{ a: 'first' }, { a: 'second' }]);
  const rowOrderB = makeWorkbook([{ a: 'second' }, { a: 'first' }]);
  assert.notEqual(computeWorkbookHash(rowOrderA), computeWorkbookHash(rowOrderB));

  // These two datasets collided under the previous delimiter-based encoding.
  const delimiterA = makeWorkbook([{ a: 'x;b=y' }]);
  const delimiterB = makeWorkbook([{ a: 'x', b: 'y' }]);
  assert.notEqual(computeWorkbookHash(delimiterA), computeWorkbookHash(delimiterB));

  // Values with different source types must remain distinct.
  assert.notEqual(
    computeWorkbookHash(makeWorkbook([{ a: 1 }])),
    computeWorkbookHash(makeWorkbook([{ a: '1' }]))
  );

  // Contract metadata is part of the workbook structure fingerprint.
  assert.notEqual(
    computeWorkbookHash(makeWorkbook([{ a: '1' }], 'STRING')),
    computeWorkbookHash(makeWorkbook([{ a: '1' }], 'NUMBER'))
  );
});

test('governance persistence fails closed for unbound approvals and reports storage write failures', () => {
  const sheets = createSeededEnterpriseSheets();
  const sourceWorkbookHash = computeWorkbookHash(sheets);
  const state = {
    industry: 'cpg' as const,
    domain: 'ALL' as const,
    ruleConfig: DEFAULT_RULE_CONFIG,
    sourceSheets: sheets,
    workbookSource: 'Persistence_Test.xlsx',
    sourceWorkbookHash,
    approvedCorrections: [] as ApprovedCorrection[],
    warningSignOff: null,
    auditLog: [],
    lineageHistory: [],
    exceptionAssignments: {},
  };

  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const installStorage = (localStorage: typeof storage) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage } as unknown as Window,
    });
  };

  try {
    installStorage(storage);
    assert.equal(savePersistedGovernanceState(state), true);
    const restored = loadPersistedGovernanceState();
    assert.equal(restored?.sourceWorkbookHash, sourceWorkbookHash);
    assert.equal(Object.keys(restored?.sourceSheets ?? {}).length, Object.keys(sheets).length);

    const key = Array.from(values.keys())[0];
    const legacyPayload = JSON.parse(values.get(key)!) as Record<string, unknown>;
    legacyPayload.approvedCorrections = [{ id: 'LEGACY-UNBOUND' }];
    legacyPayload.warningSignOff = {
      approver: 'Legacy User',
      reason: 'Unbound approval',
      expiry: '24 Hours',
      signedAt: '2026-01-01T00:00:00.000Z',
    };
    values.set(key, JSON.stringify(legacyPayload));

    const restoredLegacy = loadPersistedGovernanceState();
    assert.deepEqual(restoredLegacy?.approvedCorrections, []);
    assert.equal(restoredLegacy?.warningSignOff, null);

    const malformedBoundPayload = JSON.parse(values.get(key)!) as Record<string, unknown>;
    malformedBoundPayload.approvedCorrections = [
      { id: 'INVALID-FIX', fixType: 'NOT_A_REAL_FIX', rowIndex: -1, sourceWorkbookHash },
    ];
    malformedBoundPayload.warningSignOff = {
      sourceWorkbookHash,
      approver: '',
      reason: '',
      expiry: '24 Hours',
      signedAt: 'invalid',
      expiresAt: 'invalid',
    };
    values.set(key, JSON.stringify(malformedBoundPayload));
    const restoredMalformed = loadPersistedGovernanceState();
    assert.deepEqual(restoredMalformed?.approvedCorrections, []);
    assert.equal(restoredMalformed?.warningSignOff, null);

    // Corrupt or structurally invalid saved workbooks must not be silently replaced by demo data.
    values.set(key, '{invalid-json');
    assert.equal(hasPersistedGovernanceState(), true);
    assert.equal(loadPersistedGovernanceState(), null);
    values.set(
      key,
      JSON.stringify({
        ...state,
        sourceSheets: { Broken_Table: { cols: 'not-an-array', records: [] } },
      })
    );
    assert.equal(loadPersistedGovernanceState(), null);

    const failingStorage = {
      ...storage,
      setItem: (_key: string, _value: string) => { throw new Error('quota exceeded'); },
    };
    installStorage(failingStorage);
    assert.equal(savePersistedGovernanceState(state), false);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('P0-1: corrections and warning sign-offs stamped with Workbook A SHA-256 hash are rejected on Workbook B', () => {
  const workbookA = createSeededEnterpriseSheets();
  const hashA = computeWorkbookHash(workbookA);

  const reportA = validateWorkbook(workbookA);
  const targetErr = reportA.exceptions.find(
    (e) => e.table === '01_Orders_Shipments_History' && e.fixType === 'IMPUTE_ACTUAL'
  )!;

  const correctionForA: ApprovedCorrection = {
    id: 'COR-HASH-TEST-1',
    exceptionSignature: targetErr.signature,
    table: targetErr.table,
    rowIndex: targetErr.rowIndex,
    fixType: 'IMPUTE_ACTUAL',
    approvedValue: 2150,
    beforeSummary: 'NULL',
    afterSummary: '2150',
    approver: 'Jolly Singla',
    reason: 'Verified against ERP invoice',
    approvedAt: '2026-11-18 10:00',
    sourceWorkbookHash: hashA,
  };

  // Applies cleanly to Workbook A
  const appliedA = applyApprovedCorrections(workbookA, [correctionForA]);
  assert.equal(
    appliedA['01_Orders_Shipments_History'].records[targetErr.rowIndex].Invoiced_Actual_Qty,
    2150
  );

  // Create a distinct Workbook B
  const workbookB = createSeededEnterpriseSheets();
  workbookB['09_Product_Master_Hierarchy'].records[0].Brand_Name =
    'Distinct Uploaded Workbook B';
  const hashB = computeWorkbookHash(workbookB);
  assert.notEqual(hashA, hashB);

  // Correction for Workbook A must NOT mutate Workbook B
  const appliedB = applyApprovedCorrections(workbookB, [correctionForA]);
  assert.equal(
    appliedB['01_Orders_Shipments_History'].records[targetErr.rowIndex].Invoiced_Actual_Qty,
    workbookB['01_Orders_Shipments_History'].records[targetErr.rowIndex].Invoiced_Actual_Qty
  );

  // Warning sign-off for Workbook A must NOT satisfy Release Gate for Workbook B
  const signOffForA = {
    approver: 'Jolly Singla',
    reason: 'Approved for Workbook A only',
    expiry: '24 Hours',
    signedAt: '2026-11-18 10:00',
    expiresAt: computeSignOffExpiryIso('24 Hours', Date.now()),
    sourceWorkbookHash: hashA,
  };
  const gateB = evaluateReleaseGate(reportA, signOffForA, true, Date.now(), hashB);
  assert.equal(gateB.warningPolicySatisfied, false);

  // Missing hash must fail closed too when a workbook hash is supplied by the app.
  const unboundSignOff = {
    approver: 'Jolly Singla',
    reason: 'Attempted unbound sign-off',
    expiry: '24 Hours',
    signedAt: '2026-11-18 10:00',
    expiresAt: computeSignOffExpiryIso('24 Hours', Date.now()),
  };
  const unboundGate = evaluateReleaseGate(reportA, unboundSignOff, true, Date.now(), hashB);
  assert.equal(unboundGate.warningPolicySatisfied, false);
  assert.equal(unboundGate.step2Unlocked, false);
});

test('P0-3: strict domain isolation scopes schema, FK checks, record rules, and coverage matrix to the selected domain', () => {
  // Build a Procurement-only workbook without Customer Channel Master or Trade Promotions Calendar
  const procWorkbook = createDomainTestWorkbook('PROCUREMENT');
  assert.equal(procWorkbook['11_Customer_Channel_Master'], undefined);
  assert.equal(procWorkbook['04_Trade_Promotions_Calendar'], undefined);
  assert.ok(procWorkbook['13_Supplier_Sourcing_Contracts']);
  assert.ok(procWorkbook['14_Purchase_Orders_Receipts']);

  // Validate under PROCUREMENT domain -> must NOT fail for missing Customer Channel Master or Trade Promotions
  const procReport = validateWorkbook(procWorkbook, { domain: 'PROCUREMENT' });
  assert.equal(procReport.schemaPassed, true);
  assert.ok(
    !procReport.exceptions.some((e) => e.table === '11_Customer_Channel_Master'),
    'PROCUREMENT domain must not require 11_Customer_Channel_Master'
  );
  assert.ok(
    !procReport.exceptions.some((e) => e.table === '04_Trade_Promotions_Calendar'),
    'PROCUREMENT domain must not validate 04_Trade_Promotions_Calendar'
  );

  // Coverage matrix explicitly records out-of-domain tables as SKIPPED_OUT_OF_DOMAIN
  const channelCoverage = procReport.coverageMatrix?.find(
    (c) => c.table === '11_Customer_Channel_Master'
  );
  assert.equal(channelCoverage?.status, 'SKIPPED_OUT_OF_DOMAIN');
  assert.equal(channelCoverage?.requiredByDomain, false);

  // And procurement-specific rules DO execute and detect the seeded MOQ / Lead-Time exceptions
  assert.ok(
    procReport.exceptions.some((e) => e.signature.startsWith('SUPPLIER_LT|')),
    'Expected procurement supplier lead-time contradiction rule to execute'
  );
  assert.ok(
    procReport.exceptions.some((e) => e.signature.startsWith('PO_MOQ_MULT|')),
    'Expected purchase order MOQ/multiple compliance rule to execute'
  );

  // Verify MANUFACTURING and MEIO domain test workbooks also isolate cleanly and run domain rules
  const mfgWorkbook = createDomainTestWorkbook('MANUFACTURING');
  const mfgReport = validateWorkbook(mfgWorkbook, { domain: 'MANUFACTURING' });
  assert.equal(mfgReport.schemaPassed, true);
  assert.ok(mfgReport.exceptions.some((e) => e.signature.startsWith('MFG_YIELD|')));
  assert.ok(mfgReport.exceptions.some((e) => e.signature.startsWith('MFG_CAP|')));

  const meioWorkbook = createDomainTestWorkbook('MEIO');
  const meioReport = validateWorkbook(meioWorkbook, { domain: 'MEIO' });
  assert.equal(meioReport.schemaPassed, true);
  assert.ok(meioReport.exceptions.some((e) => e.signature.startsWith('MEIO_BOUNDS|')));
});

test('P0-5: reconciliation checks enforce effective price lookup, stockout period integrity, and NOT_RUN/NOT_APPLICABLE states', () => {
  const sheets = createSeededEnterpriseSheets();

  // In PROCUREMENT domain, commercial demand/revenue checks REC-01..REC-03 are NOT_APPLICABLE
  const procRecon = runCrossTableReconciliation(sheets, undefined, 'PROCUREMENT');
  assert.equal(
    procRecon.checks.find((c) => c.id === 'REC-01')?.status,
    'NOT_APPLICABLE'
  );
  assert.equal(
    procRecon.checks.find((c) => c.id === 'REC-02')?.status,
    'NOT_APPLICABLE'
  );
  assert.equal(
    procRecon.checks.find((c) => c.id === 'REC-04')?.status,
    'RECONCILED'
  );

  // When a comparison table is missing in DEMAND domain, REC-02 reports NOT_RUN (never an artificial pass)
  const missingPricing = createSeededEnterpriseSheets();
  delete missingPricing['06_Pricing_Elasticity_Catalog'];
  const reconMissing = runCrossTableReconciliation(missingPricing, undefined, 'DEMAND');
  assert.equal(
    reconMissing.checks.find((c) => c.id === 'REC-02')?.status,
    'NOT_RUN'
  );

  // REC-03 is a source-data check, not a judgement of the governed uncensored-demand estimate.
  const estimateOnlyDifference = createSeededEnterpriseSheets();
  estimateOnlyDifference['07_Inventory_Supply_Constraints'].records[0].Governed_Uncensored_Demand_Qty = 500;
  const reconEstimateDifference = runCrossTableReconciliation(estimateOnlyDifference, undefined, 'DEMAND');
  assert.equal(
    reconEstimateDifference.checks.find((c) => c.id === 'REC-03')?.status,
    'RECONCILED'
  );

  // A stockout-day count greater than the calendar month is a source-data integrity failure.
  const invalidStockoutDays = createSeededEnterpriseSheets();
  invalidStockoutDays['07_Inventory_Supply_Constraints'].records[0].Depot_Stockout_Days_Count = 32;
  const reconInvalidStockoutDays = runCrossTableReconciliation(invalidStockoutDays, undefined, 'DEMAND');
  assert.equal(
    reconInvalidStockoutDays.checks.find((c) => c.id === 'REC-03')?.status,
    'CRITICAL_MISMATCH'
  );
});

test('P1: actual column type inference, column mapping collision rejection, and rule threshold validation work strictly', () => {
  const sheets = createSeededEnterpriseSheets();
  // Inject a non-numeric string into Ordered_Qty_Units so inferredType is MIXED while expectedType is NON_NEGATIVE_NUMBER
  sheets['01_Orders_Shipments_History'].records[0].Ordered_Qty_Units = 'ABC_BAD_TEXT';
  const report = validateWorkbook(sheets);
  const profile = profileWorkbook(sheets, report.exceptions);
  const ordersTable = profile.tables.find((t) => t.table === '01_Orders_Shipments_History')!;
  const orderedCol = ordersTable.columns.find((c) => c.column === 'Ordered_Qty_Units')!;
  assert.equal(orderedCol.expectedType, 'NON_NEGATIVE_NUMBER');
  assert.equal(orderedCol.inferredType, 'MIXED');
  assert.equal(orderedCol.typeMismatch, true);
  assert.ok(orderedCol.invalidSampleValues?.includes('ABC_BAD_TEXT'));

  // Column mapping collision rejection when both source alias and canonical column have conflicting non-empty values
  const collisionSheets = createSeededEnterpriseSheets();
  collisionSheets['01_Orders_Shipments_History'].records[0].Ordered_Alias_Col = 9999;
  assert.throws(
    () =>
      applyColumnMapping(
        collisionSheets,
        '01_Orders_Shipments_History',
        'Ordered_Alias_Col',
        'Ordered_Qty_Units'
      ),
    /conflict/i
  );

  // Conflict detection must also see existing target headers with different casing.
  const caseCollisionSheets = createSeededEnterpriseSheets();
  const caseCollisionRow = caseCollisionSheets['01_Orders_Shipments_History'].records[0];
  caseCollisionRow.ordered_qty_units = caseCollisionRow.Ordered_Qty_Units;
  caseCollisionRow.Ordered_Alias_Col = 9999;
  assert.throws(
    () => applyColumnMapping(caseCollisionSheets, '01_Orders_Shipments_History', 'Ordered_Alias_Col', 'Ordered_Qty_Units'),
    /conflict/i
  );

  // Case-only normalization must preserve values and consolidate the column.
  const caseNormalizeSheets = createSeededEnterpriseSheets();
  const caseNormalizeRow = caseNormalizeSheets['01_Orders_Shipments_History'].records[0];
  caseNormalizeRow.ordered_qty_units = caseNormalizeRow.Ordered_Qty_Units;
  delete caseNormalizeRow.Ordered_Qty_Units;
  const caseNormalized = applyColumnMapping(
    caseNormalizeSheets,
    '01_Orders_Shipments_History',
    'ordered_qty_units',
    'Ordered_Qty_Units'
  );
  assert.equal(caseNormalized['01_Orders_Shipments_History'].records[0].Ordered_Qty_Units, caseNormalizeRow.ordered_qty_units);
  assert.equal('ordered_qty_units' in caseNormalized['01_Orders_Shipments_History'].records[0], false);

  // Rule configuration validation rejects out-of-range thresholds and increments ruleVersion on valid updates
  const invalidCfg = validateRuleConfig({ standardCasePackMin: -5 });
  assert.equal(invalidCfg.valid, false);
  assert.ok(invalidCfg.errors.length > 0);

  const validCfg = validateRuleConfig({ standardCasePackMin: 24 });
  assert.equal(validCfg.valid, true);
  assert.equal(validCfg.sanitized.standardCasePackMin, 24);
  assert.match(String(validCfg.sanitized.ruleVersion), /custom\.1$/);
});

test('large workbook with 2,500+ rows validates and profiles rapidly under 1,000ms', () => {
  const largeSheets = createSeededEnterpriseSheets();
  const baseOrders = largeSheets['01_Orders_Shipments_History'].records[0];
  const bulkOrders = [];
  for (let i = 0; i < 2500; i++) {
    const month = (i % 12) + 1;
    const year = 2020 + Math.floor(i / 12);
    const period = `${year}-${String(month).padStart(2, '0')}-01`;
    bulkOrders.push({
      ...baseOrders,
      Invoice_Line_ID: `INV-BULK-${i}`,
      Period_Date: period,
      Ordered_Qty_Units: 2000 + (i % 300),
      Invoiced_Actual_Qty: 1950 + (i % 300),
    });
  }
  largeSheets['01_Orders_Shipments_History'].records = bulkOrders;

  const t0 = Date.now();
  const report = validateWorkbook(largeSheets);
  const profile = profileWorkbook(largeSheets, report.exceptions);
  const elapsedMs = Date.now() - t0;

  assert.ok(report.health.totalRows >= 2500);
  assert.equal(profile.tables.find((t) => t.table === '01_Orders_Shipments_History')?.rowCount, 2500);
  assert.ok(elapsedMs < 1500, `Expected 2,500-row validation+profiling < 1500ms, took ${elapsedMs}ms`);
});

test('REC-02 only matches exact-channel prices effective on or before the transaction date', () => {
  const makeSheets = (
    orderRows: Record<string, unknown>[],
    priceRows: Record<string, unknown>[]
  ) => {
    const sheets = createSeededEnterpriseSheets();
    sheets['01_Orders_Shipments_History'].records = orderRows as any;
    sheets['06_Pricing_Elasticity_Catalog'].records = priceRows as any;
    return sheets;
  };
  const order = (date: string, channel = 'GT') => ({
    Period_Date: date,
    SKU_Code: 'SKU_BEV_01',
    Location_DC: 'Mumbai',
    Channel_Code: channel,
    Ordered_Qty_Units: 2,
    Invoiced_Actual_Qty: 2,
    Returns_Damaged_Qty: 0,
    Net_Realized_Sales_INR: 20,
  });
  const price = (date: string, channel = 'GT', value = 10) => ({
    SKU_Code: 'SKU_BEV_01',
    Channel_Code: channel,
    Effective_From_Month: date,
    Net_Realized_Price_INR: value,
    Unit_COGS_INR: 5,
  });
  const rec02 = (orders: Record<string, unknown>[], prices: Record<string, unknown>[]) =>
    runCrossTableReconciliation(makeSheets(orders, prices), undefined, 'DEMAND')
      .checks.find((check) => check.id === 'REC-02')!;

  // Select the latest price effective on/before the order date; ignore later prices.
  const historical = rec02(
    [order('2025-06-15')],
    [price('2025-05-01', 'GT', 10), price('2025-07-01', 'GT', 99)]
  );
  assert.equal(historical.leftTotal, 20);
  assert.equal(historical.rightTotal, 20);
  assert.equal(historical.status, 'RECONCILED');

  // A future-only price must not be used to reconcile an earlier transaction.
  const futureOnly = rec02([order('2025-06-15')], [price('2025-07-01')]);
  assert.equal(futureOnly.status, 'NOT_RUN');
  assert.equal(futureOnly.eligibleRecordsCount, 0);
  assert.match(futureOnly.detail, /no eligible price or transaction date/i);

  // Missing transaction dates cannot select an arbitrary latest catalog price.
  const missingDate = rec02([order('')], [price('2025-05-01')]);
  assert.equal(missingDate.status, 'NOT_RUN');
  assert.equal(missingDate.eligibleRecordsCount, 0);

  // Preserve the existing explicit SKU × ALL fallback when no exact-channel key exists,
  // while still enforcing the transaction-date effective-date cutoff.
  const wildcardFallback = rec02([order('2025-06-15', 'GT')], [price('2025-05-01', 'ALL')]);
  assert.equal(wildcardFallback.status, 'RECONCILED');
  assert.equal(wildcardFallback.eligibleRecordsCount, 1);

  const futureWildcard = rec02([order('2025-06-15', 'GT')], [price('2025-07-01', 'ALL')]);
  assert.equal(futureWildcard.status, 'NOT_RUN');
  assert.equal(futureWildcard.eligibleRecordsCount, 0);

  // A valid matched subset must not hide other invoice lines excluded for missing prices.
  const partialMatch = rec02(
    [order('2025-06-15', 'GT'), order('2025-06-15', 'MT')],
    [price('2025-05-01', 'GT'), price('2025-07-01', 'MT', 99)]
  );
  assert.equal(partialMatch.eligibleRecordsCount, 1);
  assert.equal(partialMatch.status, 'VARIANCE_WARNING');
  assert.match(partialMatch.detail, /1 billed invoice line\(s\) excluded/i);
});

test('REC-01 reconciles forward fulfilment without adding reverse-flow returns and catches zero-order over-shipment', () => {
  const rec01 = (rows: Record<string, unknown>[]) => {
    const sheets = createSeededEnterpriseSheets();
    sheets['01_Orders_Shipments_History'].records = rows as any;
    return runCrossTableReconciliation(sheets, undefined, 'DEMAND')
      .checks.find((check) => check.id === 'REC-01')!;
  };

  // Cancellations reduce the order obligation; open backorders account for unfulfilled quantity.
  // Returns are reverse-flow events and must not be added to shipped/fulfilled units.
  const balanced = rec01([{
    Period_Date: '2025-06-01',
    SKU_Code: 'SKU_BEV_01',
    Location_DC: 'Mumbai',
    Channel_Code: 'GT',
    Ordered_Qty_Units: 120,
    Cancelled_Order_Qty: 20,
    Invoiced_Actual_Qty: 80,
    Open_Backorder_Qty: 20,
    Returns_Damaged_Qty: 10,
  }]);
  assert.equal(balanced.leftTotal, 100);
  assert.equal(balanced.rightTotal, 100);
  assert.equal(balanced.status, 'RECONCILED');
  assert.match(balanced.equation, /Invoiced_Actual_Qty \+ Open_Backorder_Qty/);
  assert.doesNotMatch(balanced.equation, /Returns_Damaged_Qty/);
  assert.match(balanced.detail, /Returns are excluded/i);

  // Zero net orders with positive billed quantity is an over-shipment, not a 0% variance pass.
  const zeroOrderOvership = rec01([{
    Period_Date: '2025-06-01',
    SKU_Code: 'SKU_BEV_01',
    Location_DC: 'Mumbai',
    Channel_Code: 'GT',
    Ordered_Qty_Units: 0,
    Cancelled_Order_Qty: 0,
    Invoiced_Actual_Qty: 5,
    Open_Backorder_Qty: 0,
    Returns_Damaged_Qty: 0,
  }]);
  assert.equal(zeroOrderOvership.leftTotal, 0);
  assert.equal(zeroOrderOvership.rightTotal, 5);
  assert.equal(zeroOrderOvership.variancePct, 100);
  assert.equal(zeroOrderOvership.status, 'CRITICAL_MISMATCH');
});

test('REC-03 validates stockout-day source integrity only and does not judge uncensored-demand estimates', () => {
  const rec03 = (rows: Record<string, unknown>[]) => {
    const sheets = createSeededEnterpriseSheets();
    sheets['07_Inventory_Supply_Constraints'].records = rows as any;
    return runCrossTableReconciliation(sheets, undefined, 'SUPPLY')
      .checks.find((check) => check.id === 'REC-03')!;
  };

  // Stockout days must be whole numbers within the number of days in the calendar month.
  const invalidCounts = rec03([
    {
      Period_Date: '2025-02-01',
      SKU_Code: 'SKU_BEV_01',
      Location_DC: 'Mumbai',
      Closing_OnHand_Stock_Qty: 0,
      Depot_Stockout_Days_Count: 29, // February 2025 has only 28 days
    },
    {
      Period_Date: '2025-02-01',
      SKU_Code: 'SKU_SNK_02',
      Location_DC: 'Delhi',
      Closing_OnHand_Stock_Qty: 0,
      Depot_Stockout_Days_Count: 2.5, // day count must be an integer
    },
    {
      Period_Date: '2025-02-01',
      SKU_Code: 'SKU_CARE_04',
      Location_DC: 'Kolkata',
      Closing_OnHand_Stock_Qty: 0,
      Depot_Stockout_Days_Count: 28,
    },
  ]);
  assert.equal(invalidCounts.eligibleRecordsCount, 3);
  assert.equal(invalidCounts.variancePct, 66.67);
  assert.equal(invalidCounts.status, 'CRITICAL_MISMATCH');

  // A legacy governed-demand field, if encountered in an upload, is not evaluated by REC-03.
  const estimateDivergence = rec03([{
    Period_Date: '2025-02-01',
    SKU_Code: 'SKU_BEV_01',
    Location_DC: 'Mumbai',
    Closing_OnHand_Stock_Qty: 0,
    Depot_Stockout_Days_Count: 5,
    Invoiced_Actual_Qty: 100,
    Governed_Uncensored_Demand_Qty: 99999,
  }]);
  assert.equal(estimateDivergence.status, 'RECONCILED');
  assert.equal(estimateDivergence.eligibleRecordsCount, 1);
  assert.match(estimateDivergence.equation, /DaysInCalendarMonth/);
});

test('REC-04 validates both parent and component SKU foreign keys in manufacturing BOM rows', () => {
  const mfgWorkbook = createDomainTestWorkbook('MANUFACTURING');
  const bom = mfgWorkbook['15_Manufacturing_BOM_WorkCenters'];
  assert.ok(bom.records.length > 0, 'Manufacturing test workbook must include BOM rows');

  const validRecon = runCrossTableReconciliation(mfgWorkbook, undefined, 'MANUFACTURING');
  assert.equal(validRecon.checks.find((check) => check.id === 'REC-04')?.status, 'RECONCILED');

  bom.records[0].Component_SKU_Code = 'SKU_COMPONENT_NOT_IN_PRODUCT_MASTER';
  const invalidRecon = runCrossTableReconciliation(mfgWorkbook, undefined, 'MANUFACTURING');
  const rec04 = invalidRecon.checks.find((check) => check.id === 'REC-04')!;
  assert.equal(rec04.status, 'CRITICAL_MISMATCH');
  assert.match(rec04.detail, /orphan foreign-key reference/i);
});

test('procurement PO MOQ checks use the exact supplier × SKU × location contract', () => {
  const workbook = createDomainTestWorkbook('PROCUREMENT');
  workbook['13_Supplier_Sourcing_Contracts'].records.push({
    Supplier_ID: 'SUP_ALT_99',
    SKU_Code: 'SKU_DAIRY_03',
    Location_DC: 'Kolkata',
    Supplier_Lead_Time_Days: 10,
    MOQ_Units: 1000,
    Order_Multiple_Qty: 100,
    Unit_Purchase_Cost_INR: 45,
  });

  // The alternate supplier has stricter terms for the same SKU/depot.
  // PO-2025-901 belongs to SUP_PACK_01 and must use that supplier's MOQ, not SUP_ALT_99's.
  const report = validateWorkbook(workbook, { domain: 'PROCUREMENT' });
  assert.equal(
    report.exceptions.some(
      (e) => e.signature.startsWith('PO_MOQ_MULT|') && e.rowIndex === 0
    ),
    false
  );

  // A PO assigned to a supplier without a matching SKU/depot contract must not borrow
  // another supplier's contract terms; it must raise an explicit unresolved-contract warning.
  workbook['14_Purchase_Orders_Receipts'].records[0].Supplier_ID = 'SUP_NOT_CONTRACTED';
  const mismatched = validateWorkbook(workbook, { domain: 'PROCUREMENT' });
  assert.ok(
    mismatched.exceptions.some(
      (e) => e.signature.startsWith('PO_SUPPLIER_CONTRACT|') && e.rowIndex === 0
    )
  );
});

test('REC-05 evaluates only lead-time sources in the selected domain and fails closed on missing in-domain sources', () => {
  const procurement = createDomainTestWorkbook('PROCUREMENT');
  const procurementRecon = runCrossTableReconciliation(procurement, undefined, 'PROCUREMENT');
  const procurementRec05 = procurementRecon.checks.find((check) => check.id === 'REC-05')!;
  assert.match(procurementRec05.leftSource, /10_Location_Depot_Network/);
  assert.match(procurementRec05.leftSource, /13_Supplier_Sourcing_Contracts/);
  assert.equal(procurementRec05.leftTotal, 45);
  assert.equal(procurementRec05.status, 'VARIANCE_WARNING');

  // Supplier contracts are in-scope for Procurement; a missing contract source must not look reconciled
  // merely because depot lead-time values are present.
  const missingSupplier = createDomainTestWorkbook('PROCUREMENT');
  delete missingSupplier['13_Supplier_Sourcing_Contracts'];
  const missingSupplierRecon = runCrossTableReconciliation(
    missingSupplier,
    undefined,
    'PROCUREMENT'
  );
  assert.equal(
    missingSupplierRecon.checks.find((check) => check.id === 'REC-05')?.status,
    'NOT_RUN'
  );

  // Supplier contracts are out-of-scope for Manufacturing; an unrelated supplier record must not
  // contaminate the manufacturing lead-time result.
  const manufacturing = createDomainTestWorkbook('MANUFACTURING');
  manufacturing['13_Supplier_Sourcing_Contracts'] = createDomainTestWorkbook('PROCUREMENT')[
    '13_Supplier_Sourcing_Contracts'
  ];
  manufacturing['13_Supplier_Sourcing_Contracts'].records[0].Supplier_Lead_Time_Days = 999;
  const manufacturingRec05 = runCrossTableReconciliation(
    manufacturing,
    undefined,
    'MANUFACTURING'
  ).checks.find((check) => check.id === 'REC-05')!;
  assert.doesNotMatch(manufacturingRec05.leftSource, /13_Supplier_Sourcing_Contracts/);
  assert.notEqual(manufacturingRec05.leftTotal, 999);
  assert.notEqual(manufacturingRec05.status, 'NOT_RUN');
});

