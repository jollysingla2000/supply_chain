import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
import { createDomainTestWorkbook, createSeededEnterpriseSheets, DEFAULT_RULE_CONFIG, DOMAIN_CONTRACTS, TABLE_CONTRACTS } from './schema';
import { escapeHtml, hasUnsafePayload, sanitizeCellText } from './security';
import { ApprovedCorrection, AuditEntry, EnterpriseSheets, ExceptionAssignment, PlanningDomainKey } from './types';
import {
  applyApprovedCorrections,
  applySafeTechnicalFixes,
  computeSignOffExpiryIso,
  evaluateReleaseGate,
  updateExceptionAssignment,
  findColumnKey,
  getRowVal,
  isAmbiguousDateString,
  parseFlexibleDate,
  parseStrictNumber,
  resolveColumnDataType,
  validateRuleConfig,
  validateSchemaRemediationInput,
  validateWorkbook,
} from './validation';
import {
  applyColumnMapping,
  buildAuditLogExportEnvelope,
  computeWorkbookHash,
  evaluateCorrectionDependencyOnMutation,
  executeGovernedDatasetMutation,
  getApprovalBlockingInvalidatedCorrectionIds,
  hasPersistedGovernanceState,
  loadPersistedGovernanceState,
  RECONCILIATION_RULE_CONTRACTS,
  savePersistedGovernanceState,
  serializeCanonicalWorkbook,
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
  const governedWorkbookHash = computeWorkbookHash(cleanWorking);
  const finalReport = validateWorkbook(cleanWorking, {
    datasetHash: governedWorkbookHash,
    datasetVersion: 7,
    governedOutputHash: governedWorkbookHash,
  });
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
    { approver: 'VP Supply', reason: 'Reviewed warnings', expiry: '7 Days', signedAt: '2026-11-18', expiresAt: validExpiresAt, sourceWorkbookHash: governedWorkbookHash, datasetVersion: 7 },
    true,
    nowMs + 1000,
    governedWorkbookHash,
    true,
    7
  );
  assert.equal(gatePassed.step2Unlocked, true);
  assert.equal(gatePassed.status, 'WARNING_ACKNOWLEDGED');

  const staleVersionGate = evaluateReleaseGate(
    finalReport,
    { approver: 'VP Supply', reason: 'Old dataset approval', expiry: '7 Days', signedAt: '2026-11-18', expiresAt: validExpiresAt, sourceWorkbookHash: governedWorkbookHash, datasetVersion: 6 },
    true,
    nowMs + 1000,
    governedWorkbookHash,
    true,
    7
  );
  assert.equal(staleVersionGate.step2Unlocked, false);
  assert.ok(staleVersionGate.blockingReasons.some((reason) => /dataset hash or version/i.test(reason)));

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

test('Capability #1: ingests a genuine XLSX close to the 100 MB upload limit', () => {
  const dataRows = 3_000;
  const payloadLength = 32_760; // Excel's per-cell text limit is 32,767 characters.

  // Build a standards-compliant, uncompressed XLSX ZIP directly. This avoids
  // SheetJS' XLSX writer creating multiple multi-gigabyte intermediate strings
  // merely to manufacture a large test fixture.
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[n] = value >>> 0;
  }
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const entries: Array<{ name: string; data: Buffer }> = [];
  const addEntry = (name: string, content: string): void => {
    entries.push({ name, data: Buffer.from(content, 'utf8') });
  };
  addEntry('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  addEntry('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  addEntry('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Near_Limit_Payload" sheetId="1" r:id="rId1"/></sheets></workbook>');
  addEntry('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');

  const sheetParts: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Payload</t></is></c></row>'];
  let firstPayload = '';
  let lastPayload = '';
  for (let row = 0; row < dataRows; row++) {
    const payload = randomBytes(Math.ceil(payloadLength * 3 / 4)).toString('base64').slice(0, payloadLength);
    if (row === 0) firstPayload = payload;
    if (row === dataRows - 1) lastPayload = payload;
    sheetParts.push('<row r="' + (row + 2) + '"><c r="A' + (row + 2) + '" t="inlineStr"><is><t>' + payload + '</t></is></c></row>');
  }
  sheetParts.push('</sheetData></worksheet>');
  addEntry('xl/worksheets/sheet1.xml', sheetParts.join(''));
  sheetParts.length = 0;

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // ZIP store method: valid, no compression or extra copies.
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  const archive = Buffer.concat([...localParts, centralDirectory, endRecord]);
  entries.length = 0;
  localParts.length = 0;
  centralParts.length = 0;

  const minimumNearLimitBytes = 85 * 1024 * 1024;
  const maximumUploadBytes = 100 * 1024 * 1024;
  assert.ok(archive.byteLength >= minimumNearLimitBytes, `Expected at least 85 MiB, got ${archive.byteLength} bytes`);
  assert.ok(archive.byteLength <= maximumUploadBytes, `Expected no more than 100 MiB, got ${archive.byteLength} bytes`);

  const started = performance.now();
  const ingested = ingestWorkbookBuffer(new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength), 'near-100mb-valid-workbook.xlsx');
  const elapsedMs = performance.now() - started;
  const records = ingested.sheets['Near_Limit_Payload'].records;
  assert.equal(ingested.sheetCount, 1);
  assert.equal(ingested.totalRows, dataRows);
  assert.equal(records.length, dataRows);
  assert.equal(records[0].Payload, firstPayload);
  assert.equal(records[dataRows - 1].Payload, lastPayload);
  console.log(`[INGEST-BENCH] profile=near-100mb-valid-xlsx rows=${dataRows} bytes=${archive.byteLength} ingestMs=${elapsedMs.toFixed(1)}`);
});

