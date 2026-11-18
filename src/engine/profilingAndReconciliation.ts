import {
  DEFAULT_RULE_CONFIG,
  DOMAIN_CONTRACTS,
  INDUSTRY_DEFAULT_RULE_CONFIGS,
  TABLE_CONTRACTS,
} from './schema';
import {
  ApprovedCorrection,
  AuditEntry,
  ColumnProfile,
  EnterpriseSheets,
  EntityHotspot,
  ExceptionAssignment,
  IndustryKey,
  PlanningDomainKey,
  ReconciliationCheckResult,
  ReconciliationReport,
  SchemaDriftReport,
  SheetRecord,
  TableProfile,
  UploadLineageRecord,
  ValidationException,
  ValidationRuleConfig,
  WarningSignOff,
  WorkbookProfileReport,
} from './types';
import { getRowVal, parseFlexibleDate, validateWorkbook } from './validation';

function parseNum(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : Number.NaN;
  if (val === null || val === undefined) return Number.NaN;
  const cleaned = String(val).trim().replace(/,/g, '');
  if (cleaned === '') return Number.NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

function normStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Deterministic FNV-1a 32-bit hash of the workbook structure and records
 * for upload lineage and audit traceability.
 */
export function computeWorkbookHash(sheets: EnterpriseSheets): string {
  let hash = 0x811c9dc5;
  const feed = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };

  const sheetNames = Object.keys(sheets).sort();
  for (const name of sheetNames) {
    feed(`SHEET:${name}|`);
    const tbl = sheets[name];
    if (!tbl) continue;
    for (const row of tbl.records || []) {
      if (row._removed) continue;
      const keys = Object.keys(row)
        .filter((k) => !k.startsWith('_'))
        .sort();
      for (const k of keys) {
        feed(`${k}=${String(row[k] ?? '')};`);
      }
    }
  }
  return `FNV32-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Universal Column & Table Data Profiling Engine (P1 Requirement).
 * Computes 18 column-level metrics, 10 table-level metrics, and Entity Hotspots.
 */
export function profileWorkbook(
  sheets: EnterpriseSheets,
  exceptions?: ValidationException[],
  outlierZThreshold: number = 3.0
): WorkbookProfileReport {
  const activeExceptions = exceptions ?? validateWorkbook(sheets).exceptions;
  const tables: TableProfile[] = [];

  for (const tableName of Object.keys(sheets)) {
    const sheet = sheets[tableName];
    if (!sheet) continue;
    const liveRecords = (sheet.records || []).filter((r) => !r._removed);
    const rowCount = liveRecords.length;

    const contractKey =
      Object.keys(TABLE_CONTRACTS).find(
        (k) =>
          k.toLowerCase() === tableName.toLowerCase() ||
          tableName.startsWith(k.slice(0, 3))
      ) ?? tableName;
    const contract = TABLE_CONTRACTS[contractKey];

    // Collect union of column names
    const colSet = new Set<string>();
    for (const c of sheet.cols || []) {
      if (c.col && !c.col.startsWith('_')) colSet.add(c.col);
    }
    for (const r of liveRecords) {
      for (const k of Object.keys(r)) {
        if (!k.startsWith('_')) colSet.add(k);
      }
    }
    const colNames = Array.from(colSet);

    let totalCells = 0;
    let totalNullCells = 0;
    let minPeriod: string | null = null;
    let maxPeriod: string | null = null;
    const allDatesMs = new Set<number>();

    const columns: ColumnProfile[] = colNames.map((colName) => {
      const expectedType = contract?.columnTypes?.[colName] ?? 'STRING';
      let nonNullCount = 0;
      let nullCount = 0;
      let invalidTypeCount = 0;
      let zeroCount = 0;
      let negativeCount = 0;
      const distinctSet = new Set<string>();
      const numValues: number[] = [];

      for (const row of liveRecords) {
        totalCells++;
        const raw = row[colName];
        const s = raw === null || raw === undefined ? '' : String(raw).trim();
        if (raw === null || raw === undefined || s === '' || s.toUpperCase() === 'NULL') {
          nullCount++;
          totalNullCells++;
          continue;
        }
        nonNullCount++;
        distinctSet.add(s);

        if (expectedType === 'DATE' || colName.toLowerCase().includes('date') || colName.toLowerCase().includes('month')) {
          const dt = parseFlexibleDate(raw);
          if (!dt) {
            if (expectedType === 'DATE') invalidTypeCount++;
          } else {
            const iso = dt.toISOString().slice(0, 10);
            if (!minPeriod || iso < minPeriod) minPeriod = iso;
            if (!maxPeriod || iso > maxPeriod) maxPeriod = iso;
            allDatesMs.add(dt.getTime());
          }
        } else if (expectedType === 'NUMBER' || expectedType === 'NON_NEGATIVE_NUMBER') {
          const n = parseNum(raw);
          if (!Number.isFinite(n)) {
            invalidTypeCount++;
          } else {
            numValues.push(n);
            if (n === 0) zeroCount++;
            if (n < 0) {
              negativeCount++;
              if (expectedType === 'NON_NEGATIVE_NUMBER') invalidTypeCount++;
            }
          }
        } else {
          // Check if column happens to be numeric even if typed as STRING
          const n = parseNum(raw);
          if (Number.isFinite(n)) {
            numValues.push(n);
            if (n === 0) zeroCount++;
            if (n < 0) negativeCount++;
          }
        }
      }

      const nullPct =
        rowCount > 0 ? Number(((nullCount / rowCount) * 100).toFixed(1)) : 0;
      const distinctCount = distinctSet.size;
      const distinctPct =
        nonNullCount > 0 ? Number(((distinctCount / nonNullCount) * 100).toFixed(1)) : 0;

      if (numValues.length > 0 && (expectedType === 'NUMBER' || expectedType === 'NON_NEGATIVE_NUMBER' || numValues.length === nonNullCount)) {
        const sorted = [...numValues].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const sum = sorted.reduce((acc, v) => acc + v, 0);
        const mean = Number((sum / sorted.length).toFixed(2));
        const median = Number(percentile(sorted, 0.5).toFixed(2));
        const variance =
          sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
          Math.max(1, sorted.length);
        const stdDev = Number(Math.sqrt(variance).toFixed(2));
        const p25 = Number(percentile(sorted, 0.25).toFixed(2));
        const p75 = Number(percentile(sorted, 0.75).toFixed(2));
        const iqr = Number((p75 - p25).toFixed(2));
        const p5 = Number(percentile(sorted, 0.05).toFixed(2));
        const p95 = Number(percentile(sorted, 0.95).toFixed(2));

        let outlierCount = 0;
        if (stdDev > 0) {
          for (const v of sorted) {
            if (Math.abs((v - mean) / stdDev) > outlierZThreshold) {
              outlierCount++;
            }
          }
        }

        return {
          table: tableName,
          column: colName,
          inferredType: expectedType,
          totalCount: rowCount,
          nonNullCount,
          nullCount,
          nullPct,
          distinctCount,
          distinctPct,
          invalidTypeCount,
          zeroCount,
          negativeCount,
          min,
          max,
          mean,
          median,
          stdDev,
          iqr,
          p5,
          p95,
          outlierCount,
        };
      }

      return {
        table: tableName,
        column: colName,
        inferredType: expectedType,
        totalCount: rowCount,
        nonNullCount,
        nullCount,
        nullPct,
        distinctCount,
        distinctPct,
        invalidTypeCount,
        zeroCount,
        negativeCount,
        min: null,
        max: null,
        mean: null,
        median: null,
        stdDev: null,
        iqr: null,
        p5: null,
        p95: null,
        outlierCount: 0,
      };
    });

    // Detect time granularity from date deltas
    let timeGranularity: TableProfile['timeGranularity'] = 'NONE';
    if (allDatesMs.size >= 2) {
      const sortedMs = Array.from(allDatesMs).sort((a, b) => a - b);
      const deltas: number[] = [];
      for (let i = 1; i < sortedMs.length; i++) {
        const diffDays = Math.round((sortedMs[i] - sortedMs[i - 1]) / 86400000);
        if (diffDays > 0) deltas.push(diffDays);
      }
      if (deltas.length > 0) {
        const minDelta = Math.min(...deltas);
        if (minDelta === 1) timeGranularity = 'DAILY';
        else if (minDelta <= 14 && deltas.every((d) => d % 7 === 0)) timeGranularity = 'WEEKLY';
        else if (minDelta >= 28 && minDelta <= 31) timeGranularity = 'MONTHLY';
        else timeGranularity = 'IRREGULAR';
      }
    } else if (allDatesMs.size === 1) {
      timeGranularity = 'MONTHLY';
    }

    const tblExceptions = activeExceptions.filter((e) => e.table === tableName);
    const duplicateKeyCount = tblExceptions.filter((e) => e.category === 'DUPLICATE_KEY').length;
    const orphanFkCount = tblExceptions.filter((e) => e.category === 'CROSS_TABLE').length;
    const timeSeriesGapCount = tblExceptions.filter(
      (e) => e.fixType === 'IMPUTE_MISSING_PERIOD'
    ).length;
    const completenessPct =
      totalCells > 0
        ? Number((((totalCells - totalNullCells) / totalCells) * 100).toFixed(1))
        : 100;

    tables.push({
      table: tableName,
      grain: contract?.businessKey?.join(' × ') || sheet.pillar || 'Entity Record',
      rowCount,
      columnCount: colNames.length,
      completenessPct,
      duplicateKeyCount,
      orphanFkCount,
      timeSeriesGapCount,
      timeGranularity,
      minPeriod,
      maxPeriod,
      columns,
    });
  }

  // Build Hotspots for SKUs, Depots, and Tables
  const skuMap = new Map<string, { total: number; crit: number; warn: number }>();
  const depotMap = new Map<string, { total: number; crit: number; warn: number }>();
  const tableMap = new Map<string, { total: number; crit: number; warn: number }>();

  for (const ex of activeExceptions) {
    // Table hotspot
    const tStat = tableMap.get(ex.table) ?? { total: 0, crit: 0, warn: 0 };
    tStat.total++;
    if (ex.severity === 'CRITICAL') tStat.crit++;
    else tStat.warn++;
    tableMap.set(ex.table, tStat);

    // Extract SKU and Depot from intersection or row
    const tbl = sheets[ex.table];
    const row = ex.rowIndex >= 0 && tbl?.records ? tbl.records[ex.rowIndex] : undefined;
    const sku = row
      ? normStr(getRowVal(row, ['SKU_Code', 'New_Launch_SKU_Code', 'SKU']))
      : ex.missingPeriodMeta?.sku ?? '';
    const depot = row
      ? normStr(getRowVal(row, ['Location_DC', 'Depot', 'Location']))
      : ex.missingPeriodMeta?.depot ?? '';

    if (sku) {
      const sStat = skuMap.get(sku) ?? { total: 0, crit: 0, warn: 0 };
      sStat.total++;
      if (ex.severity === 'CRITICAL') sStat.crit++;
      else sStat.warn++;
      skuMap.set(sku, sStat);
    }
    if (depot) {
      const dStat = depotMap.get(depot) ?? { total: 0, crit: 0, warn: 0 };
      dStat.total++;
      if (ex.severity === 'CRITICAL') dStat.crit++;
      else dStat.warn++;
      depotMap.set(depot, dStat);
    }
  }

  const toHotspots = (
    map: Map<string, { total: number; crit: number; warn: number }>,
    entityType: EntityHotspot['entityType']
  ): EntityHotspot[] =>
    Array.from(map.entries())
      .map(([entityKey, v]) => ({
        entityType,
        entityKey,
        exceptionCount: v.total,
        criticalCount: v.crit,
        warningCount: v.warn,
      }))
      .sort((a, b) => b.criticalCount - a.criticalCount || b.exceptionCount - a.exceptionCount)
      .slice(0, 8);

  return {
    tables,
    topProblematicSkus: toHotspots(skuMap, 'SKU'),
    topProblematicDepots: toHotspots(depotMap, 'DEPOT'),
    topProblematicTables: toHotspots(tableMap, 'TABLE'),
  };
}

/**
 * Cross-Table Validation & Financial/Physical Reconciliation Engine (P1 Requirement).
 * Reconciles physical flows, financial realization, stockout censoring, AOP alignment,
 * forecast guardrails, and MEIO network lead-time policies across the 12-table model.
 */
export function runCrossTableReconciliation(
  sheets: EnterpriseSheets,
  ruleConfig: ValidationRuleConfig = DEFAULT_RULE_CONFIG
): ReconciliationReport {
  const checks: ReconciliationCheckResult[] = [];
  const tolPct = ruleConfig.reconciliationTolerancePct;

  const ordersTbl = sheets['01_Orders_Shipments_History']?.records?.filter((r) => !r._removed) ?? [];
  const fcstTbl = sheets['02_Forecast_Vintages_Lag']?.records?.filter((r) => !r._removed) ?? [];
  const priceTbl =
    (
      sheets['06_Pricing_Elasticity_Catalog'] ??
      sheets['03_Price_Cost_Margin_Conditions']
    )?.records?.filter((r) => !r._removed) ?? [];
  const invTbl = sheets['07_Inventory_Supply_Constraints']?.records?.filter((r) => !r._removed) ?? [];
  const sOpTbl =
    (
      sheets['03_Commercial_Sales_Inputs'] ??
      sheets['08_SOP_Consensus_Overrides']
    )?.records?.filter((r) => !r._removed) ?? [];
  const depotTbl = sheets['10_Location_Depot_Network']?.records?.filter((r) => !r._removed) ?? [];

  // 1. Orders vs. Billed Shipments + Returns Reconciliation
  {
    let sumOrders = 0;
    let sumShippedPlusReturns = 0;
    let validPairs = 0;
    for (const r of ordersTbl) {
      const ord = parseNum(r.Ordered_Qty_Units);
      const billed = parseNum(r.Invoiced_Actual_Qty);
      const ret = Math.max(0, parseNum(r.Returns_Damaged_Qty) || 0);
      const imputed = Math.max(0, parseNum(r.Governed_Imputed_Demand_Qty) || 0);
      if (Number.isFinite(ord) && Number.isFinite(billed) && billed >= 0) {
        sumOrders += ord;
        sumShippedPlusReturns += billed + ret + imputed;
        validPairs++;
      }
    }
    const varianceAbs = Number((sumOrders - sumShippedPlusReturns).toFixed(1));
    const variancePct =
      sumOrders > 0 ? Number(((Math.abs(varianceAbs) / sumOrders) * 100).toFixed(2)) : null;
    const status: ReconciliationCheckResult['status'] =
      validPairs === 0
        ? 'NOT_APPLICABLE'
        : variancePct !== null && variancePct <= tolPct
          ? 'RECONCILED'
          : variancePct !== null && variancePct <= tolPct * 3
            ? 'VARIANCE_WARNING'
            : 'CRITICAL_MISMATCH';

    checks.push({
      id: 'REC-01',
      name: 'Customer Orders vs. Billed Shipments + Returns',
      leftSource: '01_Orders_Shipments_History (Ordered_Qty_Units)',
      rightSource: '01_Orders_Shipments_History (Invoiced_Actual_Qty + Returns)',
      leftTotal: sumOrders,
      rightTotal: sumShippedPlusReturns,
      varianceAbs,
      variancePct,
      tolerancePct: tolPct,
      status,
      detail:
        validPairs === 0
          ? 'No valid order/shipment pairs available'
          : `Unfulfilled/stockout order gap of ${varianceAbs.toLocaleString()} u (${variancePct}% vs ${tolPct}% tolerance)`,
    });
  }

  // 2. Billed Quantity × Net Realized Price vs. Net Realized Sales Revenue
  {
    const priceBySku = new Map<string, number>();
    for (const r of priceTbl) {
      const sku = normStr(r.SKU_Code);
      const p = parseNum(r.Net_Realized_Price_INR);
      if (sku && Number.isFinite(p) && p > 0) {
        priceBySku.set(sku, p);
      }
    }

    let expectedRev = 0;
    let bookedRev = 0;
    let matchedRows = 0;
    for (const r of ordersTbl) {
      if (r._isImputedContinuityRow) continue;
      const sku = normStr(r.SKU_Code);
      const billed = parseNum(r.Invoiced_Actual_Qty);
      const rev = parseNum(r.Net_Realized_Sales_INR);
      const unitPrice = priceBySku.get(sku);
      if (Number.isFinite(billed) && billed > 0 && Number.isFinite(rev) && unitPrice !== undefined) {
        expectedRev += billed * unitPrice;
        bookedRev += rev;
        matchedRows++;
      }
    }
    const varianceAbs = Number((bookedRev - expectedRev).toFixed(0));
    const variancePct =
      expectedRev > 0
        ? Number(((Math.abs(varianceAbs) / expectedRev) * 100).toFixed(2))
        : null;
    const status: ReconciliationCheckResult['status'] =
      matchedRows === 0
        ? 'NOT_APPLICABLE'
        : variancePct !== null && variancePct <= tolPct
          ? 'RECONCILED'
          : variancePct !== null && variancePct <= tolPct * 3
            ? 'VARIANCE_WARNING'
            : 'CRITICAL_MISMATCH';

    checks.push({
      id: 'REC-02',
      name: 'Billed Volume × Price Master vs. Booked Net Revenue',
      leftSource: '01_Orders × 03_Price_Cost_Margin (Qty × Net_Price)',
      rightSource: '01_Orders_Shipments_History (Net_Realized_Sales_INR)',
      leftTotal: Math.round(expectedRev),
      rightTotal: Math.round(bookedRev),
      varianceAbs,
      variancePct,
      tolerancePct: tolPct,
      status,
      detail:
        matchedRows === 0
          ? 'Requires SKU match between Orders and Price Master'
          : `Matched ${matchedRows} invoice lines; revenue delta ₹${varianceAbs.toLocaleString()} (${variancePct}%)`,
    });
  }

  // 3. Inventory Stockout Censored Demand vs. Billed Shipments
  {
    let billedInStockoutRows = 0;
    let uncensoredInStockoutRows = 0;
    let stockoutRows = 0;
    for (const r of invTbl) {
      const closeStk = parseNum(r.Closing_OnHand_Stock_Qty);
      const stkDays = parseNum(r.Depot_Stockout_Days_Count);
      if (closeStk === 0 && Number.isFinite(stkDays) && stkDays > 0) {
        stockoutRows++;
        const billed = Math.max(0, parseNum(r.Invoiced_Actual_Qty) || 0);
        const restored = Math.max(
          0,
          parseNum(r.Governed_Uncensored_Demand_Qty ?? r._uncensoredDemandEstimate) || billed
        );
        billedInStockoutRows += billed;
        uncensoredInStockoutRows += restored;
      }
    }
    const varianceAbs = Number((uncensoredInStockoutRows - billedInStockoutRows).toFixed(0));
    const variancePct =
      billedInStockoutRows > 0
        ? Number(((Math.abs(varianceAbs) / billedInStockoutRows) * 100).toFixed(2))
        : 0;
    const unaddressedStockouts = invTbl.filter(
      (r) =>
        parseNum(r.Closing_OnHand_Stock_Qty) === 0 &&
        (parseNum(r.Depot_Stockout_Days_Count) || 0) > 0 &&
        !r._stockoutRestored &&
        !(parseNum(r.Governed_Uncensored_Demand_Qty) > 0)
    ).length;

    checks.push({
      id: 'REC-03',
      name: 'Stockout-Adjusted Demand vs. Censored Billed Shipments',
      leftSource: '07_Inventory_Supply_Constraints (Billed During Stockout)',
      rightSource: '07_Inventory_Supply_Constraints (Governed Uncensored Demand)',
      leftTotal: billedInStockoutRows,
      rightTotal: uncensoredInStockoutRows,
      varianceAbs,
      variancePct,
      tolerancePct: tolPct,
      status:
        stockoutRows === 0
          ? 'RECONCILED'
          : unaddressedStockouts === 0
            ? 'RECONCILED'
            : 'VARIANCE_WARNING',
      detail:
        stockoutRows === 0
          ? 'Zero depot stockout periods detected'
          : unaddressedStockouts === 0
            ? `All ${stockoutRows} stockout period(s) reconciled (+${varianceAbs.toLocaleString()} u uncensored adjustment)`
            : `${unaddressedStockouts} stockout period(s) have unreviewed censored demand`,
    });
  }

  // 4. S&OP Commercial Field Override vs. Finance AOP Target
  {
    let sumOverride = 0;
    let sumAop = 0;
    let count = 0;
    for (const r of sOpTbl) {
      const ov = parseNum(r.Field_Sales_Override_Qty);
      const aop = parseNum(r.Finance_AOP_Target_Qty);
      if (Number.isFinite(ov) && Number.isFinite(aop) && aop > 0) {
        sumOverride += ov;
        sumAop += aop;
        count++;
      }
    }
    const varianceAbs = Number((sumOverride - sumAop).toFixed(0));
    const variancePct =
      sumAop > 0 ? Number(((Math.abs(varianceAbs) / sumAop) * 100).toFixed(2)) : null;
    const status: ReconciliationCheckResult['status'] =
      count === 0
        ? 'NOT_APPLICABLE'
        : variancePct !== null && variancePct <= ruleConfig.salesOverrideMaxPct
          ? 'RECONCILED'
          : 'VARIANCE_WARNING';

    checks.push({
      id: 'REC-04',
      name: 'S&OP Commercial Sales Override vs. Finance AOP Target',
      leftSource: '08_SOP_Consensus_Overrides (Field_Sales_Override_Qty)',
      rightSource: '08_SOP_Consensus_Overrides (Finance_AOP_Target_Qty)',
      leftTotal: sumOverride,
      rightTotal: sumAop,
      varianceAbs,
      variancePct,
      tolerancePct: ruleConfig.salesOverrideMaxPct,
      status,
      detail:
        count === 0
          ? 'No S&OP override records present'
          : `Commercial override delta of ${varianceAbs >= 0 ? '+' : ''}${varianceAbs.toLocaleString()} u (${variancePct}% vs +${ruleConfig.salesOverrideMaxPct}% guardrail)`,
    });
  }

  // 5. Submitted Lag-1 Forecast vs. Clean Statistical Baseline
  {
    let sumLag1 = 0;
    let sumStatBase = 0;
    let count = 0;
    for (const r of fcstTbl) {
      const lag1 = parseNum(r.Stat_Forecast_Lag1_Qty);
      const base = parseNum(r.Stat_Baseline_Unconstrained);
      if (Number.isFinite(lag1) && Number.isFinite(base) && base > 0) {
        sumLag1 += lag1;
        sumStatBase += base;
        count++;
      }
    }
    const varianceAbs = Number((sumLag1 - sumStatBase).toFixed(0));
    const variancePct =
      sumStatBase > 0
        ? Number(((Math.abs(varianceAbs) / sumStatBase) * 100).toFixed(2))
        : null;
    const status: ReconciliationCheckResult['status'] =
      count === 0
        ? 'NOT_APPLICABLE'
        : variancePct !== null && variancePct <= ruleConfig.forecastUpperCorridorPct
          ? 'RECONCILED'
          : 'CRITICAL_MISMATCH';

    checks.push({
      id: 'REC-05',
      name: 'Submitted Lag-1 Forecast vs. Unconstrained Empirical Baseline',
      leftSource: '02_Forecast_Vintages_Lag (Stat_Forecast_Lag1_Qty)',
      rightSource: '02_Forecast_Vintages_Lag (Stat_Baseline_Unconstrained)',
      leftTotal: sumLag1,
      rightTotal: sumStatBase,
      varianceAbs,
      variancePct,
      tolerancePct: ruleConfig.forecastUpperCorridorPct,
      status,
      detail:
        count === 0
          ? 'No forecast vintage baseline rows found'
          : `Forecast vintage variance ${varianceAbs >= 0 ? '+' : ''}${varianceAbs.toLocaleString()} u (${variancePct}% vs +${ruleConfig.forecastUpperCorridorPct}% corridor)`,
    });
  }

  // 6. Depot Network Lead-Time vs. Industry Policy Ceiling
  {
    let maxObservedLt = 0;
    let count = 0;
    for (const r of depotTbl) {
      const lt = parseNum(
        r.Primary_Transit_Lead_Time_Days ?? r.Standard_Lead_Time_Days
      );
      if (Number.isFinite(lt) && lt >= 0) {
        if (lt > maxObservedLt) maxObservedLt = lt;
        count++;
      }
    }
    const ceiling = ruleConfig.maxLeadTimeDays;
    const varianceAbs = Math.max(0, maxObservedLt - ceiling);
    const variancePct =
      ceiling > 0 ? Number(((varianceAbs / ceiling) * 100).toFixed(1)) : null;

    checks.push({
      id: 'REC-06',
      name: 'Depot Network Max Transit Lead-Time vs. Policy Ceiling',
      leftSource: '10_Location_Depot_Network (Max Standard_Lead_Time_Days)',
      rightSource: 'Industry Governance Policy (maxLeadTimeDays)',
      leftTotal: maxObservedLt,
      rightTotal: ceiling,
      varianceAbs,
      variancePct,
      tolerancePct: 0,
      status:
        count === 0
          ? 'NOT_APPLICABLE'
          : maxObservedLt <= ceiling
            ? 'RECONCILED'
            : 'VARIANCE_WARNING',
      detail:
        count === 0
          ? 'No depot network records found'
          : `Max depot lead time ${maxObservedLt}d vs ${ceiling}d policy ceiling`,
    });
  }

  return {
    checks,
    reconciledCount: checks.filter((c) => c.status === 'RECONCILED').length,
    warningCount: checks.filter((c) => c.status === 'VARIANCE_WARNING').length,
    criticalCount: checks.filter((c) => c.status === 'CRITICAL_MISMATCH').length,
  };
}

/**
 * Schema Drift & Column Mapping Detector (P1 Requirement).
 * Inspects uploaded tables against canonical contracts and suggests column mappings
 * when source ERP headers differ from canonical schema names.
 */
export function detectSchemaDrift(
  sheets: EnterpriseSheets,
  domain: PlanningDomainKey = 'ALL'
): SchemaDriftReport {
  const domainContract = DOMAIN_CONTRACTS[domain] ?? DOMAIN_CONTRACTS.ALL;
  const mandatorySet = new Set(domainContract.mandatoryTables);

  const missingMandatoryTables: string[] = [];
  const missingOptionalTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string; mandatory: boolean }> = [];
  const unexpectedColumns: Array<{ table: string; column: string }> = [];
  const suggestedColumnMappings: Array<{
    table: string;
    sourceColumn: string;
    targetCanonicalColumn: string;
  }> = [];

  for (const contractName of Object.keys(TABLE_CONTRACTS)) {
    const contract = TABLE_CONTRACTS[contractName];
    const matchedSheet = Object.keys(sheets).find(
      (s) =>
        s.toLowerCase() === contractName.toLowerCase() ||
        s.startsWith(contractName.slice(0, 3))
    );

    if (!matchedSheet || !sheets[matchedSheet]) {
      if (domain === 'ALL' ? contract.mandatory : mandatorySet.has(contractName)) {
        missingMandatoryTables.push(contractName);
      } else {
        missingOptionalTables.push(contractName);
      }
      continue;
    }

    const tbl = sheets[matchedSheet];
    const actualCols = new Set<string>();
    for (const c of tbl.cols || []) {
      if (c.col && !c.col.startsWith('_')) actualCols.add(c.col);
    }
    for (const r of tbl.records || []) {
      for (const k of Object.keys(r)) {
        if (!k.startsWith('_')) actualCols.add(k);
      }
    }

    const canonicalCols = new Set<string>([
      ...contract.mandatoryColumns,
      ...contract.businessKey,
      ...Object.keys(contract.columnTypes),
    ]);

    const actualLowerMap = new Map<string, string>();
    actualCols.forEach((ac) => actualLowerMap.set(ac.toLowerCase(), ac));

    for (const reqCol of contract.mandatoryColumns) {
      if (!actualLowerMap.has(reqCol.toLowerCase())) {
        missingColumns.push({ table: matchedSheet, column: reqCol, mandatory: true });
        // Look for fuzzy alias candidate in actualCols
        const keyword = reqCol.split('_')[0].toLowerCase();
        const candidate = Array.from(actualCols).find(
          (ac) =>
            !canonicalCols.has(ac) &&
            ac.toLowerCase().includes(keyword)
        );
        if (candidate) {
          suggestedColumnMappings.push({
            table: matchedSheet,
            sourceColumn: candidate,
            targetCanonicalColumn: reqCol,
          });
        }
      }
    }

    for (const ac of actualCols) {
      if (ac.startsWith('Governed_')) continue;
      if (!Array.from(canonicalCols).some((cc) => cc.toLowerCase() === ac.toLowerCase())) {
        unexpectedColumns.push({ table: matchedSheet, column: ac });
      }
    }
  }

  return {
    missingMandatoryTables,
    missingOptionalTables,
    missingColumns,
    unexpectedColumns,
    suggestedColumnMappings,
  };
}

/**
 * Non-destructive column alias mapper: renames a source column to a canonical column name
 * in a cloned copy of the workbook.
 */
export function applyColumnMapping(
  sheets: EnterpriseSheets,
  table: string,
  sourceColumn: string,
  targetCanonicalColumn: string
): EnterpriseSheets {
  const tbl = sheets[table];
  if (!tbl) return sheets;

  const updatedRecords: SheetRecord[] = tbl.records.map((r) => {
    const copy: SheetRecord = { ...r };
    if (copy[sourceColumn] !== undefined && copy[targetCanonicalColumn] === undefined) {
      copy[targetCanonicalColumn] = copy[sourceColumn];
      delete copy[sourceColumn];
    }
    return copy;
  });

  const hasTargetCol = tbl.cols.some(
    (c) => c.col.toLowerCase() === targetCanonicalColumn.toLowerCase()
  );
  const updatedCols = hasTargetCol
    ? tbl.cols
    : tbl.cols.map((c) =>
        c.col === sourceColumn ? { ...c, col: targetCanonicalColumn } : c
      );

  return {
    ...sheets,
    [table]: {
      ...tbl,
      cols: updatedCols,
      records: updatedRecords,
    },
  };
}

/**
 * In-App Structural Remediation helper:
 * Allows a steward to initialize a missing table or missing mandatory column with default blank/template structure
 * so record-level remediation can proceed in-app without leaving the workbench.
 */
export function remediateMissingStructure(
  sheets: EnterpriseSheets,
  tableName: string,
  columnName?: string,
  defaultCellValue: string | number = ''
): EnterpriseSheets {
  const contract = TABLE_CONTRACTS[tableName];
  const existingSheet = sheets[tableName];

  if (!existingSheet) {
    // Initialize table with canonical columns and 1 template row ready for governed remediation
    const cols = contract
      ? Array.from(
          new Set([
            ...contract.mandatoryColumns,
            ...contract.businessKey,
            ...Object.keys(contract.columnTypes),
          ])
        )
      : [columnName || 'ID'];

    const initialRow: SheetRecord = {};
    for (const c of cols) {
      const colType = contract?.columnTypes?.[c] ?? 'STRING';
      initialRow[c] =
        colType === 'DATE'
          ? '2025-01-01'
          : colType === 'NON_NEGATIVE_NUMBER' || colType === 'NUMBER'
            ? 0
            : `PENDING_${c.toUpperCase()}`;
    }

    return {
      ...sheets,
      [tableName]: {
        pillar: contract?.businessKey?.join(' × ') ?? 'Entity Grain',
        desc: 'In-App Governed Structure Initialization',
        cols: cols.map((col) => ({
          col,
          type: contract?.columnTypes?.[col] ?? 'STRING',
          key: contract?.businessKey?.includes(col) ? 'PK' : 'Attr',
          required: contract?.mandatoryColumns?.includes(col) ?? true,
          dataType: contract?.columnTypes?.[col] ?? 'STRING',
        })),
        records: [initialRow],
      },
    };
  }

  if (columnName) {
    const colType = contract?.columnTypes?.[columnName] ?? 'STRING';
    const hasColMeta = existingSheet.cols.some(
      (c) => c.col.toLowerCase() === columnName.toLowerCase()
    );
    const nextCols = hasColMeta
      ? existingSheet.cols
      : [
          ...existingSheet.cols,
          {
            col: columnName,
            type: colType,
            key: contract?.businessKey?.includes(columnName) ? 'PK' : 'Attr',
            required: true,
            dataType: colType,
          },
        ];

    const nextRecords = existingSheet.records.map((r) => ({
      ...r,
      [columnName]: r[columnName] !== undefined ? r[columnName] : defaultCellValue,
    }));

    return {
      ...sheets,
      [tableName]: {
        ...existingSheet,
        cols: nextCols,
        records: nextRecords,
      },
    };
  }

  return sheets;
}

// ============================================================================
// PERSISTENT GOVERNANCE STORAGE (Section 19.14)
// ============================================================================
const STORAGE_KEY = 'argon_phase1_governance_state_v1';

export interface PersistedGovernanceState {
  industry: IndustryKey;
  domain: PlanningDomainKey;
  ruleConfig: ValidationRuleConfig;
  approvedCorrections: ApprovedCorrection[];
  warningSignOff: WarningSignOff | null;
  auditLog: AuditEntry[];
  lineageHistory: UploadLineageRecord[];
  exceptionAssignments: Record<string, ExceptionAssignment>;
}

export function savePersistedGovernanceState(state: PersistedGovernanceState): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}

export function loadPersistedGovernanceState(): PersistedGovernanceState | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedGovernanceState>;
      if (!parsed || typeof parsed !== 'object') return null;
      const industry: IndustryKey = parsed.industry ?? 'cpg';
      return {
        industry,
        domain: parsed.domain ?? 'ALL',
        ruleConfig: {
          ...(INDUSTRY_DEFAULT_RULE_CONFIGS[industry] ?? DEFAULT_RULE_CONFIG),
          ...(parsed.ruleConfig ?? {}),
        },
        approvedCorrections: Array.isArray(parsed.approvedCorrections)
          ? parsed.approvedCorrections
          : [],
        warningSignOff: parsed.warningSignOff ?? null,
        auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
        lineageHistory: Array.isArray(parsed.lineageHistory) ? parsed.lineageHistory : [],
        exceptionAssignments:
          parsed.exceptionAssignments && typeof parsed.exceptionAssignments === 'object'
            ? parsed.exceptionAssignments
            : {},
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function clearPersistedGovernanceState(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}