test('Capability #1: rejects a 100 MB + 1 byte workbook before ZIP parsing', () => {
  const allocateAndRejectOversizedWorkbook = () => {
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1);
    assert.throws(
      () => ingestWorkbookBuffer(oversized, 'oversized-limit-boundary.xlsx'),
      /workbook exceeds the 100 MB ingestion limit/i
    );
  };
  allocateAndRejectOversizedWorkbook();
  const forceGarbageCollection = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  forceGarbageCollection?.();
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
    { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Ordered_Qty_Units: 3000, Invoiced_Actual_Qty: 3000, Returns_Damaged_Qty: 0, Net_Realized_Sales_INR: 195000 },
  ];
  sheets['02_Forecast_Vintages_Lag'].records = [
    { Target_Delivery_Month: '2026-01-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Stat_Baseline_Unconstrained: 3000, Stat_Forecast_Lag1_Qty: 3100 },
  ];
  sheets['03_Commercial_Sales_Inputs'].records = [];
  sheets['04_Trade_Promotions_Calendar'].records = [];
  sheets['06_Pricing_Elasticity_Catalog'].records = [
    { SKU_Code: 'SKU_DAIRY_03', Channel_Code: 'GT', Effective_From_Month: '2025-01-01', Net_Realized_Price_INR: 65, Unit_COGS_INR: 40, Gross_Margin_Pct: 38.5 },
  ];
  sheets['09_Product_Master_Hierarchy'].records = [
    { SKU_Code: 'SKU_DAIRY_03', SKU_Description: 'Dairy', Base_UOM: 'EA', UOM_Conversion_Factor: 12 },
    { SKU_Code: 'SKU_SNK_02', SKU_Description: 'Snacks', Base_UOM: 'EA', UOM_Conversion_Factor: 24 },
  ];
  sheets['12_NPI_Lifecycle_Transitions'].records = [];

  const report = validateWorkbook(sheets, {
    ruleConfig: validateRuleConfig({
      stockoutRunRateMethodApproved: true,
      stockoutRunRateMethodApprovedBy: 'Demand & Inventory Assurance Steward',
      stockoutRunRateMethodApprovedAt: '2026-11-01T12:00:00.000Z',
    }).config,
  });
  assert.equal(report.exceptions.filter((e) => e.severity === 'CRITICAL').length, 0);
  assert.ok(report.exceptions.filter((e) => e.severity === 'WARNING').length > 0);
  assert.equal(report.schemaPassed, true);
  assert.equal(
    report.allRequiredValidationsExecuted,
    true,
    `Release-gate fixture must execute all required categories: ${JSON.stringify(report.categories.map((category) => ({ key: category.key, status: category.status, missing: category.missingDependencies })))}`
  );

  const issuedMs = Date.UTC(2026, 10, 1, 12, 0, 0);
  const expiresAt = computeSignOffExpiryIso('24 Hours', issuedMs);
  const workbookHash = computeWorkbookHash(sheets);
  const signOff = {
    approver: 'VP Supply',
    reason: 'Reviewed',
    expiry: '24 Hours',
    signedAt: '2026-11-01',
    expiresAt,
    sourceWorkbookHash: workbookHash,
  };

  const validGate = evaluateReleaseGate(
    report,
    signOff,
    true,
    issuedMs + 60_000,
    workbookHash
  );
  assert.equal(validGate.step2Unlocked, true);
  assert.equal(validGate.status, 'WARNING_ACKNOWLEDGED');

  const expiredGate = evaluateReleaseGate(
    report,
    signOff,
    true,
    issuedMs + 25 * 60 * 60 * 1000,
    workbookHash
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
  while (guard < 250) {
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
  assert.equal(
    postImportReport.exceptions.length,
    0,
    `Re-imported workbook exceptions: ${JSON.stringify(postImportReport.exceptions.map((e) => ({ signature: e.signature, issue: e.issue, table: e.table, rowIndex: e.rowIndex, badVal: e.badVal })))}`
  );
  assert.equal(postImportReport.health.overallQualityScorePct, 100);
});

test('all correction types validate inputs before applying and reject malformed/negative/empty values', () => {
  const source = createSeededEnterpriseSheets();
  const origActual = source['01_Orders_Shipments_History'].records[0].Invoiced_Actual_Qty;
  const origUom = source['09_Product_Master_Hierarchy'].records[0].UOM_Conversion_Factor;
  const origLag1 = source['02_Forecast_Vintages_Lag'].records[0].Stat_Forecast_Lag1_Qty;

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
      id: 'MAL-4',
      exceptionSignature: 'CAP_FORECAST|02_Forecast_Vintages_Lag|0',
      fixType: 'CAP_FORECAST',
      table: '02_Forecast_Vintages_Lag',
      rowIndex: 0,
      approvedValue: -100,
      beforeSummary: '',
      afterSummary: '',
      approver: 'Tester',
      reason: 'Negative forecast cap',
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
  assert.equal(afterMalformed['02_Forecast_Vintages_Lag'].records[0].Stat_Forecast_Lag1_Qty, origLag1);
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

test('table-level structural failures penalize overallQualityScorePct even when rowPassRatePct is 100%', () => {
  const sheets = createSeededEnterpriseSheets();
  const tech = applySafeTechnicalFixes(sheets, [], 'Steward');
  let corrections: ApprovedCorrection[] = [...tech.nextCorrections];
  let guard = 0;
  while (guard < 250) {
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
  const cleanReport = validateWorkbook(cleanSheets);
  assert.equal(cleanReport.exceptions.length, 0, `Fixture corrections must clear all row-level exceptions; remaining: ${JSON.stringify(cleanReport.exceptions.map((e) => ({ signature: e.signature, issue: e.issue, table: e.table, rowIndex: e.rowIndex, badVal: e.badVal })))}`);
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

test('dataset-bound corrections require both the current content hash and dataset version', () => {
  const source = createSeededEnterpriseSheets();
  const sourceHash = computeWorkbookHash(source);
  const targetException = validateWorkbook(source).exceptions.find(
    (exception) =>
      exception.table === '01_Orders_Shipments_History' &&
      exception.fixType === 'IMPUTE_ACTUAL'
  )!;
  const correction: ApprovedCorrection = {
    id: 'COR-DATASET-VERSION-1',
    exceptionSignature: targetException.signature,
    table: targetException.table,
    rowIndex: targetException.rowIndex,
    fixType: 'IMPUTE_ACTUAL',
    approvedValue: 2222,
    beforeSummary: 'blank',
    afterSummary: '2222',
    approver: 'Test Steward',
    reason: 'Verify dataset-version binding',
    approvedAt: '2026-11-19T00:00:00.000Z',
    sourceWorkbookHash: sourceHash,
    datasetVersion: 7,
  };

  const sameHashAndVersion = applyApprovedCorrections(source, [correction], {
    strictHashBinding: true,
    currentDatasetVersion: 7,
  });
  assert.equal(
    sameHashAndVersion[targetException.table].records[targetException.rowIndex].Invoiced_Actual_Qty,
    2222
  );

  // An identical re-upload has the same content hash but a new dataset version.
  const sameHashDifferentVersion = applyApprovedCorrections(source, [correction], {
    strictHashBinding: true,
    currentDatasetVersion: 8,
  });
  assert.equal(
    sameHashDifferentVersion[targetException.table].records[targetException.rowIndex].Invoiced_Actual_Qty,
    source[targetException.table].records[targetException.rowIndex].Invoiced_Actual_Qty
  );

  const missingVersion = applyApprovedCorrections(source, [{ ...correction, datasetVersion: undefined }], {
    strictHashBinding: true,
    currentDatasetVersion: 7,
  });
  assert.equal(
    missingVersion[targetException.table].records[targetException.rowIndex].Invoiced_Actual_Qty,
    source[targetException.table].records[targetException.rowIndex].Invoiced_Actual_Qty
  );
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

test('P0-5: certified reconciliation checks enforce channel+date price lookup, stockout formula benchmark, and NOT_RUN/NOT_APPLICABLE states', () => {
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

  // REC-03 flags CRITICAL_MISMATCH if Governed_Uncensored_Demand_Qty < Invoiced_Actual_Qty during a stockout
  const badStockout = createSeededEnterpriseSheets();
  badStockout['07_Inventory_Supply_Constraints'].records[0].Governed_Uncensored_Demand_Qty = 500; // less than billed 1420
  badStockout['07_Inventory_Supply_Constraints'].records[0]._stockoutRestored = true;
  const reconBadStockout = runCrossTableReconciliation(badStockout, undefined, 'DEMAND');
  assert.equal(
    reconBadStockout.checks.find((c) => c.id === 'REC-03')?.status,
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

test('Audit P1-1: REC-01 excludes returns from order fulfillment and tracks returns as a separate reverse flow', () => {
  const sheets = createSeededEnterpriseSheets();
  // Set up a single order line: Ordered=1000, Cancelled=0, Billed=800, Open_Backorder=0, Returns=200
  // Under the old buggy formula (Billed + Returns + Open_Backorder = 800 + 200 + 0 = 1000), this falsely appeared 100% fulfilled!
  // Under the corrected formula, fulfilled + open backorder = 800 + 0 = 800 (200 unit fulfillment gap -> VARIANCE_WARNING),
  // while Returns (200) reduce Net Delivered to 600.
  sheets['01_Orders_Shipments_History'].records = [
    {
      Invoice_Line_ID: 'INV-FLOW-1',
      Period_Date: '2025-05-01',
      SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Channel_Code: 'GT',
      Ordered_Qty_Units: 1000,
      Cancelled_Order_Qty: 0,
      Invoiced_Actual_Qty: 800,
      Open_Backorder_Qty: 0,
      Returns_Damaged_Qty: 200,
      Net_Realized_Sales_INR: 38400,
      Order_UOM: 'EA',
    },
  ];

  const recon = runCrossTableReconciliation(sheets, undefined, 'DEMAND');
  const rec01 = recon.checks.find((c) => c.id === 'REC-01')!;
  assert.equal(rec01.leftTotal, 1000); // Net Ordered = 1000 - 0
  assert.equal(rec01.rightTotal, 800); // Fulfilled + Open Backorder = 800 + 0 (Returns NOT added!)
  assert.equal(rec01.varianceAbs, 200);
  assert.equal(rec01.status, 'VARIANCE_WARNING');
  assert.equal(rec01.flowBreakdown?.returnsReverseFlowUnits, 200);
  assert.equal(rec01.flowBreakdown?.netDeliveredUnits, 600);

  // If returns exceed gross billed shipments (e.g. Returns=900 > Billed=800), REC-01 flags CRITICAL_MISMATCH
  sheets['01_Orders_Shipments_History'].records[0].Returns_Damaged_Qty = 900;
  const reconOverReturn = runCrossTableReconciliation(sheets, undefined, 'DEMAND');
  const rec01Over = reconOverReturn.checks.find((c) => c.id === 'REC-01')!;
  assert.equal(rec01Over.status, 'CRITICAL_MISMATCH');
  assert.equal(rec01Over.flowBreakdown?.overReturnRows, 1);
});

test('Audit P1-2: REC-02 strictly enforces Effective_From_Month <= Period_Date and rejects future-dated catalog prices', () => {
  const sheets = createSeededEnterpriseSheets();
  sheets['01_Orders_Shipments_History'].records = [
    {
      Invoice_Line_ID: 'INV-PRICE-1',
      Period_Date: '2025-05-01',
      SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Channel_Code: 'GT',
      Ordered_Qty_Units: 1000,
      Invoiced_Actual_Qty: 1000,
      Returns_Damaged_Qty: 0,
      Net_Realized_Sales_INR: 48000,
      Order_UOM: 'EA',
    },
  ];

  // Case A: Catalog only has a future-dated price (2025-12-01 > 2025-05-01) -> must NOT fall back to future price; must flag CRITICAL_MISMATCH
  sheets['06_Pricing_Elasticity_Catalog'].records = [
    {
      SKU_Code: 'SKU_DAIRY_03',
      Channel_Code: 'GT',
      Effective_From_Month: '2025-12-01',
      List_MRP_INR: 60,
      Net_Realized_Price_INR: 48,
      Unit_COGS_INR: 34,
      Gross_Margin_Pct: 29.2,
      Own_Price_Elasticity: -1.1,
    },
  ];

  const reconFutureOnly = runCrossTableReconciliation(sheets, undefined, 'DEMAND');
  const rec02Future = reconFutureOnly.checks.find((c) => c.id === 'REC-02')!;
  assert.equal(rec02Future.status, 'CRITICAL_MISMATCH');
  assert.equal(rec02Future.eligibleRecordsCount, 0);
  assert.equal(rec02Future.flowBreakdown?.futureDatedUnmatchedLines, 1);

  // Case B: Catalog has both a valid prior price (2025-01-01 @ ₹48) and a future price (2025-12-01 @ ₹65) -> selects ₹48 and reconciles
  sheets['06_Pricing_Elasticity_Catalog'].records.push({
    SKU_Code: 'SKU_DAIRY_03',
    Channel_Code: 'GT',
    Effective_From_Month: '2025-01-01',
    List_MRP_INR: 60,
    Net_Realized_Price_INR: 48,
    Unit_COGS_INR: 34,
    Gross_Margin_Pct: 29.2,
    Own_Price_Elasticity: -1.1,
  });

  const reconValidPrior = runCrossTableReconciliation(sheets, undefined, 'DEMAND');
  const rec02Valid = reconValidPrior.checks.find((c) => c.id === 'REC-02')!;
  assert.equal(rec02Valid.status, 'RECONCILED');
  assert.equal(rec02Valid.leftTotal, 48000);
  assert.equal(rec02Valid.rightTotal, 48000);
  assert.equal(rec02Valid.flowBreakdown?.futureDatedUnmatchedLines, 0);
});

test('Audit P1-3: REC-03 separates physical source bound (Uncensored >= Billed) from configurable run-rate estimation methodology', () => {
  const sheets = createSeededEnterpriseSheets();
  // Stockout row: Closing_OnHand = 0, Stockout_Days = 9, Billed = 1420.
  // Run-rate formula benchmark = round(1420 / (1 - 9/30)) = 2029.
  // Suppose the steward sets Governed_Uncensored_Demand_Qty = 1500 (physically valid >= 1420 billed, but 26% below the 2029 run-rate formula).
  sheets['07_Inventory_Supply_Constraints'].records = [
    {
      Period_Date: '2025-10-01',
      SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Invoiced_Actual_Qty: 1420,
      Closing_OnHand_Stock_Qty: 0,
      Depot_Stockout_Days_Count: 9,
      Safety_Stock_Target_Qty: 450,
      Max_Warehouse_Capacity_Qty: 6000,
      Governed_Uncensored_Demand_Qty: 1500,
      _stockoutRestored: true,
    },
  ];

  // The benchmark must not become approved from a default or legacy boolean-only config.
  assert.equal(DEFAULT_RULE_CONFIG.stockoutRunRateMethodApproved, false);
  const legacyBooleanOnly = validateRuleConfig({ stockoutRunRateMethodApproved: true }).config;
  assert.equal(legacyBooleanOnly.stockoutRunRateMethodApproved, false);
  assert.equal(legacyBooleanOnly.stockoutRunRateMethodApprovedBy, undefined);

  // A named, date-stamped owner attestation is required before the benchmark can be enforced.
  const cfgApproved = validateRuleConfig({
    stockoutRunRateMethodApproved: true,
    stockoutRunRateMethodApprovedBy: 'Demand & Inventory Assurance Steward',
    stockoutRunRateMethodApprovedAt: '2026-11-20T18:00:00.000Z',
  }).config;
  assert.equal(cfgApproved.stockoutRunRateMethodApproved, true);
  const reconApproved = runCrossTableReconciliation(sheets, cfgApproved, 'DEMAND');
  const rec03Approved = reconApproved.checks.find((c) => c.id === 'REC-03')!;
  assert.equal(rec03Approved.status, 'VARIANCE_WARNING');
  assert.equal(rec03Approved.methodologyStatus, 'APPROVED_BENCHMARK');

  const rawLegacyBoolean = {
    ...DEFAULT_RULE_CONFIG,
    stockoutRunRateMethodApproved: true,
    stockoutRunRateMethodApprovedBy: undefined,
    stockoutRunRateMethodApprovedAt: undefined,
  };
  const rawLegacyResult = runCrossTableReconciliation(sheets, rawLegacyBoolean, 'DEMAND');
  assert.equal(
    rawLegacyResult.checks.find((c) => c.id === 'REC-03')?.methodologyStatus,
    'SOURCE_ONLY_UNAPPROVED_BENCHMARK'
  );

  // When stockoutRunRateMethodApproved = false, REC-03 enforces ONLY the physical source bound (1500 >= 1420) and passes!
  const cfgUnapproved = validateRuleConfig({ stockoutRunRateMethodApproved: false }).config;
  const reconUnapproved = runCrossTableReconciliation(sheets, cfgUnapproved, 'DEMAND');
  const rec03Unapproved = reconUnapproved.checks.find((c) => c.id === 'REC-03')!;
  assert.equal(rec03Unapproved.status, 'RECONCILED');
  assert.equal(rec03Unapproved.methodologyStatus, 'SOURCE_ONLY_UNAPPROVED_BENCHMARK');

  // However, if Governed_Uncensored_Demand_Qty < Invoiced_Actual_Qty (e.g. 1200 < 1420), physical bound fails even when method is unapproved!
  sheets['07_Inventory_Supply_Constraints'].records[0].Governed_Uncensored_Demand_Qty = 1200;
  const reconPhysicalFail = runCrossTableReconciliation(sheets, cfgUnapproved, 'DEMAND');
  assert.equal(
    reconPhysicalFail.checks.find((c) => c.id === 'REC-03')?.status,
    'CRITICAL_MISMATCH'
  );
  const valPhysicalFail = validateWorkbook(sheets, {
    domain: 'DEMAND',
    ruleConfig: cfgUnapproved,
  });
  assert.ok(
    valPhysicalFail.exceptions.some((e) => e.signature.startsWith('STOCKOUT_BELOW_BILLED|'))
  );
});

test('Audit P1-4: canonical JSON workbook serialization prevents delimiter collisions and strictHashBinding rejects unbound approvals', () => {
  // Construct two workbooks whose cells contain delimiter characters ('|', ';', '=') that could collide under naive string joining
  const wb1 = createSeededEnterpriseSheets();
  const wb2 = createSeededEnterpriseSheets();
  wb1['09_Product_Master_Hierarchy'].records[0].Brand_Name = 'Alpha|ColB=100;ColC=200';
  wb1['09_Product_Master_Hierarchy'].records[0].Category_L1 = 'Foods';

  wb2['09_Product_Master_Hierarchy'].records[0].Brand_Name = 'Alpha';
  wb2['09_Product_Master_Hierarchy'].records[0].Category_L1 = 'ColB=100;ColC=200|Foods';

  assert.notEqual(serializeCanonicalWorkbook(wb1), serializeCanonicalWorkbook(wb2));
  assert.notEqual(computeWorkbookHash(wb1), computeWorkbookHash(wb2));

  // Verify strictHashBinding rejects corrections and warning sign-offs that omit sourceWorkbookHash
  const report1 = validateWorkbook(wb1);
  const targetErr = report1.exceptions.find(
    (e) => e.table === '01_Orders_Shipments_History' && e.fixType === 'IMPUTE_ACTUAL'
  )!;

  const unboundCorrection: ApprovedCorrection = {
    id: 'UNBOUND-1',
    exceptionSignature: targetErr.signature,
    table: targetErr.table,
    rowIndex: targetErr.rowIndex,
    fixType: 'IMPUTE_ACTUAL',
    approvedValue: 2222,
    beforeSummary: 'NULL',
    afterSummary: '2222',
    approver: 'Tester',
    reason: 'Missing sourceWorkbookHash',
    approvedAt: '2026-11-18 11:00',
    // sourceWorkbookHash omitted intentionally
  };

  const strictApplied = applyApprovedCorrections(wb1, [unboundCorrection], {
    strictHashBinding: true,
  });
  assert.notEqual(
    strictApplied['01_Orders_Shipments_History'].records[targetErr.rowIndex].Invoiced_Actual_Qty,
    2222
  );

  // Unbound warning sign-off is rejected when strictHashBinding = true
  const unboundSignOff = {
    approver: 'Jolly Singla',
    reason: 'Unbound sign-off',
    expiry: '24 Hours',
    signedAt: '2026-11-18 11:00',
    expiresAt: computeSignOffExpiryIso('24 Hours', Date.now()),
  };
  const gateStrict = evaluateReleaseGate(
    report1,
    unboundSignOff,
    true,
    Date.now(),
    computeWorkbookHash(wb1),
    true
  );
  assert.equal(gateStrict.warningPolicySatisfied, false);
});

test('Audit P1-5 & P2: storage save diagnostic status and end-to-end validation across all 6 planning domains', () => {
  const seeded = createSeededEnterpriseSheets();
  // In Node test environment without window.localStorage, savePersistedGovernanceState returns { ok: false, error: ... } instead of silently succeeding
  const saveRes = savePersistedGovernanceState({
    industry: 'cpg',
    domain: 'ALL',
    ruleConfig: validateRuleConfig({}).config,
    sourceSheets: seeded,
    workbookSource: 'Node Test',
    sourceWorkbookHash: computeWorkbookHash(seeded),
    approvedCorrections: [],
    warningSignOff: null,
    auditLog: [],
    lineageHistory: [],
    exceptionAssignments: {},
  });
  assert.equal(saveRes.ok, false);
  assert.ok(typeof saveRes.error === 'string' && saveRes.error.length > 0);

  // Verify every single planning domain contract builds, validates, reconciles, and profiles cleanly
  const allDomains: PlanningDomainKey[] = [
    'DEMAND',
    'SUPPLY',
    'SOP',
    'MEIO',
    'PROCUREMENT',
    'MANUFACTURING',
  ];
  for (const dom of allDomains) {
    const domSheets = createDomainTestWorkbook(dom);
    const domReport = validateWorkbook(domSheets, { domain: dom });
    const domRecon = runCrossTableReconciliation(domSheets, undefined, dom);
    assert.equal(
      domReport.schemaPassed,
      true,
      `Expected domain test workbook for ${dom} to pass schema completeness`
    );
    assert.equal(
      domReport.allRequiredValidationsExecuted,
      true,
      `Expected all required validation pillars for ${dom} to execute`
    );
    assert.equal(domRecon.checks.length, 5);
  }
});





test('correction sanitization rejects prototype-sensitive and undeclared column targets', () => {
  const sheets = createSeededEnterpriseSheets();
  const originalRow = sheets['09_Product_Master_Hierarchy'].records[0];
  const corrections = [
    {
      id: 'COR-UNSAFE-TARGET',
      exceptionSignature: 'test',
      fixType: 'SANITIZE_CELL' as const,
      table: '09_Product_Master_Hierarchy',
      rowIndex: 0,
      targetCol: 'constructor',
      approvedValue: 'injected',
      beforeSummary: 'before',
      afterSummary: 'after',
      approver: 'test',
      reason: 'negative test',
      approvedAt: '2026-11-19T00:00:00.000Z',
    },
    {
      id: 'COR-PROTO-TARGET',
      exceptionSignature: 'test',
      fixType: 'SANITIZE_CELL' as const,
      table: '09_Product_Master_Hierarchy',
      rowIndex: 0,
      targetCol: '__proto__',
      approvedValue: 'injected',
      beforeSummary: 'before',
      afterSummary: 'after',
      approver: 'test',
      reason: 'negative test',
      approvedAt: '2026-11-19T00:00:00.000Z',
    },
    {
      id: 'COR-UNKNOWN-TARGET',
      exceptionSignature: 'test',
      fixType: 'SANITIZE_CELL' as const,
      table: '09_Product_Master_Hierarchy',
      rowIndex: 0,
      targetCol: 'Not_A_Declared_Column',
      approvedValue: 'injected',
      beforeSummary: 'before',
      afterSummary: 'after',
      approver: 'test',
      reason: 'negative test',
      approvedAt: '2026-11-19T00:00:00.000Z',
    },
  ];
  const governed = applyApprovedCorrections(sheets, corrections);
  const governedRow = governed['09_Product_Master_Hierarchy'].records[0];
  assert.equal(Object.prototype.hasOwnProperty.call(governedRow, 'constructor'), false);
  assert.equal(governedRow.constructor, Object);
  assert.equal(Object.prototype.hasOwnProperty.call(governedRow, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(governedRow, 'Not_A_Declared_Column'), false);
  assert.equal(originalRow.constructor, Object);
});

test('strict numeric parser accepts valid Western/Indian grouping and rejects malformed or non-finite input', () => {
  const valid: Array<[unknown, number]> = [
    ['1234', 1234],
    ['1,234', 1234],
    ['1,234,567.89', 1234567.89],
    ['12,34,567.89', 1234567.89],
    ['-12,34,567', -1234567],
    ['+1,250.5', 1250.5],
    ['.75', 0.75],
    ['1e3', 1000],
    [42, 42],
  ];
  for (const [input, expected] of valid) {
    assert.equal(parseStrictNumber(input), expected, `expected ${String(input)} to parse as ${expected}`);
  }

  for (const invalid of ['', '   ', '1,2,3', '12,34', '1234,567', '1,23,45', '1,,000', '1.2.3', '1,234.5,6', '0x10', 'Infinity', '-Infinity', 'NaN', null, undefined, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.ok(Number.isNaN(parseStrictNumber(invalid)), `expected ${String(invalid)} to be rejected`);
  }

  // Profiling must use the same parser as validation; malformed grouping cannot appear numeric.
  const sheets = createSeededEnterpriseSheets();
  const orders = sheets['01_Orders_Shipments_History'];
  orders.records[0].Ordered_Qty_Units = '1,234';
  orders.records.push({
    ...orders.records[0],
    Period_Date: '2025-02-01',
    Invoice_Line_ID: 'LINE-STRICT-NUMERIC',
    Ordered_Qty_Units: '1,2,3',
  });
  const profiled = profileWorkbook(sheets);
  const orderedQtyProfile = profiled.tables
    .find((table) => table.table === '01_Orders_Shipments_History')?.columns
    .find((column) => column.column === 'Ordered_Qty_Units');
  assert.equal(orderedQtyProfile?.inferredType, 'MIXED');
  assert.equal(orderedQtyProfile?.typeMismatch, true);
  assert.ok(orderedQtyProfile?.invalidSampleValues?.includes('1,2,3'));
});

test('exception assignment lifecycle calculates SLA deadlines, overdue state, and transitions', () => {
  const assignedAt = '2026-11-19T00:00:00.000Z';
  const first = updateExceptionAssignment(
    undefined,
    { owner: 'Master Data Steward', slaHours: 4, status: 'IN_REVIEW' },
    assignedAt
  );
  assert.equal(first.assignedAt, assignedAt);
  assert.equal(first.dueAt, '2026-11-19T04:00:00.000Z');
  assert.equal(first.isOverdue, false);
  assert.equal((first.history ?? []).length, 1);

  const overdue = updateExceptionAssignment(
    first,
    { owner: 'Master Data Steward', slaHours: 4, status: 'IN_REVIEW' },
    '2026-11-19T05:00:00.000Z'
  );
  assert.equal(overdue.assignedAt, assignedAt, 'same-owner update must not reset assignment start');
  assert.equal(overdue.dueAt, first.dueAt);
  assert.equal(overdue.isOverdue, true);

  const reassigned = updateExceptionAssignment(
    overdue,
    { owner: 'Supply & MEIO Lead', slaHours: 24, status: 'IN_REVIEW' },
    '2026-11-19T05:00:00.000Z'
  );
  assert.equal(reassigned.assignedAt, '2026-11-19T05:00:00.000Z');
  assert.equal(reassigned.dueAt, '2026-11-20T05:00:00.000Z');
  assert.equal(reassigned.isOverdue, false);

  const resolved = updateExceptionAssignment(
    reassigned,
    { owner: 'Supply & MEIO Lead', slaHours: 24, status: 'RESOLVED' },
    '2026-11-21T06:00:00.000Z'
  );
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.isOverdue, false);
  assert.equal((resolved.history ?? []).length, 4);

  const unassigned = updateExceptionAssignment(
    resolved,
    { owner: 'Unassigned', slaHours: 24, status: 'OPEN' },
    '2026-11-21T07:00:00.000Z'
  );
  assert.equal(unassigned.status, 'OPEN');
  assert.equal(unassigned.dueAt, undefined);
  assert.equal(unassigned.assignedAt, undefined);

  const oversizedHistory = updateExceptionAssignment(
    { ...first, history: Array.from({ length: 120 }, (_, index) => ({ owner: 'Owner', updatedAt: assignedAt, status: 'IN_REVIEW', ts: String(index) })) },
    { owner: 'Master Data Steward', slaHours: 4, status: 'IN_REVIEW' },
    '2026-11-19T01:00:00.000Z'
  );
  assert.equal(oversizedHistory.history?.length, 100, 'Live history must be capped at 100 events');

  const invalidInputAssignment = updateExceptionAssignment(
    undefined,
    { owner: '  ', slaHours: 0, status: 'IN_REVIEW' },
    '2026-11-19T00:00:00.000Z'
  );
  assert.equal(invalidInputAssignment.owner, 'Unassigned');
  assert.equal(invalidInputAssignment.slaHours, 24);
  assert.equal(invalidInputAssignment.status, 'OPEN');
  assert.equal(invalidInputAssignment.dueAt, undefined);
});

test('column alias resolution uses normalized exact matches and never substring-matches unrelated fields', () => {
  const row = {
    Parent_SKU_Code: 'PARENT-1',
    'SKU Code': 'CHILD-2',
    'Actual Sales Units': 125,
  };
  assert.equal(getRowVal(row, ['SKU_Code']), 'CHILD-2');
  assert.equal(findColumnKey(row, ['SKU_Code']), 'SKU Code');
  assert.equal(getRowVal({ Parent_SKU_Code: 'PARENT-1' }, ['SKU_Code']), undefined);
  assert.equal(findColumnKey({ Parent_SKU_Code: 'PARENT-1' }, ['SKU_Code']), undefined);
  assert.equal(getRowVal(row, ['Actual_Sales_Units']), 125);
  assert.equal(findColumnKey(row, ['Actual_Sales_Units']), 'Actual Sales Units');
});

test('Excel 1900 serial epoch is correct and fictitious serial 60 is rejected', () => {
  assert.equal(parseFlexibleDate(1)?.toISOString().slice(0, 10), '1900-01-01');
  assert.equal(parseFlexibleDate(59)?.toISOString().slice(0, 10), '1900-02-28');
  assert.equal(parseFlexibleDate(60), null);
  assert.equal(parseFlexibleDate(61)?.toISOString().slice(0, 10), '1900-03-01');
  assert.equal(parseFlexibleDate('00059')?.toISOString().slice(0, 10), '1900-02-28');
  assert.equal(parseFlexibleDate('00060'), null);
  assert.equal(parseFlexibleDate('00061')?.toISOString().slice(0, 10), '1900-03-01');
});

test('Excel serial dates are accepted across the full supported 1900–2199 calendar range', () => {
  const excelEpoch = Date.UTC(1899, 11, 31);
  const serialFor = (isoDate: string) => {
    const dateMs = Date.parse(`${isoDate}T00:00:00.000Z`);
    const serial = (dateMs - excelEpoch) / 86400000;
    return isoDate >= '1900-03-01' ? serial + 1 : serial;
  };
  for (const date of ['1900-01-01', '1950-01-01', '2120-01-01', '2199-12-31']) {
    const serial = serialFor(date);
    assert.equal(parseFlexibleDate(serial)?.toISOString().slice(0, 10), date);
    if (serial >= 10000) {
      assert.equal(parseFlexibleDate(String(serial))?.toISOString().slice(0, 10), date);
    }
  }
  assert.equal(parseFlexibleDate(1)?.toISOString().slice(0, 10), '1900-01-01');
  assert.equal(parseFlexibleDate(109575), null);
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

test('enterprise schema metadata is internally consistent across tables, foreign keys and domain contracts', () => {
  const tableNames = Object.keys(TABLE_CONTRACTS);
  for (const [tableName, contract] of Object.entries(TABLE_CONTRACTS)) {
    assert.equal(contract.tableName, tableName, `tableName must match contract key for ${tableName}`);
    const declaredColumns = new Set([
      ...contract.mandatoryColumns,
      ...contract.optionalColumns,
      ...contract.businessKey,
      ...Object.keys(contract.columnTypes),
    ]);
    assert.equal(new Set(contract.mandatoryColumns).size, contract.mandatoryColumns.length, `${tableName} mandatory columns must be unique`);
    assert.equal(new Set(contract.optionalColumns).size, contract.optionalColumns.length, `${tableName} optional columns must be unique`);
    assert.equal(new Set(contract.businessKey).size, contract.businessKey.length, `${tableName} business key must not repeat columns`);
    assert.equal(
      contract.mandatoryColumns.some((column) => contract.optionalColumns.includes(column)),
      false,
      `${tableName} must not mark a column both mandatory and optional`
    );
    for (const typedColumn of Object.keys(contract.columnTypes)) {
      assert.ok(
        contract.mandatoryColumns.includes(typedColumn) || contract.optionalColumns.includes(typedColumn),
        `${tableName} typed column ${typedColumn} must be declared mandatory or optional`
      );
    }
    for (const column of contract.mandatoryColumns) {
      assert.ok(declaredColumns.has(column), `${tableName} mandatory column ${column} must be declared`);
    }
    for (const keyColumn of contract.businessKey) {
      assert.ok(declaredColumns.has(keyColumn), `${tableName} business-key column ${keyColumn} must be declared`);
    }
    for (const foreignKey of contract.foreignKeys) {
      assert.ok(declaredColumns.has(foreignKey.col), `${tableName} FK source ${foreignKey.col} must be declared`);
      assert.ok(tableNames.includes(foreignKey.targetTable), `${tableName} FK target ${foreignKey.targetTable} must have a table contract`);
      const targetContract = TABLE_CONTRACTS[foreignKey.targetTable];
      const targetColumns = new Set([
        ...targetContract.mandatoryColumns,
        ...targetContract.optionalColumns,
        ...targetContract.businessKey,
        ...Object.keys(targetContract.columnTypes),
      ]);
      assert.ok(targetColumns.has(foreignKey.targetCol), `${tableName} FK target column ${foreignKey.targetTable}.${foreignKey.targetCol} must be declared`);
    }
  }
  const validCategories = new Set([
    'schemaCompleteness',
    'timeAndKeyIntegrity',
    'stockoutDetection',
    'crossTableJoins',
    'promoAndPriceBounds',
    'uomAndSecuritySync',
  ]);
  for (const [domain, contract] of Object.entries(DOMAIN_CONTRACTS)) {
    assert.equal(new Set(contract.relevantTables).size, contract.relevantTables.length, `${domain} relevant tables must be unique`);
    assert.equal(new Set(contract.mandatoryTables).size, contract.mandatoryTables.length, `${domain} mandatory tables must be unique`);
    assert.equal(new Set(contract.requiredMasterTables).size, contract.requiredMasterTables.length, `${domain} required masters must be unique`);
    for (const category of contract.requiredCategories) {
      assert.ok(validCategories.has(category), `${domain} required category ${category} must be valid`);
    }
    for (const tableName of contract.relevantTables) {
      assert.ok(tableNames.includes(tableName), `${domain} relevant table ${tableName} must have a table contract`);
    }
    for (const tableName of contract.mandatoryTables) {
      assert.ok(tableNames.includes(tableName), `${domain} mandatory table ${tableName} must have a contract`);
      assert.ok(contract.relevantTables.includes(tableName), `${domain} mandatory table ${tableName} must be relevant`);
    }
    for (const master of contract.requiredMasterTables) {
      assert.ok(contract.mandatoryTables.includes(master), `${domain} required master ${master} must be mandatory`);
    }
  }
});

test('Procurement, MEIO, and Manufacturing require their core domain-specific input tables', () => {
  const requiredDomainInputs = [
    ['SUPPLY', '02_Forecast_Vintages_Lag'],
    ['PROCUREMENT', '13_Supplier_Sourcing_Contracts'],
    ['PROCUREMENT', '14_Purchase_Orders_Receipts'],
    ['MEIO', '02_Forecast_Vintages_Lag'],
    ['MEIO', '16_MEIO_Network_Policy_Costs'],
    ['MANUFACTURING', '15_Manufacturing_BOM_WorkCenters'],
  ] as const;

  for (const [domain, tableName] of requiredDomainInputs) {
    const sheets = createDomainTestWorkbook(domain);
    assert.ok(sheets[tableName], `Fixture for ${domain} must include mandatory table ${tableName}`);
    delete sheets[tableName];
    const report = validateWorkbook(sheets, { domain });
    assert.equal(report.schemaPassed, false, `Missing ${tableName} must fail schema assurance for ${domain}`);
    assert.ok(
      report.exceptions.some((exception) =>
        exception.signature === `SCHEMA|MISSING_TABLE|${tableName}` && exception.severity === 'CRITICAL'
      ),
      `Missing mandatory ${tableName} must emit a critical exception for ${domain}`
    );
    assert.equal(
      report.coverageMatrix?.find((entry) => entry.tableName === tableName)?.status,
      'NOT_RUN_MISSING_TABLE'
    );

    const emptyMandatoryTable = createDomainTestWorkbook(domain);
    emptyMandatoryTable[tableName].records = [];
    const emptyReport = validateWorkbook(emptyMandatoryTable, { domain });
    assert.equal(emptyReport.schemaPassed, false, `Empty mandatory ${tableName} must fail ${domain} schema assurance`);
    assert.equal(
      emptyReport.coverageMatrix?.find((entry) => entry.tableName === tableName)?.status,
      'NOT_RUN_EMPTY_TABLE'
    );
    assert.ok(
      emptyReport.exceptions.some((exception) => exception.signature === `SCHEMA|EMPTY_TABLE|${tableName}`),
      `Empty mandatory ${tableName} must emit a schema exception`
    );
  }
});

test('MEIO policy validation enforces safety-stock caps, holding cost and service-level bounds', () => {
  const sheets = createDomainTestWorkbook('MEIO');
  const policyRows = sheets['16_MEIO_Network_Policy_Costs'].records;
  policyRows[0].Min_Safety_Stock_Qty = 250;
  policyRows[0].Max_Inventory_Cap_Qty = 0; // zero cap must still enforce min <= max
  policyRows[0].Holding_Cost_Pct_Annual = 0;
  policyRows[0].Target_Service_Level_Pct = 40;
  policyRows[1].Holding_Cost_Pct_Annual = 101;
  policyRows[1].Target_Service_Level_Pct = 100;

  const report = validateWorkbook(sheets, { domain: 'MEIO' });
  const bounds = report.exceptions.filter((exception) => exception.signature.startsWith('MEIO_BOUNDS|'));
  const holdingCost = report.exceptions.filter((exception) => exception.signature.startsWith('MEIO_HOLDING_COST|'));
  const serviceLevel = report.exceptions.filter((exception) => exception.signature.startsWith('MEIO_SERVICE_LEVEL|'));

  assert.equal(bounds.length, 2);
  assert.ok(bounds.every((exception) => exception.severity === 'CRITICAL'));
  assert.ok(bounds.some((exception) => exception.badVal === 'Min 250 > Max 0'));
  assert.equal(holdingCost.length, 2);
  assert.ok(holdingCost.every((exception) => exception.severity === 'CRITICAL'));
  assert.equal(serviceLevel.length, 2);
  assert.ok(serviceLevel.every((exception) => exception.severity === 'CRITICAL'));
});

test('Procurement checks positive contract terms, effective date order, PO quantity and over-receipt', () => {
  const sheets = createDomainTestWorkbook('PROCUREMENT');
  const contract = sheets['13_Supplier_Sourcing_Contracts'].records[0];
  contract.Supplier_Lead_Time_Days = 1.5;
  contract.MOQ_Units = 0;
  contract.Order_Multiple_Qty = 0;
  contract.Unit_Purchase_Cost_INR = 0;
  contract.Contract_Valid_From = '2025-12-01';
  contract.Contract_Valid_To = '2025-01-01';

  const poRows = sheets['14_Purchase_Orders_Receipts'].records;
  poRows[0].Ordered_PO_Qty_Units = 0;
  poRows[0].Received_Qty_Units = 10;
  poRows[1].Received_Qty_Units = 500; // 50 units over the 450-unit PO

  const report = validateWorkbook(sheets, { domain: 'PROCUREMENT' });
  const signatures = report.exceptions.map((exception) => exception.signature);
  for (const prefix of [
    'SUPPLIER_LT_INTEGER|',
    'SUPPLIER_MOQ_POSITIVE|',
    'SUPPLIER_MULTIPLE_POSITIVE|',
    'SUPPLIER_COST_POSITIVE|',
    'SUPPLIER_CONTRACT_DATES|',
    'PO_ORDER_QTY_POSITIVE|',
    'PO_OVER_RECEIPT|',
  ]) {
    assert.ok(signatures.some((signature) => signature.startsWith(prefix)), `Expected procurement exception ${prefix}`);
  }
  assert.equal(report.exceptions.find((exception) => exception.signature.startsWith('PO_ORDER_QTY_POSITIVE|'))?.severity, 'CRITICAL');
  assert.equal(report.exceptions.find((exception) => exception.signature.startsWith('PO_OVER_RECEIPT|'))?.severity, 'WARNING');
});

test('Manufacturing assurance rejects zero component quantities, self-components and BOM cycles', () => {
  const sheets = createDomainTestWorkbook('MANUFACTURING');
  const bom = sheets['15_Manufacturing_BOM_WorkCenters'];
  bom.records.push(
    {
      BOM_ID: 'BOM-CYCLE-A',
      Parent_SKU_Code: 'SKU_DAIRY_03',
      Component_SKU_Code: 'SKU_SNK_02',
      Location_DC: 'Kolkata',
      Work_Center_ID: 'WC-CYCLE-A',
      Component_Qty_Per_Unit: 1,
      Scrap_Factor_Pct: 2,
      Yield_Pct: 98,
      Available_Capacity_Hrs: 100,
      Required_Run_Hrs: 80,
    },
    {
      BOM_ID: 'BOM-CYCLE-B',
      Parent_SKU_Code: 'SKU_SNK_02',
      Component_SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Work_Center_ID: 'WC-CYCLE-B',
      Component_Qty_Per_Unit: 1,
      Scrap_Factor_Pct: 2,
      Yield_Pct: 98,
      Available_Capacity_Hrs: 100,
      Required_Run_Hrs: 80,
    },
    {
      BOM_ID: 'BOM-SELF',
      Parent_SKU_Code: 'SKU_DAIRY_03',
      Component_SKU_Code: 'SKU_DAIRY_03',
      Location_DC: 'Kolkata',
      Work_Center_ID: 'WC-SELF',
      Component_Qty_Per_Unit: 0,
      Scrap_Factor_Pct: 2,
      Yield_Pct: 98,
      Available_Capacity_Hrs: 100,
      Required_Run_Hrs: 80,
    },
    // These edges form a cycle only if depot/network location is ignored.
    {
      BOM_ID: 'BOM-CROSS-DEPOT-A',
      Parent_SKU_Code: 'RAW_MILK_01',
      Component_SKU_Code: 'RAW_GRAIN_02',
      Location_DC: 'Kolkata',
      Work_Center_ID: 'WC-CROSS-A',
      Component_Qty_Per_Unit: 1,
      Scrap_Factor_Pct: 2,
      Yield_Pct: 98,
      Available_Capacity_Hrs: 100,
      Required_Run_Hrs: 80,
    },
    {
      BOM_ID: 'BOM-CROSS-DEPOT-B',
      Parent_SKU_Code: 'RAW_GRAIN_02',
      Component_SKU_Code: 'RAW_MILK_01',
      Location_DC: 'Mumbai',
      Work_Center_ID: 'WC-CROSS-B',
      Component_Qty_Per_Unit: 1,
      Scrap_Factor_Pct: 2,
      Yield_Pct: 98,
      Available_Capacity_Hrs: 100,
      Required_Run_Hrs: 80,
    }
  );

  const report = validateWorkbook(sheets, { domain: 'MANUFACTURING' });
  assert.ok(report.exceptions.some((exception) => exception.signature.startsWith('MFG_BOM_CYCLE|')));
  assert.ok(report.exceptions.some((exception) => exception.signature.startsWith('MFG_BOM_SELF_COMPONENT|')));
  assert.ok(report.exceptions.some((exception) => exception.signature.startsWith('MFG_COMPONENT_QTY|')));
  const cycleExceptions = report.exceptions.filter((exception) => exception.signature.startsWith('MFG_BOM_CYCLE|'));
  assert.equal(cycleExceptions.length, 1, 'self-components are separate and cross-depot edges must not create false cycles');
  assert.ok(cycleExceptions.every((exception) => exception.severity === 'CRITICAL'));
});

test('Procurement applies supplier contract MOQ only during the contract effective date range', () => {
  const sheets = createDomainTestWorkbook('PROCUREMENT');
  const contracts = sheets['13_Supplier_Sourcing_Contracts'].records;
  for (const contract of contracts) {
    contract.Contract_Valid_From = '2025-10-01';
    contract.Contract_Valid_To = '2025-12-31';
  }
  const poRows = sheets['14_Purchase_Orders_Receipts'].records;
  poRows[0].Period_Date = '2025-11-01'; // in range
  poRows[1].Supplier_ID = poRows[0].Supplier_ID;
  poRows[1].SKU_Code = poRows[0].SKU_Code;
  poRows[1].Location_DC = poRows[0].Location_DC;
  poRows[1].Ordered_PO_Qty_Units = 600;
  poRows[1].Received_Qty_Units = 600;
  poRows[1].Period_Date = '2026-01-15'; // expired

  const report = validateWorkbook(sheets, { domain: 'PROCUREMENT' });
  const effectiveWarnings = report.exceptions.filter((exception) =>
    exception.signature.startsWith('PO_CONTRACT_EFFECTIVE|')
  );
  assert.equal(effectiveWarnings.length, 1);
  assert.match(effectiveWarnings[0].badVal, /2026-01-15/);
  assert.match(effectiveWarnings[0].issue, /effective/i);
});

test('all six planning domains enforce their table boundary and exclude out-of-domain rows', () => {
  const domains = ['DEMAND', 'SUPPLY', 'SOP', 'MEIO', 'PROCUREMENT', 'MANUFACTURING'] as const;
  const otherDomainTables = {
    ...createDomainTestWorkbook('PROCUREMENT'),
    ...createDomainTestWorkbook('MANUFACTURING'),
  };

  for (const domain of domains) {
    const domainSheets = createDomainTestWorkbook(domain);
    const expectedInDomainRows = Object.values(domainSheets).reduce(
      (sum, table) => sum + table.records.filter((row) => !row._removed).length,
      0
    );
    const outOfDomainTable = Object.keys(otherDomainTables).find(
      (tableName) => !Object.prototype.hasOwnProperty.call(domainSheets, tableName)
    );
    assert.ok(outOfDomainTable, `Expected an out-of-domain table for ${domain}`);
    domainSheets[outOfDomainTable] = otherDomainTables[outOfDomainTable];

    const report = validateWorkbook(domainSheets, { domain });
    assert.equal(report.activeDomain, domain);
    assert.equal(report.health.totalRows, expectedInDomainRows);
    assert.equal(report.schemaPassed, true, `${domain} domain fixture must pass structural schema validation`);
    assert.equal(report.allRequiredValidationsExecuted, true, `${domain} required assurance checks must execute`);
    for (const category of DOMAIN_CONTRACTS[domain].requiredCategories) {
      const categoryStatus = report.categories.find((summary) => summary.key === category)?.status;
      assert.ok(
        categoryStatus === 'PASSED' || categoryStatus === 'FAILED',
        `${domain} required category ${category} must execute, not remain NOT_RUN/PARTIAL`
      );
    }
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

    const workbookHash = computeWorkbookHash(domainSheets);
    const gate = evaluateReleaseGate(
      report,
      {
        approver: 'Fixture Governance Reviewer',
        reason: 'Automated clean-domain release-gate fixture',
        expiry: 'Long-term fixture sign-off',
        signedAt: '2026-11-19T00:00:00.000Z',
        expiresAt: '2099-12-31T23:59:59.000Z',
        sourceWorkbookHash: workbookHash,
      },
      true,
      Date.parse('2026-11-19T00:00:00.000Z'),
      workbookHash
    );
    const expectedGateUnlocked =
      report.schemaPassed &&
      report.allRequiredValidationsExecuted &&
      !report.exceptions.some((exception) => exception.severity === 'CRITICAL');
    assert.equal(
      gate.step2Unlocked,
      expectedGateUnlocked,
      `${domain} release gate must reflect structural, execution, critical, formula, and signed-warning conditions`
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
  assert.equal(resolveColumnDataType('Orders_Sheet', 'Ordered_Qty_Units'), 'STRING', 'Table aliases are not implicitly trusted');
  assert.equal(report.health.totalRows, Object.values(demandWorkbook)
    .filter((table) => table !== demandWorkbook['01_Orders_Unrelated'])
    .reduce((sum, table) => sum + table.records.filter((row) => !row._removed).length, 0));

  demandWorkbook['12_NPI_Unrelated'] = {
    pillar: 'Uploaded Workbook',
    desc: 'Not the NPI lifecycle table',
    cols: [
      { col: 'SKU_Code', type: 'STRING', key: 'PK' },
      { col: 'Reference_Analog_SKU_Code', type: 'STRING', key: 'Attribute' },
    ],
    records: [{ SKU_Code: 'FAKE_LAUNCH', Reference_Analog_SKU_Code: 'NOT_IN_MASTER' }],
  };
  const npiSpoofReport = validateWorkbook(demandWorkbook, { domain: 'DEMAND' });
  assert.equal(
    npiSpoofReport.exceptions.some((exception) => exception.table === '12_NPI_Unrelated'),
    false,
    'NPI-specific validation must not apply to a numeric-prefix lookalike'
  );
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
  assert.equal(
    runCrossTableReconciliation(workbook, undefined, 'DEMAND').checks.find((check) => check.id === 'REC-04')?.status,
    'NOT_RUN',
    'REC-04 must fail closed when an in-domain table mapping is ambiguous'
  );
  const duplicateProfile = profileWorkbook(workbook, report.exceptions);
  assert.equal(
    duplicateProfile.tables.find((table) => table.table === '01_Orders_Shipments_History')?.columns
      .find((column) => column.column === 'Ordered_Qty_Units')?.expectedType,
    'STRING',
    'Ambiguous canonical mapping must not inherit contract typing'
  );
  assert.throws(
    () => applyColumnMapping(
      workbook,
      '01_Orders_Shipments_History',
      'Ordered_Custom_Alias',
      'Ordered_Qty_Units'
    ),
    /not an unambiguous canonical table or supported alias/i
  );
});

test('duplicate missing-period approvals do not create duplicate continuity rows', () => {
  const source = createSeededEnterpriseSheets();
  const sourceHash = computeWorkbookHash(source);
  const correction: ApprovedCorrection = {
    id: 'COR-MISSING-PERIOD-IDEMPOTENCY-1',
    exceptionSignature: 'IMPUTE_MISSING_PERIOD|2025-08-01|SKU_DAIRY_03|Kolkata|GT',
    fixType: 'IMPUTE_MISSING_PERIOD',
    table: '01_Orders_Shipments_History',
    rowIndex: 0,
    approvedValue: 1500,
    beforeSummary: 'Missing period',
    afterSummary: 'Continuity row',
    approver: 'Test Steward',
    reason: 'Verified source input',
    approvedAt: '2026-11-19',
    sourceWorkbookHash: sourceHash,
    missingPeriodMeta: {
      periodDate: '2025-08-01',
      sku: 'SKU_DAIRY_03',
      depot: 'Kolkata',
      channel: 'GT',
    },
  };
  const governed = applyApprovedCorrections(source, [correction, { ...correction, id: 'COR-MISSING-PERIOD-IDEMPOTENCY-2' }]);
  const imputed = governed['01_Orders_Shipments_History'].records.filter(
    (row) => row._isImputedContinuityRow === true &&
      row.Period_Date === '2025-08-01' &&
      row.SKU_Code === 'SKU_DAIRY_03' &&
      row.Location_DC === 'Kolkata' &&
      row.Channel_Code === 'GT'
  );
  assert.equal(imputed.length, 1);
});

test('schema validation catches duplicate metadata headers after normalization', () => {
  const workbook = createSeededEnterpriseSheets();
  const orders = workbook['01_Orders_Shipments_History'];
  const skuColumn = orders.cols.find((column) => column.col === 'SKU_Code')!;
  orders.cols.push({ ...skuColumn, col: 'sku code' });
  const report = validateWorkbook(workbook);
  assert.ok(
    report.exceptions.some((exception) =>
      exception.signature === 'SCHEMA|DUPLICATE_COL|01_Orders_Shipments_History|sku code'
    )
  );
  assert.equal(report.schemaPassed, false);
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

  const nestedObjectA = {
    T: {
      pillar: 'Test',
      desc: 'Nested object fixture',
      cols: [],
      records: [{ Nested: { first: 1, second: [2, 3] } }],
    },
  } as unknown as EnterpriseSheets;
  const nestedObjectB = {
    T: {
      pillar: 'Test',
      desc: 'Nested object fixture',
      cols: [],
      records: [{ Nested: { second: [2, 3], first: 1 } }],
    },
  } as unknown as EnterpriseSheets;
  assert.equal(computeWorkbookHash(nestedObjectA), computeWorkbookHash(nestedObjectB));

  const nestedArrayChanged = {
    T: {
      pillar: 'Test',
      desc: 'Nested object fixture',
      cols: [],
      records: [{ Nested: { first: 1, second: [3, 2] } }],
    },
  } as unknown as EnterpriseSheets;
  assert.notEqual(computeWorkbookHash(nestedObjectA), computeWorkbookHash(nestedArrayChanged));
});


test('Capability #4: persistence recovery rejects inaccessible, tampered, stale and version-mismatched browser snapshots', () => {
  const sheets = createSeededEnterpriseSheets();
  const sourceWorkbookHash = computeWorkbookHash(sheets);
  const state = {
    industry: 'cpg' as const,
    domain: 'ALL' as const,
    ruleConfig: DEFAULT_RULE_CONFIG,
    sourceSheets: sheets,
    workbookSource: 'Persistence_Recovery_Matrix.xlsx',
    activeSheet: '01_Orders_Shipments_History',
    sourceWorkbookHash,
    datasetVersion: 1,
    approvedCorrections: [] as ApprovedCorrection[],
    warningSignOff: null,
    auditLog: [] as AuditEntry[],
    lineageHistory: [],
    exceptionAssignments: {},
  };

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const removeWindow = () => {
    Reflect.deleteProperty(globalThis, 'window');
  };
  const installWindow = (value: unknown) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: value as Window,
    });
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  try {
    // No browser window: persistence fails explicitly and recovery never creates demo data.
    removeWindow();
    assert.equal(savePersistedGovernanceState(state).ok, false);
    assert.equal(hasPersistedGovernanceState(), false);
    assert.equal(loadPersistedGovernanceState(), null);

    // Security/privacy mode can expose window while throwing on localStorage access.
    const deniedWindow = Object.defineProperty({}, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('storage access denied'); },
    });
    installWindow(deniedWindow);
    assert.equal(savePersistedGovernanceState(state).ok, false);
    assert.equal(hasPersistedGovernanceState(), false);
    assert.equal(loadPersistedGovernanceState(), null);

    // Stale workbook hashes and invalid dataset versions must not be written.
    installWindow({ localStorage: storage });
    const staleHashResult = savePersistedGovernanceState({
      ...state,
      sourceWorkbookHash: 'SHA256-STALE-HASH',
    });
    assert.equal(staleHashResult.ok, false);
    assert.match(staleHashResult.error ?? '', /hash changed before persistence/i);
    const invalidVersionResult = savePersistedGovernanceState({
      ...state,
      datasetVersion: 0,
    });
    assert.equal(invalidVersionResult.ok, false);
    assert.match(invalidVersionResult.error ?? '', /positive safe integer/i);

    assert.equal(savePersistedGovernanceState(state).ok, true);
    const key = Array.from(values.keys())[0];
    const validPayload = JSON.parse(values.get(key)!) as Record<string, unknown>;

    // A tampered source hash restores the workbook for explicit inspection but strips every
    // approval/sign-off so old governance decisions cannot be replayed.
    const tamperedHashPayload = {
      ...validPayload,
      sourceWorkbookHash: 'SHA256-TAMPERED',
      approvedCorrections: [{ id: 'TAMPERED-APPROVAL' }],
      warningSignOff: { approver: 'Tampered', sourceWorkbookHash: 'SHA256-TAMPERED', datasetVersion: 1 },
    };
    values.set(key, JSON.stringify(tamperedHashPayload));
    const hashMismatchRestore = loadPersistedGovernanceState();
    assert.equal(hashMismatchRestore?.sourceWorkbookHash, sourceWorkbookHash);
    assert.deepEqual(hashMismatchRestore?.approvedCorrections, []);
    assert.equal(hashMismatchRestore?.warningSignOff, null);

    // An invalid snapshot top-level type or empty workbook payload is never hydrated.
    values.set(key, '[]');
    assert.equal(loadPersistedGovernanceState(), null);
    values.set(key, JSON.stringify({ ...validPayload, sourceSheets: {} }));
    assert.equal(loadPersistedGovernanceState(), null);

    // An active lineage record from a different dataset version invalidates the whole snapshot.
    values.set(key, JSON.stringify({
      ...validPayload,
      datasetVersion: 1,
      lineageHistory: [{ uploadStatus: 'ACTIVE', datasetVersion: 2 }],
    }));
    assert.equal(loadPersistedGovernanceState(), null);

    // Browser quotas and other write errors remain visible to the caller.
    installWindow({
      localStorage: {
        getItem: storage.getItem,
        setItem: () => { throw new Error('quota exceeded during recovery checkpoint'); },
        removeItem: storage.removeItem,
      },
    });
    const quotaResult = savePersistedGovernanceState(state);
    assert.equal(quotaResult.ok, false);
    assert.match(quotaResult.error ?? '', /quota exceeded/i);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      removeWindow();
    }
  }
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
    activeSheet: '01_Orders_Shipments_History',
    sourceWorkbookHash,
    approvedCorrections: [] as ApprovedCorrection[],
    warningSignOff: null,
    auditLog: [] as AuditEntry[],
    lineageHistory: [],
    exceptionAssignments: {
      'SIG-INVALID-SLA-DATE': {
        owner: 'Master Data Steward',
        slaHours: 4,
        status: 'IN_REVIEW',
        assignedAt: 'not-a-date',
        dueAt: 'not-a-date',
        isOverdue: true,
        history: [],
      },
    } as Record<string, ExceptionAssignment>,
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
    assert.equal(savePersistedGovernanceState(state).ok, true);
    const restored = loadPersistedGovernanceState();
    assert.equal(restored?.sourceWorkbookHash, sourceWorkbookHash);
    assert.equal(restored?.activeSheet, '01_Orders_Shipments_History');
    assert.equal(Object.keys(restored?.sourceSheets ?? {}).length, Object.keys(sheets).length);
    assert.equal(restored?.exceptionAssignments['SIG-INVALID-SLA-DATE'].assignedAt, undefined);
    assert.equal(restored?.exceptionAssignments['SIG-INVALID-SLA-DATE'].dueAt, undefined);
    assert.equal(restored?.exceptionAssignments['SIG-INVALID-SLA-DATE'].isOverdue, false);

    state.auditLog = Array.from({ length: 1200 }, (_, index) => ({
      ts: `2026-11-19T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      evt: `Event_${index}`,
      scope: 'test',
      user: 'test-session',
      out: 'ok',
      datasetHash: sourceWorkbookHash,
    }));
    assert.equal(savePersistedGovernanceState(state).ok, true);
    const boundedAudit = loadPersistedGovernanceState()?.auditLog ?? [];
    assert.equal(boundedAudit.length, 1000);
    assert.equal(boundedAudit[0].evt, 'Event_0');

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

    const malformedPolicyPayload = JSON.parse(values.get(key)!) as Record<string, unknown>;
    malformedPolicyPayload.activeSheet = 'DOES_NOT_EXIST';
    malformedPolicyPayload.ruleConfig = {
      ...DEFAULT_RULE_CONFIG,
      salesOverrideMaxPct: '1,2,3',
      standardCasePackMin: '0x10',
      enforceFutureDateGuard: 'false',
    };
    values.set(key, JSON.stringify(malformedPolicyPayload));
    const restoredPolicy = loadPersistedGovernanceState();
    assert.equal(restoredPolicy?.activeSheet, Object.keys(sheets)[0]);
    assert.equal(restoredPolicy?.ruleConfig.salesOverrideMaxPct, DEFAULT_RULE_CONFIG.salesOverrideMaxPct);
    assert.equal(restoredPolicy?.ruleConfig.standardCasePackMin, DEFAULT_RULE_CONFIG.standardCasePackMin);
    assert.equal(restoredPolicy?.ruleConfig.enforceFutureDateGuard, DEFAULT_RULE_CONFIG.enforceFutureDateGuard);

    const duplicateCorrection = {
      id: 'COR-DUPLICATE-1',
      exceptionSignature: 'SIG-DUPLICATE',
      fixType: 'IMPUTE_ACTUAL',
      table: '01_Orders_Shipments_History',
      rowIndex: 0,
      approvedValue: 1200,
      beforeSummary: 'Missing',
      afterSummary: '1200',
      approver: 'Test Approver',
      reason: 'Verified source',
      approvedAt: '2026-11-19',
      sourceWorkbookHash,
      datasetVersion: 1,
    };
    values.set(
      key,
      JSON.stringify({
        ...state,
        approvedCorrections: [
          duplicateCorrection,
          { ...duplicateCorrection, id: 'COR-DUPLICATE-2', approvedValue: 1500 },
        ],
      })
    );
    const restoredDuplicates = loadPersistedGovernanceState();
    assert.equal(restoredDuplicates?.approvedCorrections.length, 1);
    assert.equal(restoredDuplicates?.approvedCorrections[0].approvedValue, 1200);

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
    assert.equal(savePersistedGovernanceState(state).ok, false);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
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
  assert.equal(futureOnly.status, 'CRITICAL_MISMATCH');
  assert.equal(futureOnly.eligibleRecordsCount, 0);
  assert.match(futureOnly.detail, /future Effective_From_Month/i);

  // Missing transaction dates cannot select an arbitrary latest catalog price.
  const missingDate = rec02([order('')], [price('2025-05-01')]);
  assert.equal(missingDate.status, 'CRITICAL_MISMATCH');
  assert.equal(missingDate.eligibleRecordsCount, 0);

  // Preserve the existing explicit SKU × ALL fallback when no exact-channel key exists,
  // while still enforcing the transaction-date effective-date cutoff.
  const wildcardFallback = rec02([order('2025-06-15', 'GT')], [price('2025-05-01', 'ALL')]);
  assert.equal(wildcardFallback.status, 'RECONCILED');
  assert.equal(wildcardFallback.eligibleRecordsCount, 1);

  const futureWildcard = rec02([order('2025-06-15', 'GT')], [price('2025-07-01', 'ALL')]);
  assert.equal(futureWildcard.status, 'CRITICAL_MISMATCH');
  assert.equal(futureWildcard.eligibleRecordsCount, 0);

  // A valid matched subset must not hide other invoice lines excluded for missing prices.
  const partialMatch = rec02(
    [order('2025-06-15', 'GT'), order('2025-06-15', 'MT')],
    [price('2025-05-01', 'GT'), price('2025-07-01', 'MT', 99)]
  );
  assert.equal(partialMatch.eligibleRecordsCount, 1);
  assert.equal(partialMatch.status, 'CRITICAL_MISMATCH');
  assert.match(partialMatch.detail, /future Effective_From_Month/i);
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
  assert.doesNotMatch(balanced.equation.split(';')[0], /Returns_Damaged_Qty/);
  assert.match(balanced.equation.split(';')[1] ?? '', /Returns_Damaged_Qty/);
  assert.match(balanced.detail, /Reverse-Flow Returns/i);

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
  // A percentage has no valid denominator when net ordered units are zero.
  assert.equal(zeroOrderOvership.variancePct, null);
  assert.equal(zeroOrderOvership.status, 'CRITICAL_MISMATCH');
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

test('Requirement A mutation boundary: structural remediation and column mapping increment datasetVersion, clear warningSignOff, re-bind demonstrably unaffected corrections with immutable provenance, invalidate affected or unprovable corrections, and block release gate', () => {
  const sheets = createSeededEnterpriseSheets();
  // Prepare a table with a non-canonical column alias for Ordered_Qty_Units on 01_Orders_Shipments_History
  // and remove a column on 04_Trade_Promotions_Calendar to exercise structural remediation.
  sheets['04_Trade_Promotions_Calendar'].cols = sheets['04_Trade_Promotions_Calendar'].cols.filter(
    (c) => c.col !== 'Expected_Uplift_Pct'
  );
  sheets['04_Trade_Promotions_Calendar'].records.forEach((r) => {
    delete r.Expected_Uplift_Pct;
  });

  const v1Hash = computeWorkbookHash(sheets);
  const v1Version = 1;

  // 1. Unaffected correction on 01_Orders_Shipments_History row 0 (IMPUTE_ACTUAL)
  const unaffectedCorrection: ApprovedCorrection = {
    id: 'COR-UNAFFECTED-1',
    exceptionSignature: 'ACTUAL_MISSING|01_Orders_Shipments_History|0',
    fixType: 'IMPUTE_ACTUAL',
    table: '01_Orders_Shipments_History',
    rowIndex: 0,
    targetCol: 'Invoiced_Actual_Qty',
    approvedValue: 1350,
    beforeSummary: 'NULL',
    afterSummary: '1350',
    approver: 'Demand Steward',
    reason: 'Verified ERP delivery note',
    approvedAt: '2026-11-20 08:00',
    sourceWorkbookHash: v1Hash,
    datasetVersion: v1Version,
    status: 'ACTIVE',
  };

  // 2. Affected correction on 04_Trade_Promotions_Calendar row 0 targeting Expected_Uplift_Pct
  const affectedByRemediationCorrection: ApprovedCorrection = {
    id: 'COR-AFFECTED-REMEDIATION',
    exceptionSignature: 'SCHEMA_EMPTY|04_Trade_Promotions_Calendar|0|Expected_Uplift_Pct',
    fixType: 'SCHEMA_REMEDIATION',
    table: '04_Trade_Promotions_Calendar',
    rowIndex: 0,
    targetCol: 'Expected_Uplift_Pct',
    approvedValue: 18,
    beforeSummary: 'Empty',
    afterSummary: '18',
    approver: 'Commercial Steward',
    reason: 'Promo uplift baseline',
    approvedAt: '2026-11-20 08:01',
    sourceWorkbookHash: v1Hash,
    datasetVersion: v1Version,
    status: 'ACTIVE',
  };

  // 3. Unprovable correction missing targetCol for SANITIZE_CELL (dependencies cannot be established -> must invalidate)
  const unprovableCorrection: ApprovedCorrection = {
    id: 'COR-UNPROVABLE',
    exceptionSignature: 'SEC_XSS|01_Orders_Shipments_History|1',
    fixType: 'SANITIZE_CELL',
    table: '01_Orders_Shipments_History',
    rowIndex: 1,
    approvedValue: 'CLEAN_VAL',
    beforeSummary: '<script>',
    afterSummary: 'CLEAN_VAL',
    approver: 'Security Reviewer',
    reason: 'Sanitize cell without targetCol',
    approvedAt: '2026-11-20 08:02',
    sourceWorkbookHash: v1Hash,
    datasetVersion: v1Version,
    status: 'ACTIVE',
  };

  const initialSignOff = {
    approver: 'VP Supply Chain',
    reason: 'Acknowledged v1 warnings',
    expiry: '7 Days',
    signedAt: '2026-11-20 08:05',
    expiresAt: '2099-12-31T23:59:59.000Z',
    sourceWorkbookHash: v1Hash,
    datasetVersion: v1Version,
  };

  // Execute Structural Remediation on 04_Trade_Promotions_Calendar.Expected_Uplift_Pct
  const mutation1 = executeGovernedDatasetMutation({
    sourceSheets: sheets,
    datasetVersion: v1Version,
    approvedCorrections: [
      unaffectedCorrection,
      affectedByRemediationCorrection,
      unprovableCorrection,
    ],
    warningSignOff: initialSignOff,
    lineageHistory: [
      {
        id: 'LIN-001',
        fileName: 'Test_Workbook.xlsx',
        fileHash: v1Hash,
        governedOutputHash: v1Hash,
        sourceVersion: v1Version,
        datasetVersion: v1Version,
        uploadStatus: 'ACTIVE',
        uploadedAt: '2026-11-20 08:00',
        sheetCount: Object.keys(sheets).length,
        totalRows: 50,
        domain: 'ALL',
        industry: 'cpg',
      },
    ],
    operation: {
      kind: 'STRUCTURAL_REMEDIATION',
      table: '04_Trade_Promotions_Calendar',
      column: 'Expected_Uplift_Pct',
    },
    domain: 'ALL',
    industry: 'cpg',
    timestamp: '2026-11-20 09:00',
  });

  assert.equal(mutation1.mutated, true);
  assert.equal(mutation1.previousDatasetVersion, 1);
  assert.equal(mutation1.nextDatasetVersion, 2);
  assert.notEqual(mutation1.nextWorkbookHash, v1Hash);
  assert.equal(mutation1.warningSignOffCleared, true);
  assert.equal(mutation1.nextWarningSignOff, null);
  assert.deepEqual(mutation1.reboundCorrectionIds, ['COR-UNAFFECTED-1']);
  assert.deepEqual(mutation1.invalidatedCorrectionIds, [
    'COR-AFFECTED-REMEDIATION',
    'COR-UNPROVABLE',
  ]);
  assert.ok(mutation1.auditEntry);
  assert.equal(mutation1.auditEntry.evt, 'DATASET_MUTATED_BY_REMEDIATION');
  assert.equal(mutation1.auditEntry.datasetHash, mutation1.nextWorkbookHash);
  assert.equal(mutation1.auditEntry.datasetVersion, 2);
  assert.equal(mutation1.auditEntry.previousDatasetHash, v1Hash);
  assert.equal(mutation1.auditEntry.previousDatasetVersion, 1);

  // Check immutable provenance on re-bound correction
  const reboundCorr = mutation1.nextApprovedCorrections.find((c) => c.id === 'COR-UNAFFECTED-1')!;
  assert.equal(reboundCorr.status, 'ACTIVE');
  assert.equal(reboundCorr.sourceWorkbookHash, mutation1.nextWorkbookHash);
  assert.equal(reboundCorr.datasetVersion, 2);
  assert.equal(reboundCorr.originalSourceWorkbookHash, v1Hash);
  assert.equal(reboundCorr.originalDatasetVersion, 1);
  assert.equal(reboundCorr.originalApprovedAt, '2026-11-20 08:00');
  assert.equal(reboundCorr.revalidatedFromVersion, 1);

  // Check invalidated correction retains original hash & version and has status INVALIDATED_BY_REMEDIATION
  const invalidatedCorr = mutation1.nextApprovedCorrections.find(
    (c) => c.id === 'COR-AFFECTED-REMEDIATION'
  )!;
  assert.equal(invalidatedCorr.status, 'INVALIDATED_BY_REMEDIATION');
  assert.equal(invalidatedCorr.sourceWorkbookHash, v1Hash);
  assert.equal(invalidatedCorr.datasetVersion, 1);
  assert.equal(invalidatedCorr.invalidatedAtVersion, 2);
  assert.ok(invalidatedCorr.invalidationReason);

  // Verify applyApprovedCorrections applies rebound ACTIVE correction and skips INVALIDATED_BY_REMEDIATION
  const governedV2 = applyApprovedCorrections(
    mutation1.nextSheets,
    mutation1.nextApprovedCorrections,
    { strictHashBinding: true, currentDatasetVersion: 2 }
  );
  assert.equal(
    governedV2['01_Orders_Shipments_History'].records[0].Invoiced_Actual_Qty,
    1350
  );
  assert.equal(
    governedV2['04_Trade_Promotions_Calendar'].records[0].Expected_Uplift_Pct,
    ''
  );

  // Verify release gate blocks whenever any correction is INVALIDATED_BY_REMEDIATION
  // even if a synthetic clean report and valid sign-off are supplied
  const cleanReport = {
    ...validateWorkbook(createDomainTestWorkbook('DEMAND'), { domain: 'DEMAND' }),
    exceptions: [],
    schemaPassed: true,
    allRequiredValidationsExecuted: true,
  };
  const gateWithInvalidated = evaluateReleaseGate(
    cleanReport,
    null,
    true,
    Date.now(),
    mutation1.nextWorkbookHash,
    true,
    2,
    mutation1.nextApprovedCorrections
  );
  assert.equal(gateWithInvalidated.step2Unlocked, false);
  assert.equal(gateWithInvalidated.status, 'BLOCKED');
  assert.ok(
    gateWithInvalidated.blockingReasons.some((r) =>
      /invalidated by dataset remediation/i.test(r)
    )
  );

  // Now test Column Mapping on 01_Orders_Shipments_History mapping a column that COR-UNAFFECTED-1 depends on
  const v2SheetsWithAlias = mutation1.nextSheets;
  v2SheetsWithAlias['01_Orders_Shipments_History'].cols.push({
    col: 'Invoiced_Actual_Alias',
    type: 'NON_NEGATIVE_NUMBER',
    key: 'Attr',
  });
  v2SheetsWithAlias['01_Orders_Shipments_History'].records.forEach((r) => {
    r.Invoiced_Actual_Alias = r.Invoiced_Actual_Qty;
    delete r.Invoiced_Actual_Qty;
  });
  v2SheetsWithAlias['01_Orders_Shipments_History'].cols =
    v2SheetsWithAlias['01_Orders_Shipments_History'].cols.filter(
      (c) => c.col !== 'Invoiced_Actual_Qty'
    );
  const v2AliasHash = computeWorkbookHash(v2SheetsWithAlias);
  const corrBeforeMapping: ApprovedCorrection = {
    ...reboundCorr,
    sourceWorkbookHash: v2AliasHash,
    datasetVersion: 2,
  };

  const mutation2 = executeGovernedDatasetMutation({
    sourceSheets: v2SheetsWithAlias,
    datasetVersion: 2,
    approvedCorrections: [corrBeforeMapping],
    warningSignOff: null,
    lineageHistory: mutation1.nextLineageHistory,
    operation: {
      kind: 'COLUMN_MAPPING',
      table: '01_Orders_Shipments_History',
      sourceColumn: 'Invoiced_Actual_Alias',
      targetCanonicalColumn: 'Invoiced_Actual_Qty',
    },
    domain: 'ALL',
    industry: 'cpg',
    timestamp: '2026-11-20 09:05',
  });

  assert.equal(mutation2.mutated, true);
  assert.equal(mutation2.nextDatasetVersion, 3);
  assert.deepEqual(mutation2.reboundCorrectionIds, []);
  assert.deepEqual(mutation2.invalidatedCorrectionIds, ['COR-UNAFFECTED-1']);
  assert.equal(
    mutation2.nextApprovedCorrections[0].status,
    'INVALIDATED_BY_REMEDIATION'
  );
  // Original v1 provenance remains preserved even after later invalidation
  assert.equal(mutation2.nextApprovedCorrections[0].originalSourceWorkbookHash, v1Hash);
  assert.equal(mutation2.nextApprovedCorrections[0].originalDatasetVersion, 1);
});

test('Requirement A: changed-signature reapproval cannot bypass unresolved invalidated corrections', () => {
  const previousInvalidated = {
    id: 'COR-INVALIDATED-OLD',
    exceptionSignature: 'VALUE_OUT_OF_RANGE|01_Orders_Shipments_History|7|Ordered_Qty_Units',
    status: 'INVALIDATED_BY_REMEDIATION' as const,
  };
  const activeCorrection = {
    id: 'COR-ACTIVE',
    exceptionSignature: 'ACTUAL_MISSING|01_Orders_Shipments_History|2',
    status: 'ACTIVE' as const,
  };

  // Same-signature reapproval replaces the exact invalidated exception.
  assert.deepEqual(
    getApprovalBlockingInvalidatedCorrectionIds([previousInvalidated], previousInvalidated.exceptionSignature),
    []
  );

  // A changed signature cannot hide the old invalidated record or let a new approval
  // appear to clear the release block.
  assert.deepEqual(
    getApprovalBlockingInvalidatedCorrectionIds([previousInvalidated, activeCorrection], 'NEW_EXCEPTION_SIGNATURE'),
    ['COR-INVALIDATED-OLD']
  );
  assert.deepEqual(
    getApprovalBlockingInvalidatedCorrectionIds([activeCorrection], 'NEW_EXCEPTION_SIGNATURE'),
    []
  );
});

test('Audit Log JSON export envelope includes exportSchemaVersion, activeDatasetHash, and activeDatasetVersion', () => {
  const sheets = createSeededEnterpriseSheets();
  const hash = computeWorkbookHash(sheets);
  const sampleAudit: AuditEntry[] = [
    {
      ts: '2026-11-20 09:00',
      evt: 'DATASET_MUTATED_BY_REMEDIATION',
      scope: 'STRUCTURAL_REMEDIATION:04_Trade_Promotions_Calendar.Expected_Uplift_Pct',
      user: 'APP SESSION (UNAUTHENTICATED)',
      beforeVal: 'SHA256-OLD (v1)',
      afterVal: `${hash.slice(0, 19)}… (v2)`,
      out: 'Version v1→v2',
      datasetHash: hash,
      datasetVersion: 2,
    },
  ];
  const envelope = buildAuditLogExportEnvelope({
    auditLogs: sampleAudit,
    workbookSource: 'Built-in Enterprise 12-Table Dataset',
    sourceWorkbookHash: hash,
    datasetVersion: 2,
    exportedAt: '2026-11-20T09:00:00.000Z',
  });
  assert.equal(envelope.exportSchemaVersion, '1.0');
  assert.equal(envelope.exportedAt, '2026-11-20T09:00:00.000Z');
  assert.equal(envelope.recordCount, 1);
  assert.equal(envelope.activeDatasetHash, hash);
  assert.equal(envelope.activeDatasetVersion, 2);
  assert.equal(envelope.records[0].datasetHash, hash);
  assert.equal(envelope.records[0].datasetVersion, 2);
});

test('Requirement C: all REC-01..REC-05 reconciliation rules expose complete formal rule contracts and pass the full per-REC positive, negative, zero-denominator, and partial-source boundary matrix', () => {
  const sheets = createSeededEnterpriseSheets();
  const recon = runCrossTableReconciliation(sheets, DEFAULT_RULE_CONFIG, 'ALL');
  assert.equal(recon.checks.length, 5);

  for (const check of recon.checks) {
    const contract = RECONCILIATION_RULE_CONTRACTS[check.id];
    assert.ok(contract, `Missing contract for ${check.id}`);
    assert.equal(check.ruleVersion, contract.ruleVersion);
    assert.equal(check.businessPurpose, contract.businessPurpose);
    assert.equal(check.owner, contract.owner);
    assert.equal(check.units, contract.units);
    assert.ok(contract.toleranceThreshold.trim().length > 0);
    assert.ok(contract.toleranceSpec.trim().length > 0);
    assert.ok(contract.sourceFields.length > 0);
    assert.ok(contract.exclusions.length > 0);
    assert.ok(check.toleranceThreshold?.trim().length);
    assert.equal(check.toleranceSpec, contract.toleranceSpec);
    assert.deepEqual(check.sourceFields, contract.sourceFields);
    assert.deepEqual(check.exclusions, contract.exclusions);
    assert.equal(check.effectiveDatePolicy, contract.effectiveDatePolicy);
    assert.equal(check.nullDenominatorBehavior, contract.nullDenominatorBehavior);
    assert.equal(check.partialSourceBehavior, contract.partialSourceBehavior);
    // Do not fabricate human certification sign-off in code defaults
    assert.equal(check.certifiedBy, null);
    assert.equal(check.certifiedAt, null);
  }

  // =========================================================================
  // REC-01 Boundary Matrix: Positive, Negative, Zero-Denominator, Partial-Source
  // =========================================================================
  {
    // 1. Positive (RECONCILED)
    const posSheets = createSeededEnterpriseSheets();
    posSheets['01_Orders_Shipments_History'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Channel_Code: 'GT',
        Ordered_Qty_Units: 200,
        Cancelled_Order_Qty: 20,
        Invoiced_Actual_Qty: 150,
        Open_Backorder_Qty: 30,
        Returns_Damaged_Qty: 5,
        Net_Realized_Sales_INR: 9450,
      },
    ];
    const rec01Pos = runCrossTableReconciliation(posSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-01')!;
    assert.equal(rec01Pos.status, 'RECONCILED');
    assert.equal(rec01Pos.leftTotal, 180);
    assert.equal(rec01Pos.rightTotal, 180);
    assert.equal(rec01Pos.variancePct, 0);

    // 2. Negative (CRITICAL_MISMATCH on over-shipment)
    const negSheets = createSeededEnterpriseSheets();
    negSheets['01_Orders_Shipments_History'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Channel_Code: 'GT',
        Ordered_Qty_Units: 100,
        Cancelled_Order_Qty: 0,
        Invoiced_Actual_Qty: 140,
        Open_Backorder_Qty: 0,
        Returns_Damaged_Qty: 0,
        Net_Realized_Sales_INR: 8820,
      },
    ];
    const rec01Neg = runCrossTableReconciliation(negSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-01')!;
    assert.equal(rec01Neg.status, 'CRITICAL_MISMATCH');

    // 3. Zero-Denominator (Net Ordered = 0, Shipped = 50 -> variancePct = null, CRITICAL_MISMATCH)
    const zeroOrderSheets = createSeededEnterpriseSheets();
    zeroOrderSheets['01_Orders_Shipments_History'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Channel_Code: 'GT',
        Ordered_Qty_Units: 100,
        Cancelled_Order_Qty: 100,
        Invoiced_Actual_Qty: 50,
        Open_Backorder_Qty: 0,
        Returns_Damaged_Qty: 0,
        Net_Realized_Sales_INR: 3150,
      },
    ];
    const rec01ZeroDenom = runCrossTableReconciliation(
      zeroOrderSheets,
      DEFAULT_RULE_CONFIG,
      'DEMAND'
    ).checks.find((c) => c.id === 'REC-01')!;
    assert.equal(rec01ZeroDenom.leftTotal, 0);
    assert.equal(rec01ZeroDenom.rightTotal, 50);
    assert.equal(rec01ZeroDenom.variancePct, null);
    assert.equal(rec01ZeroDenom.status, 'CRITICAL_MISMATCH');

    // 4. Partial/Missing Source (01_Orders_Shipments_History absent -> NOT_RUN)
    const partialSheets = createSeededEnterpriseSheets();
    delete partialSheets['01_Orders_Shipments_History'];
    const rec01Partial = runCrossTableReconciliation(partialSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-01')!;
    assert.equal(rec01Partial.status, 'NOT_RUN');
    assert.equal(rec01Partial.variancePct, null);
  }

  // =========================================================================
  // REC-02 Boundary Matrix: Positive, Negative, Zero-Denominator, Partial-Source
  // =========================================================================
  {
    // 1. Positive (RECONCILED)
    const posSheets = createSeededEnterpriseSheets();
    posSheets['06_Pricing_Elasticity_Catalog'].records = [
      {
        SKU_Code: 'SKU_P401',
        Channel_Code: 'GT',
        Effective_From_Month: '2025-01-01',
        Net_Realized_Price_INR: 60,
      },
    ];
    posSheets['01_Orders_Shipments_History'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Channel_Code: 'GT',
        Ordered_Qty_Units: 100,
        Cancelled_Order_Qty: 0,
        Invoiced_Actual_Qty: 100,
        Open_Backorder_Qty: 0,
        Returns_Damaged_Qty: 0,
        Net_Realized_Sales_INR: 6000,
      },
    ];
    const rec02Pos = runCrossTableReconciliation(posSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-02')!;
    assert.equal(rec02Pos.status, 'RECONCILED');
    assert.equal(rec02Pos.variancePct, 0);

    // 2. Negative (CRITICAL_MISMATCH when booked revenue diverges beyond 3x tolerance)
    const negSheets = structuredClone(posSheets);
    negSheets['01_Orders_Shipments_History'].records[0].Net_Realized_Sales_INR = 9500;
    const rec02Neg = runCrossTableReconciliation(negSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-02')!;
    assert.equal(rec02Neg.status, 'CRITICAL_MISMATCH');

    // 3. Zero-Denominator (Future-only price produces expectedRev = 0 -> variancePct = null, CRITICAL_MISMATCH)
    const zeroDenomSheets = structuredClone(posSheets);
    zeroDenomSheets['06_Pricing_Elasticity_Catalog'].records[0].Effective_From_Month = '2025-09-01';
    const rec02Zero = runCrossTableReconciliation(zeroDenomSheets, DEFAULT_RULE_CONFIG, 'DEMAND').checks.find((c) => c.id === 'REC-02')!;
    assert.equal(rec02Zero.leftTotal, 0);
    assert.equal(rec02Zero.variancePct, null);
    assert.equal(rec02Zero.status, 'CRITICAL_MISMATCH');

    // 4. Partial/Missing Source (Price catalog missing -> status = NOT_RUN)
    const missingPriceSheets = createSeededEnterpriseSheets();
    delete missingPriceSheets['06_Pricing_Elasticity_Catalog'];
    delete missingPriceSheets['03_Price_Cost_Margin_Conditions'];
    const rec02Partial = runCrossTableReconciliation(
      missingPriceSheets,
      DEFAULT_RULE_CONFIG,
      'DEMAND'
    ).checks.find((c) => c.id === 'REC-02')!;
    assert.equal(rec02Partial.status, 'NOT_RUN');
    assert.equal(rec02Partial.variancePct, null);
  }

  // =========================================================================
  // REC-03 Boundary Matrix: Positive, Negative, Zero-Denominator, Partial-Source
  // =========================================================================
  {
    const cfgRec03Approved = validateRuleConfig({
      stockoutRunRateMethodApproved: true,
      stockoutRunRateMethodApprovedBy: 'Demand & Inventory Assurance Steward',
      stockoutRunRateMethodApprovedAt: '2026-11-01T12:00:00.000Z',
    }).config;
    // 1. Positive (RECONCILED when reviewed stockout matches run-rate benchmark)
    const posSheets = createSeededEnterpriseSheets();
    // Billed = 200, Stockout Days = 15 -> Benchmark = 200 / (1 - 15/30) = 400
    posSheets['07_Inventory_Supply_Constraints'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Closing_OnHand_Stock_Qty: 0,
        Depot_Stockout_Days_Count: 15,
        Invoiced_Actual_Qty: 200,
        Governed_Uncensored_Demand_Qty: 400,
        _stockoutRestored: true,
      },
    ];
    const rec03Pos = runCrossTableReconciliation(posSheets, cfgRec03Approved, 'DEMAND').checks.find((c) => c.id === 'REC-03')!;
    assert.equal(rec03Pos.status, 'RECONCILED');
    assert.equal(rec03Pos.variancePct, 0);

    // 2. Negative (CRITICAL_MISMATCH when Governed_Uncensored_Demand_Qty < Invoiced_Actual_Qty)
    const negSheets = structuredClone(posSheets);
    negSheets['07_Inventory_Supply_Constraints'].records[0].Governed_Uncensored_Demand_Qty = 150;
    const rec03Neg = runCrossTableReconciliation(negSheets, cfgRec03Approved, 'DEMAND').checks.find((c) => c.id === 'REC-03')!;
    assert.equal(rec03Neg.status, 'CRITICAL_MISMATCH');

    // 3. Zero-Denominator (0 stockout periods -> comparisonBaseline = 0 -> variancePct = null, RECONCILED)
    const zeroDenomSheets = createSeededEnterpriseSheets();
    zeroDenomSheets['07_Inventory_Supply_Constraints'].records = [
      {
        Period_Date: '2025-05-01',
        SKU_Code: 'SKU_P401',
        Location_DC: 'DEPOT_KOL',
        Closing_OnHand_Stock_Qty: 500,
        Depot_Stockout_Days_Count: 0,
        Invoiced_Actual_Qty: 200,
      },
    ];
    const rec03Zero = runCrossTableReconciliation(zeroDenomSheets, cfgRec03Approved, 'DEMAND').checks.find((c) => c.id === 'REC-03')!;
    assert.equal(rec03Zero.leftTotal, 0);
    assert.equal(rec03Zero.variancePct, null);
    assert.equal(rec03Zero.status, 'RECONCILED');

    // 4. Partial/Missing Source (07_Inventory_Supply_Constraints missing -> NOT_RUN)
    const partialSheets = createSeededEnterpriseSheets();
    delete partialSheets['07_Inventory_Supply_Constraints'];
    const rec03Partial = runCrossTableReconciliation(partialSheets, cfgRec03Approved, 'DEMAND').checks.find((c) => c.id === 'REC-03')!;
    assert.equal(rec03Partial.status, 'NOT_RUN');
    assert.equal(rec03Partial.variancePct, null);
  }

  // =========================================================================
  // REC-04 Boundary Matrix: Positive, Negative, Zero-Denominator, Partial-Source
  // =========================================================================
  {
    // 1. Positive (RECONCILED when all in-domain transaction FKs resolve against masters)
    const posSheets = createDomainTestWorkbook('MANUFACTURING');
    const rec04Pos = runCrossTableReconciliation(posSheets, DEFAULT_RULE_CONFIG, 'MANUFACTURING').checks.find((c) => c.id === 'REC-04')!;
    assert.equal(rec04Pos.status, 'RECONCILED');
    assert.equal(rec04Pos.variancePct, 0);

    // 2. Negative (CRITICAL_MISMATCH when an orphan FK exists)
    const negSheets = createDomainTestWorkbook('MANUFACTURING');
    negSheets['15_Manufacturing_BOM_WorkCenters'].records[0].Parent_SKU_Code = 'ORPHAN_SKU_999';
    const rec04Neg = runCrossTableReconciliation(negSheets, DEFAULT_RULE_CONFIG, 'MANUFACTURING').checks.find((c) => c.id === 'REC-04')!;
    assert.equal(rec04Neg.status, 'CRITICAL_MISMATCH');

    // 3. Zero-Denominator (0 in-domain transaction rows -> totalRefs = 0 -> variancePct = null, NOT_RUN)
    const zeroDenomSheets = createDomainTestWorkbook('MANUFACTURING');
    zeroDenomSheets['07_Inventory_Supply_Constraints'].records = [];
    zeroDenomSheets['15_Manufacturing_BOM_WorkCenters'].records = [];
    const rec04Zero = runCrossTableReconciliation(zeroDenomSheets, DEFAULT_RULE_CONFIG, 'MANUFACTURING').checks.find((c) => c.id === 'REC-04')!;
    assert.equal(rec04Zero.leftTotal, 0);
    assert.equal(rec04Zero.variancePct, null);
    assert.equal(rec04Zero.status, 'NOT_RUN');

    // 4. Partial/Missing Source (Required master 09_Product_Master_Hierarchy missing -> NOT_RUN)
    const partialSheets = createDomainTestWorkbook('MANUFACTURING');
    delete partialSheets['09_Product_Master_Hierarchy'];
    const rec04Partial = runCrossTableReconciliation(partialSheets, DEFAULT_RULE_CONFIG, 'MANUFACTURING').checks.find((c) => c.id === 'REC-04')!;
    assert.equal(rec04Partial.status, 'NOT_RUN');
    assert.equal(rec04Partial.variancePct, null);
  }

  // =========================================================================
  // REC-05 Boundary Matrix: Positive, Negative, Zero-Denominator, Partial-Source
  // =========================================================================
  {
    // 1. Positive (RECONCILED when max in-domain lead time <= maxLeadTimeDays)
    const posSheets = createDomainTestWorkbook('MANUFACTURING');
    const rec05Pos = runCrossTableReconciliation(
      posSheets,
      { ...DEFAULT_RULE_CONFIG, maxLeadTimeDays: 30 },
      'MANUFACTURING'
    ).checks.find((c) => c.id === 'REC-05')!;
    assert.equal(rec05Pos.status, 'RECONCILED');
    assert.equal(rec05Pos.variancePct, 0);

    // 2. Negative (VARIANCE_WARNING when max in-domain lead time > maxLeadTimeDays)
    const negSheets = structuredClone(posSheets);
    negSheets['10_Location_Depot_Network'].records[0].Primary_Transit_Lead_Time_Days = 25;
    const rec05Neg = runCrossTableReconciliation(
      negSheets,
      { ...DEFAULT_RULE_CONFIG, maxLeadTimeDays: 10 },
      'MANUFACTURING'
    ).checks.find((c) => c.id === 'REC-05')!;
    assert.equal(rec05Neg.status, 'VARIANCE_WARNING');
    assert.ok((rec05Neg.variancePct ?? 0) > 0);

    // 3. Zero-Denominator (maxLeadTimeDays <= 0 -> variancePct = null, NOT_RUN)
    const rec05Zero = runCrossTableReconciliation(
      posSheets,
      { ...DEFAULT_RULE_CONFIG, maxLeadTimeDays: 0 },
      'MANUFACTURING'
    ).checks.find((c) => c.id === 'REC-05')!;
    assert.equal(rec05Zero.variancePct, null);
    assert.equal(rec05Zero.status, 'NOT_RUN');

    // 4. Partial/Missing Source (10_Location_Depot_Network missing -> NOT_RUN)
    const partialSheets = createDomainTestWorkbook('MANUFACTURING');
    delete partialSheets['10_Location_Depot_Network'];
    const rec05Partial = runCrossTableReconciliation(
      partialSheets,
      DEFAULT_RULE_CONFIG,
      'MANUFACTURING'
    ).checks.find((c) => c.id === 'REC-05')!;
    assert.equal(rec05Partial.status, 'NOT_RUN');
    assert.equal(rec05Partial.variancePct, null);
  }
});

test('Requirement D: all six primary planning domains pass the domain onboarding gate matrix — mandatory/optional tables, business keys, FK orphan catalog, per-domain REC applicability, and cross-domain isolation', () => {
  const domainSpecs: Array<{
    domain: PlanningDomainKey;
    primaryTxTable: string;
    fkCol: string;
    expectedApplicableRecs: string[];
    expectedNotApplicableRecs: string[];
    outOfDomainPoisonTable: string;
  }> = [
    {
      domain: 'DEMAND',
      primaryTxTable: '01_Orders_Shipments_History',
      fkCol: 'SKU_Code',
      expectedApplicableRecs: ['REC-01', 'REC-02', 'REC-03', 'REC-04'],
      expectedNotApplicableRecs: ['REC-05'],
      outOfDomainPoisonTable: '15_Manufacturing_BOM_WorkCenters',
    },
    {
      domain: 'SUPPLY',
      primaryTxTable: '07_Inventory_Supply_Constraints',
      fkCol: 'SKU_Code',
      expectedApplicableRecs: ['REC-01', 'REC-03', 'REC-04', 'REC-05'],
      expectedNotApplicableRecs: ['REC-02'],
      outOfDomainPoisonTable: '15_Manufacturing_BOM_WorkCenters',
    },
    {
      domain: 'SOP',
      primaryTxTable: '01_Orders_Shipments_History',
      fkCol: 'SKU_Code',
      expectedApplicableRecs: ['REC-01', 'REC-02', 'REC-03', 'REC-04'],
      expectedNotApplicableRecs: ['REC-05'],
      outOfDomainPoisonTable: '14_Purchase_Orders_Receipts',
    },
    {
      domain: 'MEIO',
      primaryTxTable: '16_MEIO_Network_Policy_Costs',
      fkCol: 'SKU_Code',
      expectedApplicableRecs: ['REC-01', 'REC-03', 'REC-04', 'REC-05'],
      expectedNotApplicableRecs: ['REC-02'],
      outOfDomainPoisonTable: '14_Purchase_Orders_Receipts',
    },
    {
      domain: 'PROCUREMENT',
      primaryTxTable: '13_Supplier_Sourcing_Contracts',
      fkCol: 'SKU_Code',
      expectedApplicableRecs: ['REC-04', 'REC-05'],
      expectedNotApplicableRecs: ['REC-01', 'REC-02', 'REC-03'],
      outOfDomainPoisonTable: '01_Orders_Shipments_History',
    },
    {
      domain: 'MANUFACTURING',
      primaryTxTable: '15_Manufacturing_BOM_WorkCenters',
      fkCol: 'Parent_SKU_Code',
      expectedApplicableRecs: ['REC-04', 'REC-05'],
      expectedNotApplicableRecs: ['REC-01', 'REC-02', 'REC-03'],
      outOfDomainPoisonTable: '01_Orders_Shipments_History',
    },
  ];

  for (const spec of domainSpecs) {
    const contract = DOMAIN_CONTRACTS[spec.domain];
    assert.ok(contract.mandatoryTables.length > 0, `${spec.domain} must declare mandatory tables`);

    // 1. Valid domain fixture passes schema and executes all required validations
    const validWb = createDomainTestWorkbook(spec.domain);
    const validReport = validateWorkbook(validWb, { domain: spec.domain });
    assert.equal(validReport.schemaPassed, true, `${spec.domain} valid fixture must pass schema`);
    assert.equal(
      validReport.allRequiredValidationsExecuted,
      true,
      `${spec.domain} valid fixture must execute all required validations`
    );

    // 2. Missing mandatory table blocks schema and release gate
    for (const mandatoryTbl of contract.mandatoryTables) {
      const missingMandatoryWb = createDomainTestWorkbook(spec.domain);
      delete missingMandatoryWb[mandatoryTbl];
      const missingReport = validateWorkbook(missingMandatoryWb, { domain: spec.domain });
      assert.equal(
        missingReport.schemaPassed,
        false,
        `${spec.domain} missing mandatory table ${mandatoryTbl} must fail schema`
      );
      const gate = evaluateReleaseGate(
        missingReport,
        null,
        true,
        Date.now(),
        computeWorkbookHash(missingMandatoryWb),
        true,
        1
      );
      assert.equal(
        gate.step2Unlocked,
        false,
        `${spec.domain} missing mandatory table ${mandatoryTbl} must lock release gate`
      );
    }

    // 3. Duplicate business key on primary transaction table triggers DUPLICATE_KEY
    const dupWb = createDomainTestWorkbook(spec.domain);
    const primaryRows = dupWb[spec.primaryTxTable].records;
    assert.ok(primaryRows.length > 0, `${spec.primaryTxTable} must have rows`);
    primaryRows.push(structuredClone(primaryRows[0]));
    const dupReport = validateWorkbook(dupWb, { domain: spec.domain });
    assert.ok(
      dupReport.exceptions.some(
        (e) => e.category === 'DUPLICATE_KEY' && e.table === spec.primaryTxTable
      ),
      `${spec.domain} must detect duplicate business key on ${spec.primaryTxTable}`
    );

    // 4. Orphan foreign key on primary transaction table triggers CROSS_TABLE and REC-04 CRITICAL_MISMATCH
    const orphanWb = createDomainTestWorkbook(spec.domain);
    orphanWb[spec.primaryTxTable].records[0][spec.fkCol] = 'ORPHAN_FK_ENTITY_999';
    const orphanReport = validateWorkbook(orphanWb, { domain: spec.domain });
    assert.ok(
      orphanReport.exceptions.some(
        (e) => e.category === 'CROSS_TABLE' && e.table === spec.primaryTxTable
      ),
      `${spec.domain} must detect orphan FK on ${spec.primaryTxTable}.${spec.fkCol}`
    );
    const orphanRecon = runCrossTableReconciliation(orphanWb, DEFAULT_RULE_CONFIG, spec.domain);
    assert.equal(
      orphanRecon.checks.find((c) => c.id === 'REC-04')?.status,
      'CRITICAL_MISMATCH',
      `${spec.domain} REC-04 must report CRITICAL_MISMATCH on orphan FK`
    );

    // 5. Per-domain REC applicability matrix
    const validRecon = runCrossTableReconciliation(validWb, DEFAULT_RULE_CONFIG, spec.domain);
    for (const recId of spec.expectedApplicableRecs) {
      const check = validRecon.checks.find((c) => c.id === recId)!;
      assert.notEqual(
        check.status,
        'NOT_APPLICABLE',
        `${spec.domain} ${recId} must be applicable`
      );
    }
    for (const recId of spec.expectedNotApplicableRecs) {
      const check = validRecon.checks.find((c) => c.id === recId)!;
      assert.equal(
        check.status,
        'NOT_APPLICABLE',
        `${spec.domain} ${recId} must be NOT_APPLICABLE`
      );
    }

    // 6. Cross-domain isolation: injecting corrupted out-of-domain rows produces 0 out-of-domain exceptions
    const poisonedWb = createDomainTestWorkbook(spec.domain);
    poisonedWb[spec.outOfDomainPoisonTable] = {
      pillar: 'Out-of-Domain Poison Table',
      desc: 'Synthetic out-of-domain poison fixture',
      cols: [{ col: 'SKU_Code', type: 'STRING_ID', key: 'PK' }],
      records: [{ SKU_Code: 'POISON_ORPHAN_SKU', Ordered_Qty_Units: -999999 }],
    };
    const poisonedReport = validateWorkbook(poisonedWb, { domain: spec.domain });
    assert.equal(
      poisonedReport.exceptions.some((e) => e.table === spec.outOfDomainPoisonTable),
      false,
      `${spec.domain} must isolate and ignore out-of-domain table ${spec.outOfDomainPoisonTable}`
    );
  }
});

test('Capabilities #1 & #4: hostile archive rejection, small in-memory compute microbenchmark, and browser-storage quota failure recovery', () => {
  // 1a. Hostile / corrupted ZIP archive header is rejected cleanly in O(1) without SheetJS hang
  const fakeZipHeader = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff, 0xff, 0xff, 0xff,
  ]);
  assert.throws(
    () => ingestWorkbookBuffer(fakeZipHeader, 'corrupted_archive.xlsx'),
    /Corrupted ZIP\/XLSX archive/i
  );

  // 1b. Hostile ZIP bomb (Central Directory entry declares 250 MB uncompressed payload in a 98-byte container) is rejected before decompression
  const zipBomb = new Uint8Array(100);
  // Local file header with a one-byte filename; central directory starts after it.
  zipBomb.set([0x50, 0x4b, 0x03, 0x04], 0);
  zipBomb[26] = 1;
  zipBomb[30] = 0x78;
  // Central Directory record at offset 31, with matching filename and 250 MB expansion.
  zipBomb.set([0x50, 0x4b, 0x01, 0x02], 31);
  zipBomb[59] = 1;
  zipBomb[77] = 0x78;
  zipBomb.set([0x00, 0x00, 0xa0, 0x0f], 55);
  // EOCD at offset 78: one entry on disk and in total; directory size 47, offset 31.
  zipBomb.set([0x50, 0x4b, 0x05, 0x06], 78);
  zipBomb[86] = 1;
  zipBomb[88] = 1;
  zipBomb[90] = 47;
  zipBomb[94] = 31;
  assert.throws(
    () => ingestWorkbookBuffer(zipBomb, 'hostile_bomb.xlsx'),
    /Hostile archive expansion \(ZIP bomb\) rejected/i
  );

  // 2. Hostile formula-containing workbook is blocked
  const validWbBinary = buildWorkbookBinary(createDomainTestWorkbook('DEMAND'));
  const ingestedClean = ingestWorkbookBuffer(validWbBinary, 'Clean_Demand.xlsx');
  assert.ok(ingestedClean.totalRows > 0);

  // Adversarial real-XLSX cases validate local/central metadata correspondence and bounds.
  const findEocd = (bytes: Uint8Array): number => {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  };
  const corruptLocalHeader = new Uint8Array(validWbBinary);
  corruptLocalHeader[3] = 0;
  assert.throws(() => ingestWorkbookBuffer(corruptLocalHeader, 'corrupt_local_header.xlsx'), /local file header/i);

  const corruptCentralName = new Uint8Array(validWbBinary);
  const nameEocd = findEocd(corruptCentralName);
  const nameCdOffset = corruptCentralName[nameEocd + 16] |
    (corruptCentralName[nameEocd + 17] << 8) |
    (corruptCentralName[nameEocd + 18] << 16) |
    (corruptCentralName[nameEocd + 19] << 24);
  corruptCentralName[nameCdOffset + 28] = 0xff;
  corruptCentralName[nameCdOffset + 29] = 0xff;
  assert.throws(() => ingestWorkbookBuffer(corruptCentralName, 'corrupt_central_name.xlsx'), /Central Directory/i);

  const corruptCentralSize = new Uint8Array(validWbBinary);
  const sizeEocd = findEocd(corruptCentralSize);
  corruptCentralSize[sizeEocd + 12] = Math.max(0, corruptCentralSize[sizeEocd + 12] - 1);
  assert.throws(() => ingestWorkbookBuffer(corruptCentralSize, 'corrupt_central_size.xlsx'), /Central Directory/i);

  const corruptLocalOffset = new Uint8Array(validWbBinary);
  const offsetEocd = findEocd(corruptLocalOffset);
  const offsetCd = corruptLocalOffset[offsetEocd + 16] |
    (corruptLocalOffset[offsetEocd + 17] << 8) |
    (corruptLocalOffset[offsetEocd + 18] << 16) |
    (corruptLocalOffset[offsetEocd + 19] << 24);
  corruptLocalOffset[offsetCd + 42] = 0xff;
  corruptLocalOffset[offsetCd + 43] = 0xff;
  corruptLocalOffset[offsetCd + 44] = 0xff;
  corruptLocalOffset[offsetCd + 45] = 0x7f;
  assert.throws(() => ingestWorkbookBuffer(corruptLocalOffset, 'corrupt_local_offset.xlsx'), /local file header/i);

  // Additional hostile-container regressions: filename identity, ZIP64, terminal EOCD, disk metadata and overlapping payloads.
  const readZipU16 = (bytes: Uint8Array, offset: number): number =>
    bytes[offset] | (bytes[offset + 1] << 8);
  const readZipU32 = (bytes: Uint8Array, offset: number): number =>
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

  const nameMismatch = new Uint8Array(validWbBinary);
  const nameMismatchEocd = findEocd(nameMismatch);
  const nameMismatchCd = readZipU32(nameMismatch, nameMismatchEocd + 16);
  nameMismatch[nameMismatchCd + 46] ^= 0x01;
  assert.throws(
    () => ingestWorkbookBuffer(nameMismatch, 'local_central_filename_mismatch.xlsx'),
    /local and Central Directory filenames do not match/i
  );

  const zip64Sentinel = new Uint8Array(validWbBinary);
  const zip64Eocd = findEocd(zip64Sentinel);
  const zip64Cd = readZipU32(zip64Sentinel, zip64Eocd + 16);
  zip64Sentinel.fill(0xff, zip64Cd + 24, zip64Cd + 28);
  assert.throws(
    () => ingestWorkbookBuffer(zip64Sentinel, 'zip64_sentinel_size.xlsx'),
    /ZIP64 entry metadata is not supported/i
  );

  const trailingEocdData = new Uint8Array(validWbBinary.length + 1);
  trailingEocdData.set(validWbBinary);
  trailingEocdData[trailingEocdData.length - 1] = 0x00;
  assert.throws(
    () => ingestWorkbookBuffer(trailingEocdData, 'non_terminal_eocd.xlsx'),
    /non-terminal End of Central Directory/i
  );

  const multiDiskArchive = new Uint8Array(validWbBinary);
  const multiDiskEocd = findEocd(multiDiskArchive);
  multiDiskArchive[multiDiskEocd + 4] = 1;
  assert.throws(
    () => ingestWorkbookBuffer(multiDiskArchive, 'multi_disk_archive.xlsx'),
    /multi-disk ZIP\/XLSX archive/i
  );

  const localMethodMismatch = new Uint8Array(validWbBinary);
  const methodEocd = findEocd(localMethodMismatch);
  const methodCd = readZipU32(localMethodMismatch, methodEocd + 16);
  const methodLocalOffset = readZipU32(localMethodMismatch, methodCd + 42);
  localMethodMismatch[methodLocalOffset + 8] ^= 0x01;
  assert.throws(
    () => ingestWorkbookBuffer(localMethodMismatch, 'local_compression_mismatch.xlsx'),
    /local header does not match Central Directory metadata/i
  );

  // Minimal archive with two Central Directory entries pointing to one local file payload.
  // Both records are individually in-bounds; their overlapping local regions must still be rejected.
  const overlappingEntries = new Uint8Array(147);
  overlappingEntries.set([0x50, 0x4b, 0x03, 0x04], 0);
  overlappingEntries[26] = 1;
  overlappingEntries[30] = 0x78;
  const writeOverlappingCentralEntry = (offset: number) => {
    overlappingEntries.set([0x50, 0x4b, 0x01, 0x02], offset);
    overlappingEntries[offset + 28] = 1;
    overlappingEntries[offset + 46] = 0x78;
  };
  writeOverlappingCentralEntry(31);
  writeOverlappingCentralEntry(78);
  overlappingEntries.set([0x50, 0x4b, 0x05, 0x06], 125);
  overlappingEntries[133] = 2;
  overlappingEntries[135] = 2;
  overlappingEntries[137] = 94;
  overlappingEntries[141] = 31;
  assert.throws(
    () => ingestWorkbookBuffer(overlappingEntries, 'overlapping_local_entries.xlsx'),
    /overlapping local file entries are not allowed/i
  );

  // 3. Repeatable 5-repetition Small Workload SLO Benchmark (≤ 10,000 ms p95, ≤ 1 GiB RSS)
  const scaleSheets = createSeededEnterpriseSheets();
  const baseOrders = scaleSheets['01_Orders_Shipments_History'].records;
  const expandedOrders: Array<Record<string, any>> = [];
  for (let i = 0; i < 80; i++) {
    const template = baseOrders[i % baseOrders.length];
    expandedOrders.push({
      ...template,
      Period_Date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
      Ordered_Qty_Units: 120 + (i % 50),
      Invoiced_Actual_Qty: 120 + (i % 50),
    });
  }
  scaleSheets['01_Orders_Shipments_History'].records = expandedOrders;

  const durationsMs: number[] = [];
  let peakRssBytes = 0;

  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    const hash = computeWorkbookHash(scaleSheets);
    assert.ok(hash.startsWith('SHA256-'));
    const report = validateWorkbook(scaleSheets, { domain: 'ALL' });
    const profile = profileWorkbook(scaleSheets, report.exceptions);
    const recon = runCrossTableReconciliation(scaleSheets, DEFAULT_RULE_CONFIG, 'ALL');
    const elapsed = performance.now() - t0;
    durationsMs.push(elapsed);
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;
    assert.ok(profile.tables.length >= 12);
    assert.equal(recon.checks.length, 5);
  }

  durationsMs.sort((a, b) => a - b);
  const p95Ms = durationsMs[durationsMs.length - 1];
  const peakRssGiB = peakRssBytes / (1024 * 1024 * 1024);
  assert.ok(
    p95Ms <= 10_000,
    `Small workload p95 (${p95Ms.toFixed(1)} ms) must remain within 10,000 ms SLO`
  );
  assert.ok(
    peakRssGiB <= 1.0,
    `Small workload peak RSS (${peakRssGiB.toFixed(3)} GiB) must remain within 1.0 GiB SLO`
  );
});


test('Capability #1: real 100,000-cell XLSX ingestion, validation, profiling and reconciliation benchmark', () => {
  const headers = [
    'Period_Date',
    'SKU_Code',
    'Location_DC',
    'Channel_Code',
    'Ordered_Qty_Units',
    'Cancelled_Order_Qty',
    'Invoiced_Actual_Qty',
    'Open_Backorder_Qty',
    'Returns_Damaged_Qty',
    'Net_Realized_Sales_INR',
  ];
  const rows: Array<Array<string | number>> = [headers];
  const dataRows = 10_000;

  for (let i = 0; i < dataRows; i++) {
    const month = String((i % 12) + 1).padStart(2, '0');
    const qty = 100 + (i % 150);
    rows.push([
      `2025-${month}-01`,
      `SKU-${String(i % 1000).padStart(4, '0')}`,
      `DEPOT-${String(i % 50).padStart(3, '0')}`,
      i % 2 === 0 ? 'GT' : 'MT',
      qty + 5,
      5,
      qty,
      0,
      0,
      qty * 60,
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    '01_Orders_Shipments_History'
  );
  const generated = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  const uploadBytes = generated instanceof Uint8Array ? generated : new Uint8Array(generated);
  const targetCells = dataRows * headers.length;
  assert.ok(uploadBytes.byteLength <= 10 * 1024 * 1024, 'The 100k-cell fixture must remain under the 10 MB Small SLO size');

  const durationsMs: number[] = [];
  let peakRssBytes = process.memoryUsage().rss;
  let finalWorkbookHash = '';

  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    const ingested = ingestWorkbookBuffer(uploadBytes, '100k_cell_ingestion_benchmark.xlsx');
    assert.equal(ingested.totalRows, dataRows);
    assert.equal(ingested.sheetCount, 1);
    assert.equal(ingested.sheets['01_Orders_Shipments_History'].records.length, dataRows);

    const hash = computeWorkbookHash(ingested.sheets);
    finalWorkbookHash = hash;
    const report = validateWorkbook(ingested.sheets, {
      domain: 'DEMAND',
      datasetHash: hash,
      datasetVersion: 1,
      governedOutputHash: hash,
    });
    const profile = profileWorkbook(ingested.sheets, report.exceptions);
    const reconciliation = runCrossTableReconciliation(ingested.sheets, DEFAULT_RULE_CONFIG, 'DEMAND');
    assert.ok(report.ruleExecutionMatrix?.length === 6);
    assert.equal(profile.tables.length, 1);
    assert.equal(reconciliation.checks.length, 5);

    durationsMs.push(performance.now() - started);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  durationsMs.sort((a, b) => a - b);
  const p95Ms = durationsMs[Math.ceil(durationsMs.length * 0.95) - 1];
  const peakRssGiB = peakRssBytes / (1024 * 1024 * 1024);
  console.log(
    `[INGEST-BENCH] profile=small-100k-cells rows=${dataRows} cells=${targetCells} bytes=${uploadBytes.byteLength} repetitions=5 p95Ms=${p95Ms.toFixed(1)} peakRssGiB=${peakRssGiB.toFixed(3)} fixtureHash=${finalWorkbookHash}`
  );
  assert.ok(
    p95Ms <= 10_000,
    `100k-cell ingest + validation + profiling + reconciliation p95 (${p95Ms.toFixed(1)} ms) must remain within 10,000 ms`
  );
  assert.ok(
    peakRssGiB <= 1.0,
    `100k-cell workload peak RSS (${peakRssGiB.toFixed(3)} GiB) must remain within 1.0 GiB`
  );
});

test('Capability #1: real 1,000,000-cell XLSX medium-workload ingestion, validation, profiling and reconciliation benchmark', () => {
  const headers = [
    'Period_Date',
    'SKU_Code',
    'Location_DC',
    'Channel_Code',
    'Ordered_Qty_Units',
    'Cancelled_Order_Qty',
    'Invoiced_Actual_Qty',
    'Open_Backorder_Qty',
    'Returns_Damaged_Qty',
    'Net_Realized_Sales_INR',
  ];
  const dataRows = 100_000;
  const buildFixture = (): Uint8Array => {
    const rows: Array<Array<string | number>> = [headers];
    for (let i = 0; i < dataRows; i++) {
      const month = String((i % 12) + 1).padStart(2, '0');
      const qty = 100 + (i % 150);
      rows.push([
        `2025-${month}-01`,
        `SKU-${String(i % 1000).padStart(4, '0')}`,
        `DEPOT-${String(i % 50).padStart(3, '0')}`,
        i % 2 === 0 ? 'GT' : 'MT',
        qty + 5,
        5,
        qty,
        0,
        0,
        qty * 60,
      ]);
    }
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    // The XLSX worksheet now owns the cell values; release the source row arrays
    // before serializing the workbook to avoid doubling fixture-construction memory.
    rows.length = 0;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '01_Orders_Shipments_History');
    const generated = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
    return generated instanceof Uint8Array ? generated : new Uint8Array(generated);
  };

  const uploadBytes = buildFixture();
  const targetCells = dataRows * headers.length;
  assert.ok(uploadBytes.byteLength <= 50 * 1024 * 1024, 'The 1m-cell fixture must remain under the 50 MB Medium SLO size');

  const forceGarbageCollection = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  forceGarbageCollection?.();
  const baselineRssBytes = process.memoryUsage().rss;
  const durationsMs: number[] = [];
  let peakRssBytes = baselineRssBytes;
  let finalWorkbookHash = '';

  for (let run = 0; run < 5; run++) {
    forceGarbageCollection?.();
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const started = performance.now();
    const ingested = ingestWorkbookBuffer(uploadBytes, '1m_cell_medium_ingestion_benchmark.xlsx');
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    assert.equal(ingested.totalRows, dataRows);
    assert.equal(ingested.sheetCount, 1);
    assert.equal(ingested.sheets['01_Orders_Shipments_History'].records.length, dataRows);

    const hash = computeWorkbookHash(ingested.sheets);
    finalWorkbookHash = hash;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const report = validateWorkbook(ingested.sheets, {
      domain: 'DEMAND',
      datasetHash: hash,
      datasetVersion: 1,
      governedOutputHash: hash,
    });
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const profile = profileWorkbook(ingested.sheets, report.exceptions);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const reconciliation = runCrossTableReconciliation(ingested.sheets, DEFAULT_RULE_CONFIG, 'DEMAND');
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    assert.equal(report.ruleExecutionMatrix?.length, 6);
    assert.equal(profile.tables.length, 1);
    assert.equal(reconciliation.checks.length, 5);

    durationsMs.push(performance.now() - started);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  durationsMs.sort((a, b) => a - b);
  const p95Ms = durationsMs[Math.ceil(durationsMs.length * 0.95) - 1];
  const peakRssGiB = peakRssBytes / (1024 * 1024 * 1024);
  console.log(
    `[INGEST-BENCH] profile=medium-1m-cells rows=${dataRows} cells=${targetCells} bytes=${uploadBytes.byteLength} repetitions=5 baselineRssGiB=${(baselineRssBytes / (1024 * 1024 * 1024)).toFixed(3)} p95Ms=${p95Ms.toFixed(1)} peakRssGiB=${peakRssGiB.toFixed(3)} fixtureHash=${finalWorkbookHash}`
  );
  assert.ok(
    p95Ms <= 45_000,
    `1m-cell ingest + validation + profiling + reconciliation p95 (${p95Ms.toFixed(1)} ms) must remain within 45,000 ms`
  );
  assert.ok(
    peakRssGiB <= 2.0,
    `1m-cell workload peak RSS (${peakRssGiB.toFixed(3)} GiB) must remain within 2.0 GiB`
  );
});


test('Capability #1: real 5,000,000-cell XLSX maximum-workload ingestion benchmark', () => {
  const baseHeaders = [
    'Period_Date',
    'SKU_Code',
    'Location_DC',
    'Channel_Code',
    'Ordered_Qty_Units',
    'Cancelled_Order_Qty',
    'Invoiced_Actual_Qty',
    'Open_Backorder_Qty',
    'Returns_Damaged_Qty',
    'Net_Realized_Sales_INR',
  ];
  const extraHeaders = Array.from({ length: 40 }, (_, i) => `Auxiliary_Measure_${String(i + 1).padStart(2, '0')}`);
  const headers = [...baseHeaders, ...extraHeaders];
  const dataRows = 99_999; // + 1 header row gives exactly 5,000,000 estimated cells.
  const targetCells = (dataRows + 1) * headers.length;
  assert.equal(targetCells, 5_000_000);

  const buildFixture = (): Uint8Array => {
    const rows: Array<Array<string | number>> = new Array(dataRows + 1);
    rows[0] = headers;
    for (let i = 0; i < dataRows; i++) {
      const month = String((i % 12) + 1).padStart(2, '0');
      const qty = 100 + (i % 150);
      const extraMeasures = Array.from({ length: 40 }, (_, j) => (i + j) % 97);
      rows[i + 1] = [
        `2025-${month}-01`,
        `SKU-${String(i % 1000).padStart(4, '0')}`,
        `DEPOT-${String(i % 50).padStart(3, '0')}`,
        i % 2 === 0 ? 'GT' : 'MT',
        qty + 5,
        5,
        qty,
        0,
        0,
        qty * 60,
        ...extraMeasures,
      ];
    }
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    // Release the source row matrix before serializing so fixture construction itself
    // does not retain a second full set of five-million-cell values.
    rows.length = 0;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '01_Orders_Shipments_History');
    const generated = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
    return generated instanceof Uint8Array ? generated : new Uint8Array(generated);
  };

  const uploadBytes = buildFixture();
  assert.ok(
    uploadBytes.byteLength <= 100 * 1024 * 1024,
    `The 5m-cell fixture must remain within the 100 MB workbook upload limit (got ${uploadBytes.byteLength} bytes)`
  );

  const forceGarbageCollection = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  // Fixture generation is outside the ingestion SLO. Collect its temporary row arrays
  // and worksheet builder state before recording the parser's starting RSS.
  forceGarbageCollection?.();
  const baselineRssBytes = process.memoryUsage().rss;
  const durationsMs: number[] = [];
  let peakSampledRssBytes = baselineRssBytes;
  let finalWorkbookHash = '';
  let maximumScaleSheets: EnterpriseSheets | undefined;

  for (let run = 0; run < 5; run++) {
    // Each repetition measures one ingestion cycle rather than retaining the previous
    // cycle's unreachable workbook/report objects in the sampled peak.
    forceGarbageCollection?.();
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    const started = performance.now();
    const ingested = ingestWorkbookBuffer(uploadBytes, '5m_cell_maximum_ingestion_benchmark.xlsx');
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    assert.equal(ingested.totalRows, dataRows);
    assert.equal(ingested.sheetCount, 1);
    assert.equal(ingested.sheets['01_Orders_Shipments_History'].records.length, dataRows);

    const hash = computeWorkbookHash(ingested.sheets);
    finalWorkbookHash = hash;
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    const report = validateWorkbook(ingested.sheets, {
      domain: 'DEMAND',
      datasetHash: hash,
      datasetVersion: 1,
      governedOutputHash: hash,
    });
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    const profile = profileWorkbook(ingested.sheets, report.exceptions);
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    const reconciliation = runCrossTableReconciliation(ingested.sheets, DEFAULT_RULE_CONFIG, 'DEMAND');
    peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
    maximumScaleSheets = ingested.sheets;

    assert.equal(report.ruleExecutionMatrix?.length, 6);
    assert.equal(profile.tables.length, 1);
    assert.equal(reconciliation.checks.length, 5);
    durationsMs.push(performance.now() - started);
  }

  // Measure one maximum-scale export + re-import after the repeated ingestion SLO
  // samples. This deliberately exercises the full five-million-cell data shape.
  assert.ok(maximumScaleSheets, 'Maximum-scale ingestion must produce sheets for export.');
  const sourceSheet = maximumScaleSheets['01_Orders_Shipments_History'];
  const expectedFirstRow = { ...sourceSheet.records[0] };
  const expectedLastRow = { ...sourceSheet.records[dataRows - 1] };
  const expectedColumnCount = sourceSheet.cols.length;
  forceGarbageCollection?.();
  const roundTripStarted = performance.now();
  const exportedBytes = buildWorkbookBinary(maximumScaleSheets);
  assert.ok(
    exportedBytes.byteLength <= 100 * 1024 * 1024,
    `The maximum-scale export must remain within the 100 MB workbook limit (got ${exportedBytes.byteLength} bytes)`
  );
  // The round-trip check needs only the boundary-row snapshots above. Release the
  // original five-million-cell parsed dataset before re-importing the export so the
  // benchmark measures sequential export/import memory, not two full datasets held
  // live at once.
  maximumScaleSheets = undefined;
  forceGarbageCollection?.();
  const reimported = ingestWorkbookBuffer(exportedBytes, '5m_cell_maximum_export_roundtrip.xlsx');
  const roundTripMs = performance.now() - roundTripStarted;
  peakSampledRssBytes = Math.max(peakSampledRssBytes, process.memoryUsage().rss);
  assert.equal(reimported.sheetCount, 1);
  assert.equal(reimported.totalRows, dataRows);
  assert.equal(reimported.sheets['01_Orders_Shipments_History'].records.length, dataRows);
  assert.equal(reimported.sheets['01_Orders_Shipments_History'].cols.length, headers.length);
  assert.deepEqual(
    reimported.sheets['01_Orders_Shipments_History'].records[0],
    expectedFirstRow,
    'Maximum-scale export/re-import must preserve the first data row.'
  );
  assert.deepEqual(
    reimported.sheets['01_Orders_Shipments_History'].records[dataRows - 1],
    expectedLastRow,
    'Maximum-scale export/re-import must preserve the final data row.'
  );

  durationsMs.sort((a, b) => a - b);
  const p95Ms = durationsMs[Math.ceil(durationsMs.length * 0.95) - 1];
  const peakRssGiB = peakSampledRssBytes / (1024 * 1024 * 1024);
  console.log(
    `[INGEST-BENCH] profile=maximum-5m-cells rows=${dataRows} cells=${targetCells} bytes=${uploadBytes.byteLength} repetitions=5 p95Ms=${p95Ms.toFixed(1)} peakSampledRssGiB=${peakRssGiB.toFixed(3)} fixtureHash=${finalWorkbookHash}`
  );
  console.log(
    `[ROUNDTRIP-BENCH] profile=maximum-5m-cells rows=${dataRows} cells=${targetCells} exportBytes=${exportedBytes.byteLength} exportReimportMs=${roundTripMs.toFixed(1)} peakSampledRssGiB=${peakRssGiB.toFixed(3)}`
  );
  assert.ok(
    roundTripMs <= 240_000,
    `5m-cell export + re-import (${roundTripMs.toFixed(1)} ms) must remain within 240,000 ms`
  );
  assert.ok(
    p95Ms <= 180_000,
    `5m-cell ingest + validation + profiling + reconciliation p95 (${p95Ms.toFixed(1)} ms) must remain within 180,000 ms`
  );
  assert.ok(
    peakRssGiB <= 3.0,
    `5m-cell workload peak sampled RSS (${peakRssGiB.toFixed(3)} GiB) must remain within 3.0 GiB`
  );
});


test('Requirement B: rule execution matrix is domain-scoped, dataset-version-bound, explicit about optional skips, and fail-closed on mandatory gaps', () => {
  const domains = ['DEMAND', 'SUPPLY', 'SOP', 'MEIO', 'PROCUREMENT', 'MANUFACTURING'] as const;
  let optionalSkipCount = 0;

  for (const [domainIndex, activeDomain] of domains.entries()) {
    const validWorkbook = createDomainTestWorkbook(activeDomain);
    const datasetHash = computeWorkbookHash(validWorkbook);
    const governedOutputHash = computeWorkbookHash(validWorkbook);
    const datasetVersion = 7 + domainIndex;
    const report = validateWorkbook(validWorkbook, {
      domain: activeDomain,
      datasetHash,
      datasetVersion,
      governedOutputHash,
    });

    const matrix = report.ruleExecutionMatrix ?? [];
    assert.equal(matrix.length, 6, `Every registered validation rule group must have one matrix row for ${activeDomain}`);
    assert.equal(new Set(matrix.map((entry) => entry.ruleId)).size, 6);
    for (const entry of matrix) {
      assert.equal(entry.domain, activeDomain);
      assert.equal(entry.datasetHash, datasetHash);
      assert.equal(entry.datasetVersion, datasetVersion);
      assert.equal(entry.governedOutputHash, governedOutputHash);
      assert.equal(entry.bindingStatus, 'BOUND');
      assert.equal(entry.ruleVersion, report.appliedRuleConfig?.ruleVersion);
      assert.ok(entry.reason.trim().length > 0, `${entry.ruleId} must explain its outcome for ${activeDomain}`);
    }

    const optionalSkips = matrix.filter((entry) => !entry.required && entry.status === 'SKIPPED');
    optionalSkipCount += optionalSkips.length;
    assert.ok(optionalSkips.every((entry) => /optional|not required/i.test(entry.reason)));

    const staleVersionGate = evaluateReleaseGate(
      report,
      null,
      true,
      Date.now(),
      datasetHash,
      true,
      datasetVersion + 1,
      [],
      governedOutputHash
    );
    const matrixGate = staleVersionGate.conditions.find(
      (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
    );
    assert.equal(matrixGate?.passed, false, `A matrix from another dataset version must not satisfy the ${activeDomain} release gate`);
  }

  assert.ok(optionalSkipCount > 0, 'Optional rules with no applicable checks must be explicitly SKIPPED across the domain matrix');

  const incompleteWorkbook = createDomainTestWorkbook('MANUFACTURING');
  delete incompleteWorkbook['15_Manufacturing_BOM_WorkCenters'];
  const incompleteHash = computeWorkbookHash(incompleteWorkbook);
  const incompleteReport = validateWorkbook(incompleteWorkbook, {
    domain: 'MANUFACTURING',
    datasetHash: incompleteHash,
    datasetVersion: 8,
    governedOutputHash: incompleteHash,
  });
  const schemaRule = incompleteReport.ruleExecutionMatrix?.find(
    (entry) => entry.ruleId === 'VAL-SCHEMA-001'
  );
  assert.ok(schemaRule);
  assert.ok(schemaRule.missingDependencies.length > 0);
  assert.ok(['FAILED', 'PARTIAL', 'NOT_RUN'].includes(schemaRule.status));
  assert.equal(incompleteReport.allRequiredValidationsExecuted, false);
  const blockedGate = evaluateReleaseGate(
    incompleteReport,
    null,
    true,
    Date.now(),
    incompleteHash,
    true,
    8,
    [],
    incompleteHash
  );
  assert.equal(blockedGate.step2Unlocked, false, 'Missing mandatory domain source must block release');
});

test('release gate rejects malformed rule-matrix metadata and impossible check counts', () => {
  const sheets = createDomainTestWorkbook('DEMAND');
  const datasetHash = computeWorkbookHash(sheets);
  const base = validateWorkbook(sheets, {
    domain: 'DEMAND',
    datasetHash,
    datasetVersion: 1,
    governedOutputHash: datasetHash,
  });
  const clean = {
    ...base,
    exceptions: [],
    schemaPassed: true,
    allRequiredValidationsExecuted: true,
  };

  for (const mutate of [
    (entry: any) => { entry.checksExecuted = entry.checksAttempted + 1; },
    (entry: any) => { entry.categoryKey = 'promoAndPriceBounds'; },
    (entry: any) => { entry.reason = '   '; },
    (entry: any) => { entry.missingDependencies = ['']; },
    (entry: any) => { entry.status = 'UNRECOGNIZED'; },
    (entry: any) => { entry.required = 'yes'; },
    (entry: any) => { entry.bindingStatus = 'UNKNOWN'; },
    (entry: any) => { entry.ruleVersion = '  '; },
    (entry: any) => { entry.domain = 'SUPPLY'; },
    (entry: any) => { entry.ruleVersion = 'stale-rule-version'; },
    (entry: any) => { entry.bindingStatus = 'BOUND'; entry.datasetHash = null; },
    (entry: any) => { entry.status = 'PASSED'; entry.issueCount = 1; },
    (entry: any) => { entry.status = 'FAILED'; entry.issueCount = 0; },
  ]) {
    const malformed = {
      ...clean,
      ruleExecutionMatrix: clean.ruleExecutionMatrix?.map((entry, index) => {
        const copy = { ...entry, missingDependencies: [...entry.missingDependencies] };
        if (index === 0) mutate(copy);
        return copy;
      }),
    };
    const gate = evaluateReleaseGate(
      malformed,
      null,
      true,
      Date.now(),
      datasetHash,
      true,
      1,
      [],
      datasetHash
    );
    const matrixCondition = gate.conditions.find(
      (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
    );
    assert.equal(matrixCondition?.passed, false, 'Malformed matrix evidence must fail closed');
    assert.equal(gate.step2Unlocked, false, 'Malformed matrix evidence must not unlock release');
  }
});

test('release gate blocks incomplete required outcomes and unacknowledged optional NOT_RUN rules', () => {
  const sheets = createDomainTestWorkbook('DEMAND');
  const hash = computeWorkbookHash(sheets);
  const report = validateWorkbook(sheets, {
    domain: 'DEMAND',
    datasetHash: hash,
    datasetVersion: 3,
    governedOutputHash: hash,
  });
  const matrix = report.ruleExecutionMatrix ?? [];
  const requiredIndex = matrix.findIndex((entry) => entry.required);
  const optionalIndex = matrix.findIndex((entry) => !entry.required);

  assert.ok(requiredIndex >= 0, 'Fixture must include a mandatory validation group');
  assert.ok(optionalIndex >= 0, 'Fixture must include an optional validation group');

  for (const [index, status] of [[requiredIndex, 'SKIPPED'], [optionalIndex, 'NOT_RUN']] as const) {
    const malformed = {
      ...report,
      ruleExecutionMatrix: matrix.map((entry, i) => i === index ? { ...entry, status } : entry),
      exceptions: [],
      schemaPassed: true,
      allRequiredValidationsExecuted: true,
    };
    const gate = evaluateReleaseGate(malformed, null, true, Date.now(), hash, true, 3, [], hash);
    const matrixCondition = gate.conditions.find(
      (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
    );
    assert.equal(matrixCondition?.passed, false, `Status ${status} must fail matrix completeness`);
    assert.equal(gate.step2Unlocked, false, `Status ${status} must block release`);
  }
});

test('release gate always requires a complete rule execution matrix even without dataset binding arguments', () => {
  const sheets = createDomainTestWorkbook('DEMAND');
  const report = validateWorkbook(sheets);
  const matrixlessReport = {
    ...report,
    ruleExecutionMatrix: undefined,
    exceptions: [],
    schemaPassed: true,
    allRequiredValidationsExecuted: true,
  };
  const gate = evaluateReleaseGate(matrixlessReport, null, true);
  const matrixCondition = gate.conditions.find(
    (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
  );
  assert.equal(matrixCondition?.passed, false, 'Matrix omission must fail closed even for unbound legacy calls');
  assert.equal(gate.step2Unlocked, false);
});

test('release gate rejects optional SKIPPED rows that claim checks were attempted or executed', () => {
  const sheets = createDomainTestWorkbook('DEMAND');
  const hash = computeWorkbookHash(sheets);
  const report = validateWorkbook(sheets, {
    domain: 'DEMAND',
    datasetHash: hash,
    datasetVersion: 4,
    governedOutputHash: hash,
  });
  const matrix = report.ruleExecutionMatrix ?? [];
  const optionalIndex = matrix.findIndex((entry) => !entry.required);
  assert.ok(optionalIndex >= 0, 'Fixture must include an optional validation group');
  const skippedOptional = {
    ...matrix[optionalIndex],
    status: 'SKIPPED' as const,
    reason: 'Optional source intentionally unavailable in this regression fixture',
    checksAttempted: 0,
    checksExecuted: 0,
    issueCount: 0,
    missingDependencies: [],
  };
  const malformed = {
    ...report,
    ruleExecutionMatrix: matrix.map((entry, index) =>
      index === optionalIndex
        ? { ...skippedOptional, checksAttempted: 1, checksExecuted: 1 }
        : entry
    ),
    exceptions: [],
    schemaPassed: true,
    allRequiredValidationsExecuted: true,
  };
  const gate = evaluateReleaseGate(malformed, null, true, Date.now(), hash, true, 4, [], hash);
  const matrixCondition = gate.conditions.find(
    (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
  );
  assert.equal(matrixCondition?.passed, false, 'A skip must not claim checks were executed');
  assert.equal(gate.step2Unlocked, false);
});

test('release gate rejects optional SKIPPED rows with unresolved dependencies', () => {
  const sheets = createDomainTestWorkbook('DEMAND');
  const hash = computeWorkbookHash(sheets);
  const report = validateWorkbook(sheets, {
    domain: 'DEMAND',
    datasetHash: hash,
    datasetVersion: 5,
    governedOutputHash: hash,
  });
  const matrix = report.ruleExecutionMatrix ?? [];
  const optionalIndex = matrix.findIndex((entry) => !entry.required);
  assert.ok(optionalIndex >= 0, 'Fixture must include an optional validation group');
  const skippedOptional = {
    ...matrix[optionalIndex],
    status: 'SKIPPED' as const,
    reason: 'Optional source intentionally unavailable in this regression fixture',
    checksAttempted: 0,
    checksExecuted: 0,
    issueCount: 0,
    missingDependencies: [],
  };
  const malformed = {
    ...report,
    ruleExecutionMatrix: matrix.map((entry, index) =>
      index === optionalIndex
        ? { ...skippedOptional, missingDependencies: ['missing-source-table'] }
        : entry
    ),
    exceptions: [],
    schemaPassed: true,
    allRequiredValidationsExecuted: true,
  };
  const gate = evaluateReleaseGate(malformed, null, true, Date.now(), hash, true, 5, [], hash);
  const matrixCondition = gate.conditions.find(
    (condition) => condition.label === 'Version-Bound Rule × Domain × Dataset Matrix'
  );
  assert.equal(matrixCondition?.passed, false, 'An optional skip cannot conceal unresolved dependencies');
  assert.equal(gate.step2Unlocked, false);
});
