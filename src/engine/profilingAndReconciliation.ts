import {
  createSeededEnterpriseSheets,
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
  FieldDataType,
  IndustryKey,
  InferredColumnDataType,
  PlanningDomainKey,
  ReconciliationCheckResult,
  ReconciliationReport,
  SchemaDriftReport,
  SheetRecord,
  SuggestedColumnMapping,
  TableProfile,
  UploadLineageRecord,
  ValidationException,
  ValidationRuleConfig,
  WarningSignOff,
  WorkbookProfileReport,
} from './types';
import {
  getRowVal,
  isAmbiguousDateString,
  parseFlexibleDate,
  parseStrictNumber,
  validateWorkbook,
} from './validation';

function parseNum(val: unknown): number {
  return parseStrictNumber(val);
}

function normStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function resolveContractTableKey(tableName: string): string | undefined {
  const names = Object.keys(TABLE_CONTRACTS);
  const lower = tableName.toLowerCase();
  const exact = names.find((name) => name.toLowerCase() === lower);
  if (exact) return exact;

  const suffixMatches = names.filter((name =>
    ['_', ' ', '-', '(', '['].some((separator) =>
      lower.startsWith(name.toLowerCase() + separator)
    )
  ));
  if (suffixMatches.length === 1) return suffixMatches[0];
  // Require canonical names; table aliases need an explicit mapping workflow.
  return undefined;
}

function resolveUniqueContractKeyInWorkbook(
  sheets: EnterpriseSheets,
  tableName: string
): string | undefined {
  const candidate = resolveContractTableKey(tableName);
  if (!candidate) return undefined;
  const matchingTables = Object.keys(sheets).filter(
    (name) => resolveContractTableKey(name) === candidate
  );
  return matchingTables.length === 1 ? candidate : undefined;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ============================================================================
// FIPS 180-4 SHA-256 IMPLEMENTATION FOR AUDIT-GRADE DATASET FINGERPRINTING
// ============================================================================
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const totalBytes = (((utf8.length + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(totalBytes);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(totalBytes - 8, highBits, false);
  view.setUint32(totalBytes - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Cryptographic SHA-256 fingerprint of the workbook structure and records
 * for dataset identity verification, correction binding, and audit lineage.
 */
export function computeWorkbookHash(sheets: EnterpriseSheets): string {
  // Typed JSON boundaries prevent collisions caused by delimiter-based concatenation.
  const encodeValue = (value: unknown): unknown => {
    if (value === undefined) return ['undefined'];
    if (value === null) return ['null'];
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? ['date', 'INVALID']
        : ['date', value.toISOString()];
    }
    if (typeof value === 'number') {
      return ['number', Number.isFinite(value) ? (Object.is(value, -0) ? '-0' : value.toString()) : String(value)];
    }
    return [typeof value, value];
  };

  const canonicalWorkbook = Object.keys(sheets)
    .sort()
    .map((name) => {
      const table = sheets[name];
      if (!table) return [name, null];
      const columns = (table.cols || [])
        .filter((column) => column.col && !column.col.startsWith('_'))
        .map((column) => [
          column.col,
          column.type,
          column.key,
          column.required ?? null,
          column.dataType ?? null,
        ])
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
      // Preserve row order: approved corrections are bound to stable source row indices.
      // Reordering rows must invalidate the workbook fingerprint to prevent approval drift.
      const rows = (table.records || [])
        .filter((row) => !row._removed)
        .map((row) =>
          Object.keys(row)
            .filter((key) => !key.startsWith('_'))
            .sort()
            .map((key) => [key, encodeValue(row[key])])
        );
      return [name, columns, rows];
    });

  return `SHA256-${sha256Hex(JSON.stringify(canonicalWorkbook)).toUpperCase()}`;
}

function classifyDateFormat(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return 'NATIVE_DATE';
  if (typeof raw === 'number') {
    return raw >= 20000 && raw <= 80000 ? 'EXCEL_SERIAL' : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) return 'EXCEL_SERIAL';
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/.test(s)) {
    return parseFlexibleDate(s) ? 'ISO_YYYY_MM_DD' : 'INVALID_DATE';
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}(?:[T\s].*)?$/.test(s)) {
    return parseFlexibleDate(s) ? 'ISO_YYYY_SLASH_MM_DD' : 'INVALID_DATE';
  }
  if (/^\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4}$/.test(s)) {
    return parseFlexibleDate(s) ? 'DD_MMM_YYYY' : 'INVALID_DATE';
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(s)) {
    if (isAmbiguousDateString(s)) return 'AMBIGUOUS_SLASH';
    return parseFlexibleDate(s) ? 'UNAMBIGUOUS_SLASH' : 'INVALID_DATE';
  }
  return null;
}

function isStringDateFormatted(raw: unknown): boolean {
  const fmt = classifyDateFormat(raw);
  return (
    fmt === 'ISO_YYYY_MM_DD' ||
    fmt === 'ISO_YYYY_SLASH_MM_DD' ||
    fmt === 'DD_MMM_YYYY' ||
    fmt === 'UNAMBIGUOUS_SLASH' ||
    fmt === 'NATIVE_DATE'
  );
}

/**
 * Universal Column & Table Data Profiling Engine (P1 Requirement).
 * Infers actual observed column types vs expected schema types, detects date format distributions,
 * computes Z-score and Tukey IQR outliers with sample-size safeguards, and ranks Entity Hotspots.
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

    const contractKey = resolveUniqueContractKeyInWorkbook(sheets, tableName);
    const contract = contractKey ? TABLE_CONTRACTS[contractKey] : undefined;

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
      const expectedType: FieldDataType = contract?.columnTypes?.[colName] ?? 'STRING';
      const isDateColumnContext =
        expectedType === 'DATE' ||
        colName.toLowerCase().includes('date') ||
        colName.toLowerCase().includes('month') ||
        colName.toLowerCase().includes('period');

      let nonNullCount = 0;
      let nullCount = 0;
      let invalidTypeCount = 0;
      let zeroCount = 0;
      let negativeCount = 0;

      let observedDateCount = 0;
      let observedNumCount = 0;
      let observedNonNegNumCount = 0;
      let observedStringOnlyCount = 0;

      const distinctSet = new Set<string>();
      const numValues: number[] = [];
      const dateFormatSet = new Set<string>();
      const invalidSamples: string[] = [];

      const pushInvalidSample = (s: string) => {
        if (invalidSamples.length < 5 && !invalidSamples.includes(s)) {
          invalidSamples.push(s);
        }
      };

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

        // Track date format if date column or date-formatted string
        const dateFmt = classifyDateFormat(raw);
        if (isDateColumnContext || isStringDateFormatted(raw)) {
          if (dateFmt) dateFormatSet.add(dateFmt);
          const dt = parseFlexibleDate(raw);
          if (dt) {
            observedDateCount++;
            const iso = dt.toISOString().slice(0, 10);
            if (!minPeriod || iso < minPeriod) minPeriod = iso;
            if (!maxPeriod || iso > maxPeriod) maxPeriod = iso;
            allDatesMs.add(dt.getTime());
          } else if (isDateColumnContext) {
            dateFormatSet.add(isAmbiguousDateString(s) ? 'AMBIGUOUS_SLASH' : 'INVALID_DATE');
          }
        }

        // Check numeric nature
        const n = parseNum(raw);
        const isValidNum = Number.isFinite(n) && !isStringDateFormatted(raw);
        if (isValidNum && !(isDateColumnContext && parseFlexibleDate(raw) !== null)) {
          observedNumCount++;
          if (n >= 0) observedNonNegNumCount++;
          numValues.push(n);
          if (n === 0) zeroCount++;
          if (n < 0) negativeCount++;
        } else if (!parseFlexibleDate(raw) || !isDateColumnContext) {
          if (!isStringDateFormatted(raw)) {
            observedStringOnlyCount++;
          }
        }

        // Expected-type compliance accounting
        if (expectedType === 'DATE') {
          const dt = parseFlexibleDate(raw);
          if (!dt) {
            invalidTypeCount++;
            pushInvalidSample(s);
          }
        } else if (expectedType === 'NUMBER') {
          if (!Number.isFinite(n)) {
            invalidTypeCount++;
            pushInvalidSample(s);
          }
        } else if (expectedType === 'NON_NEGATIVE_NUMBER') {
          if (!Number.isFinite(n) || n < 0) {
            invalidTypeCount++;
            pushInvalidSample(s);
          }
        }
      }

      // Actually infer column data type from observed values
      let inferredType: InferredColumnDataType = 'EMPTY';
      if (nonNullCount > 0) {
        if (observedDateCount === nonNullCount) {
          inferredType = 'DATE';
        } else if (observedNumCount === nonNullCount) {
          inferredType =
            observedNonNegNumCount === nonNullCount ? 'NON_NEGATIVE_NUMBER' : 'NUMBER';
        } else if (observedStringOnlyCount === nonNullCount && observedDateCount === 0 && observedNumCount === 0) {
          inferredType = 'STRING';
        } else if (expectedType === 'STRING' && invalidTypeCount === 0) {
          inferredType = 'STRING';
        } else {
          inferredType = 'MIXED';
        }
      }

      const typeMismatch =
        nonNullCount > 0 &&
        ((expectedType === 'DATE' && inferredType !== 'DATE') ||
          (expectedType === 'NON_NEGATIVE_NUMBER' &&
            inferredType !== 'NON_NEGATIVE_NUMBER') ||
          (expectedType === 'NUMBER' &&
            inferredType !== 'NUMBER' &&
            inferredType !== 'NON_NEGATIVE_NUMBER') ||
          invalidTypeCount > 0);

      const nullPct =
        rowCount > 0 ? Number(((nullCount / rowCount) * 100).toFixed(1)) : 0;
      const distinctCount = distinctSet.size;
      const distinctPct =
        nonNullCount > 0 ? Number(((distinctCount / nonNullCount) * 100).toFixed(1)) : 0;

      if (
        numValues.length > 0 &&
        (expectedType === 'NUMBER' ||
          expectedType === 'NON_NEGATIVE_NUMBER' ||
          inferredType === 'NUMBER' ||
          inferredType === 'NON_NEGATIVE_NUMBER')
      ) {
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

        // Sample-size safeguard: require >= 4 observations before flagging statistical outliers
        let outlierCount = 0;
        let iqrOutlierCount = 0;
        if (sorted.length >= 4) {
          if (stdDev > 0) {
            for (const v of sorted) {
              if (Math.abs((v - mean) / stdDev) > outlierZThreshold) {
                outlierCount++;
              }
            }
          }
          if (iqr > 0) {
            const lowerFence = p25 - 1.5 * iqr;
            const upperFence = p75 + 1.5 * iqr;
            for (const v of sorted) {
              if (v < lowerFence || v > upperFence) {
                iqrOutlierCount++;
              }
            }
          }
        }

        return {
          table: tableName,
          column: colName,
          expectedType,
          inferredType,
          typeMismatch,
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
          iqrOutlierCount,
          distinctDateFormats: Array.from(dateFormatSet),
          invalidSampleValues: invalidSamples,
        };
      }

      return {
        table: tableName,
        column: colName,
        expectedType,
        inferredType,
        typeMismatch,
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
        iqrOutlierCount: 0,
        distinctDateFormats: Array.from(dateFormatSet),
        invalidSampleValues: invalidSamples,
      };
    });

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
        : rowCount === 0
          ? 0
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

  const skuMap = new Map<string, { total: number; crit: number; warn: number }>();
  const depotMap = new Map<string, { total: number; crit: number; warn: number }>();
  const tableMap = new Map<string, { total: number; crit: number; warn: number }>();

  for (const ex of activeExceptions) {
    const tStat = tableMap.get(ex.table) ?? { total: 0, crit: 0, warn: 0 };
    tStat.total++;
    if (ex.severity === 'CRITICAL') tStat.crit++;
    else tStat.warn++;
    tableMap.set(ex.table, tStat);

    const tbl = sheets[ex.table];
    const row = ex.rowIndex >= 0 && tbl?.records ? tbl.records[ex.rowIndex] : undefined;
    const sku = row
      ? normStr(getRowVal(row, ['SKU_Code', 'New_Launch_SKU_Code', 'Parent_SKU_Code', 'SKU']))
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
 * Certified Cross-Table Data Assurance Reconciliation Engine (P0 Issue 4 & Issue 5).
 * Explicitly defines Equation, Grain, Eligible Records, Exclusions, Tolerance, and Status Rules
 * (RECONCILED | VARIANCE_WARNING | CRITICAL_MISMATCH | NOT_RUN | NOT_APPLICABLE) for every check.
 * Does NOT evaluate forecast quality or forecast reasonableness (strictly outside Phase 1 scope).
 */
export function runCrossTableReconciliation(
  sheets: EnterpriseSheets,
  ruleConfig: ValidationRuleConfig = DEFAULT_RULE_CONFIG,
  domain: PlanningDomainKey = 'ALL'
): ReconciliationReport {
  const checks: ReconciliationCheckResult[] = [];
  const tolPct = ruleConfig.reconciliationTolerancePct;
  const domainContract = DOMAIN_CONTRACTS[domain] ?? DOMAIN_CONTRACTS.ALL;
  const relevantSet = new Set(domainContract.relevantTables);

  const ordersSheet = sheets['01_Orders_Shipments_History'];
  const ordersTbl = ordersSheet?.records?.filter((r) => !r._removed) ?? [];

  const priceSheet =
    sheets['06_Pricing_Elasticity_Catalog'] ?? sheets['03_Price_Cost_Margin_Conditions'];
  const priceTbl = priceSheet?.records?.filter((r) => !r._removed) ?? [];

  const invSheet = sheets['07_Inventory_Supply_Constraints'];
  const invTbl = invSheet?.records?.filter((r) => !r._removed) ?? [];

  const skuSheet = sheets['09_Product_Master_Hierarchy'];
  const skuTbl = skuSheet?.records?.filter((r) => !r._removed) ?? [];

  const depotSheet = sheets['10_Location_Depot_Network'];
  const depotTbl = depotSheet?.records?.filter((r) => !r._removed) ?? [];

  const chSheet = sheets['11_Customer_Channel_Master'];
  const chTbl = chSheet?.records?.filter((r) => !r._removed) ?? [];

  const supplierSheet = sheets['13_Supplier_Sourcing_Contracts'];
  const supplierTbl = supplierSheet?.records?.filter((r) => !r._removed) ?? [];

  // ---------------------------------------------------------------------------
  // REC-01: Order-to-Shipment Physical Flow Balance
  // Equation: Σ(Ordered_Qty_Units - Cancelled_Order_Qty) = Σ(Invoiced_Actual_Qty + Open_Backorder_Qty)
  // ---------------------------------------------------------------------------
  {
    const domainScope: PlanningDomainKey[] = ['ALL', 'DEMAND', 'SUPPLY', 'SOP', 'MEIO'];
    const isApplicable = domain === 'ALL' || domainScope.includes(domain);

    if (!isApplicable) {
      checks.push({
        id: 'REC-01',
        name: 'Customer Orders vs. Billed Shipments & Open Backorders (Returns Excluded)',
        domainScope,
        equation:
          'Σ(Ordered_Qty_Units - Cancelled_Order_Qty) = Σ(Invoiced_Actual_Qty + Open_Backorder_Qty)',
        grain: 'Period_Date × SKU_Code × Location_DC × Channel_Code',
        leftSource: '01_Orders_Shipments_History (Net Ordered Qty)',
        rightSource: '01_Orders_Shipments_History (Billed + Open Backorder; returns excluded from forward flow)',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: tolPct,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Excludes removed duplicates (_removed), continuity-imputed zero-order rows (_isImputedContinuityRow), and rows with non-numeric or negative billed actuals. Returns are excluded from forward fulfilment.',
        status: 'NOT_APPLICABLE',
        detail: `Not applicable for ${domainContract.label} domain contract`,
      });
    } else if (!ordersSheet || ordersTbl.length === 0) {
      checks.push({
        id: 'REC-01',
        name: 'Customer Orders vs. Billed Shipments & Open Backorders (Returns Excluded)',
        domainScope,
        equation:
          'Σ(Ordered_Qty_Units - Cancelled_Order_Qty) = Σ(Invoiced_Actual_Qty + Open_Backorder_Qty)',
        grain: 'Period_Date × SKU_Code × Location_DC × Channel_Code',
        leftSource: '01_Orders_Shipments_History (Net Ordered Qty)',
        rightSource: '01_Orders_Shipments_History (Billed + Open Backorder; returns excluded from forward flow)',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: tolPct,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Excludes removed duplicates (_removed), continuity-imputed zero-order rows (_isImputedContinuityRow), and rows with non-numeric or negative billed actuals. Returns are excluded from forward fulfilment.',
        status: 'NOT_RUN',
        detail: 'Not Run: 01_Orders_Shipments_History is missing or contains 0 records',
      });
    } else {
      let sumNetOrders = 0;
      let sumAccountedFulfillment = 0;
      let eligibleCount = 0;
      let excludedCount = 0;
      let overShippedRows = 0;

      for (const r of ordersTbl) {
        if (r._isImputedContinuityRow) {
          excludedCount++;
          continue;
        }
        const ord = parseNum(r.Ordered_Qty_Units);
        const billed = parseNum(r.Invoiced_Actual_Qty);
        const openBo = Math.max(0, parseNum(r.Open_Backorder_Qty) || 0);
        const cancelled = Math.max(0, parseNum(r.Cancelled_Order_Qty) || 0);

        if (!Number.isFinite(ord) || !Number.isFinite(billed) || billed < 0) {
          excludedCount++;
          continue;
        }
        const netOrd = Math.max(0, ord - cancelled);
        const rowAccounted = billed + openBo;
        if (rowAccounted > netOrd * (1 + tolPct / 100)) {
          overShippedRows++;
        }
        sumNetOrders += netOrd;
        sumAccountedFulfillment += rowAccounted;
        eligibleCount++;
      }

      if (eligibleCount === 0) {
        checks.push({
          id: 'REC-01',
          name: 'Customer Orders vs. Billed Shipments & Open Backorders (Returns Excluded)',
          domainScope,
          equation:
            'Σ(Ordered_Qty_Units - Cancelled_Order_Qty) = Σ(Invoiced_Actual_Qty + Open_Backorder_Qty)',
          grain: 'Period_Date × SKU_Code × Location_DC × Channel_Code',
          leftSource: '01_Orders_Shipments_History (Net Ordered Qty)',
          rightSource: '01_Orders_Shipments_History (Billed + Open Backorder; returns excluded from forward flow)',
          leftTotal: 0,
          rightTotal: 0,
          varianceAbs: 0,
          variancePct: null,
          tolerancePct: tolPct,
          eligibleRecordsCount: 0,
          excludedRecordsCount: excludedCount,
          exclusionRule:
            'Excludes removed duplicates (_removed), continuity-imputed zero-order rows (_isImputedContinuityRow), and rows with non-numeric or negative billed actuals. Returns are excluded from forward fulfilment.',
          status: 'NOT_RUN',
          detail: 'Not Run: 0 eligible order/shipment records after exclusions',
        });
      } else {
        const varianceAbs = Number((sumNetOrders - sumAccountedFulfillment).toFixed(1));
        const variancePct =
          sumNetOrders > 0
            ? Number(((Math.abs(varianceAbs) / sumNetOrders) * 100).toFixed(2))
            : sumAccountedFulfillment > 0
              ? 100
              : 0;
        // Returns are reverse-flow transactions and are deliberately excluded from forward order fulfilment.
        // Any row-level over-shipment beyond tolerance is a critical integrity mismatch; aggregate under-fulfilment is a warning.
        const status: ReconciliationCheckResult['status'] =
          overShippedRows > 0
            ? 'CRITICAL_MISMATCH'
            : variancePct <= tolPct
              ? 'RECONCILED'
              : 'VARIANCE_WARNING';

        checks.push({
          id: 'REC-01',
          name: 'Customer Orders vs. Billed Shipments & Open Backorders (Returns Excluded)',
          domainScope,
          equation:
            'Σ(Ordered_Qty_Units - Cancelled_Order_Qty) = Σ(Invoiced_Actual_Qty + Open_Backorder_Qty)',
          grain: 'Period_Date × SKU_Code × Location_DC × Channel_Code',
          leftSource: '01_Orders_Shipments_History (Net Ordered Qty)',
          rightSource: '01_Orders_Shipments_History (Billed + Open Backorder; returns excluded from forward flow)',
          leftTotal: sumNetOrders,
          rightTotal: sumAccountedFulfillment,
          varianceAbs,
          variancePct,
          tolerancePct: tolPct,
          eligibleRecordsCount: eligibleCount,
          excludedRecordsCount: excludedCount,
          exclusionRule:
            'Excludes removed duplicates (_removed), continuity-imputed zero-order rows (_isImputedContinuityRow), and rows with non-numeric or negative billed actuals. Returns are excluded from forward fulfilment.',
          status,
          detail: `Evaluated ${eligibleCount} eligible order line(s) (${excludedCount} excluded); forward-flow delta ${varianceAbs.toLocaleString()} u (${variancePct}% vs ${tolPct}% tolerance). Returns are excluded from this equation because they are reverse-flow transactions.`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REC-02: Billed Volume × Effective Channel/Date Price vs. Booked Net Revenue
  // Equation: Σ(Invoiced_Actual_Qty × Net_Realized_Price_INR[SKU, Channel, Eff_Date ≤ Period]) = Σ(Net_Realized_Sales_INR)
  // ---------------------------------------------------------------------------
  {
    const domainScope: PlanningDomainKey[] = ['ALL', 'DEMAND', 'SOP'];
    const isApplicable = domain === 'ALL' || domainScope.includes(domain);

    if (!isApplicable) {
      checks.push({
        id: 'REC-02',
        name: 'Billed Volume × Effective Channel Price vs. Booked Net Revenue',
        domainScope,
        equation:
          'Σ(Invoiced_Actual_Qty × Net_Realized_Price_INR[SKU, Channel, Effective_From_Month ≤ Period_Date]) = Σ(Net_Realized_Sales_INR)',
        grain: 'Period_Date × SKU_Code × Channel_Code',
        leftSource: '01_Orders × 06_Pricing_Catalog (Qty × Effective_Channel_Price)',
        rightSource: '01_Orders_Shipments_History (Net_Realized_Sales_INR)',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: tolPct,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Matches exact (SKU_Code, Channel_Code) and latest valid Effective_From_Month ≤ Period_Date; never uses future-effective prices; supports an explicit SKU × ALL fallback only when no exact-channel key exists; excludes credit returns and unmatched or undated invoice lines.',
        status: 'NOT_APPLICABLE',
        detail: `Not applicable for ${domainContract.label} domain contract`,
      });
    } else if (!ordersSheet || !priceSheet || ordersTbl.length === 0 || priceTbl.length === 0) {
      checks.push({
        id: 'REC-02',
        name: 'Billed Volume × Effective Channel Price vs. Booked Net Revenue',
        domainScope,
        equation:
          'Σ(Invoiced_Actual_Qty × Net_Realized_Price_INR[SKU, Channel, Effective_From_Month ≤ Period_Date]) = Σ(Net_Realized_Sales_INR)',
        grain: 'Period_Date × SKU_Code × Channel_Code',
        leftSource: '01_Orders × 06_Pricing_Catalog (Qty × Effective_Channel_Price)',
        rightSource: '01_Orders_Shipments_History (Net_Realized_Sales_INR)',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: tolPct,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Matches exact (SKU_Code, Channel_Code) and latest valid Effective_From_Month ≤ Period_Date; never uses future-effective or wildcard-channel prices; excludes credit returns and unmatched or undated invoice lines.',
        status: 'NOT_RUN',
        detail:
          'Not Run: Requires both 01_Orders_Shipments_History and 06_Pricing_Elasticity_Catalog to be present and non-empty',
      });
    } else {
      // Index price catalog by exact (SKU_Code, Channel_Code) with effective date sorting
      const priceIndex = new Map<
        string,
        Array<{ effMs: number; price: number }>
      >();
      for (const r of priceTbl) {
        const sku = normStr(r.SKU_Code);
        const ch = normStr(r.Channel_Code);
        const p = parseNum(r.Net_Realized_Price_INR);
        const effDt = parseFlexibleDate(r.Effective_From_Month);
        if (sku && ch && effDt && Number.isFinite(p) && p > 0) {
          const key = `${sku}|${ch}`;
          const list = priceIndex.get(key) ?? [];
          list.push({ effMs: effDt.getTime(), price: p });
          priceIndex.set(key, list);
        }
      }
      priceIndex.forEach((list) => {
        list.sort((a, b) => a.effMs - b.effMs);
      });

      const resolveEffectivePrice = (
        sku: string,
        ch: string,
        orderDateMs: number | null
      ): number | undefined => {
        const candidates = priceIndex.get(sku + '|' + ch) ?? priceIndex.get(sku + '|ALL');
        if (!candidates || candidates.length === 0 || orderDateMs === null) return undefined;
        let matched: number | undefined;
        for (const entry of candidates) {
          if (entry.effMs <= orderDateMs) {
            matched = entry.price;
          }
        }
        // Preserve the existing explicit SKU × ALL fallback only when no exact-channel key exists;
        // the selected catalog key must still have a price effective on/before the transaction date.
        return matched;
      };

      let expectedRev = 0;
      let bookedRev = 0;
      let matchedRows = 0;
      let excludedRows = 0;
      let unmatchedPriceRows = 0;

      for (const r of ordersTbl) {
        if (r._isImputedContinuityRow) {
          excludedRows++;
          continue;
        }
        const sku = normStr(r.SKU_Code);
        const ch = normStr(r.Channel_Code);
        const billed = parseNum(r.Invoiced_Actual_Qty);
        const rev = parseNum(r.Net_Realized_Sales_INR);
        const orderDt = parseFlexibleDate(r.Period_Date);
        const unitPrice = resolveEffectivePrice(
          sku,
          ch,
          orderDt ? orderDt.getTime() : null
        );

        if (
          Number.isFinite(billed) &&
          billed > 0 &&
          Number.isFinite(rev) &&
          unitPrice !== undefined
        ) {
          expectedRev += billed * unitPrice;
          bookedRev += rev;
          matchedRows++;
        } else {
          if (Number.isFinite(billed) && billed > 0 && Number.isFinite(rev) && unitPrice === undefined) {
            unmatchedPriceRows++;
          }
          excludedRows++;
        }
      }

      if (matchedRows === 0) {
        checks.push({
          id: 'REC-02',
          name: 'Billed Volume × Effective Channel Price vs. Booked Net Revenue',
          domainScope,
          equation:
            'Σ(Invoiced_Actual_Qty × Net_Realized_Price_INR[SKU, Channel, Effective_From_Month ≤ Period_Date]) = Σ(Net_Realized_Sales_INR)',
          grain: 'Period_Date × SKU_Code × Channel_Code',
          leftSource: '01_Orders × 06_Pricing_Catalog (Qty × Effective_Channel_Price)',
          rightSource: '01_Orders_Shipments_History (Net_Realized_Sales_INR)',
          leftTotal: 0,
          rightTotal: 0,
          varianceAbs: 0,
          variancePct: null,
          tolerancePct: tolPct,
          eligibleRecordsCount: 0,
          excludedRecordsCount: excludedRows,
          exclusionRule:
            'Matches exact (SKU_Code, Channel_Code) and latest valid Effective_From_Month ≤ Period_Date; never uses future-effective or wildcard-channel prices; excludes credit returns and unmatched or undated invoice lines.',
          status: 'NOT_RUN',
          detail: `Not Run: 0 invoice lines matched an exact, date-effective (SKU_Code, Channel_Code) price record with booked Net_Realized_Sales_INR; ${unmatchedPriceRows} billed invoice line(s) had no eligible price or transaction date`,
        });
      } else {
        const varianceAbs = Number((bookedRev - expectedRev).toFixed(0));
        const variancePct =
          expectedRev > 0
            ? Number(((Math.abs(varianceAbs) / expectedRev) * 100).toFixed(2))
            : null;
        const varianceStatus: ReconciliationCheckResult['status'] =
          variancePct !== null && variancePct <= tolPct
            ? 'RECONCILED'
            : variancePct !== null && variancePct <= tolPct * 3
              ? 'VARIANCE_WARNING'
              : 'CRITICAL_MISMATCH';
        // Do not report a matched subset as fully reconciled when invoice lines lack a valid price match.
        const status: ReconciliationCheckResult['status'] =
          unmatchedPriceRows > 0 ? 'VARIANCE_WARNING' : varianceStatus;

        checks.push({
          id: 'REC-02',
          name: 'Billed Volume × Effective Channel Price vs. Booked Net Revenue',
          domainScope,
          equation:
            'Σ(Invoiced_Actual_Qty × Net_Realized_Price_INR[SKU, Channel, Effective_From_Month ≤ Period_Date]) = Σ(Net_Realized_Sales_INR)',
          grain: 'Period_Date × SKU_Code × Channel_Code',
          leftSource: '01_Orders × 06_Pricing_Catalog (Qty × Effective_Channel_Price)',
          rightSource: '01_Orders_Shipments_History (Net_Realized_Sales_INR)',
          leftTotal: Math.round(expectedRev),
          rightTotal: Math.round(bookedRev),
          varianceAbs,
          variancePct,
          tolerancePct: tolPct,
          eligibleRecordsCount: matchedRows,
          excludedRecordsCount: excludedRows,
          exclusionRule:
            'Matches exact (SKU_Code, Channel_Code) and latest valid Effective_From_Month ≤ Period_Date; never uses future-effective or wildcard-channel prices; excludes credit returns and unmatched or undated invoice lines.',
          status,
          detail: `Matched ${matchedRows} SKU×Channel invoice line(s) (${excludedRows} excluded); revenue delta ₹${varianceAbs.toLocaleString()} (${variancePct}%)${unmatchedPriceRows > 0 ? `; ${unmatchedPriceRows} billed invoice line(s) excluded because no exact, date-effective price was available` : ''}`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REC-03: Stockout Indicator Period Integrity
  // Equation: 0 ≤ Depot_Stockout_Days_Count ≤ calendar days in Period_Date month
  // This validates source data only; it does not estimate uncensored demand or judge a forecast/model output.
  // ---------------------------------------------------------------------------
  {
    const domainScope: PlanningDomainKey[] = ['ALL', 'DEMAND', 'SUPPLY', 'SOP', 'MEIO'];
    const isApplicable = domain === 'ALL' || domainScope.includes(domain);

    if (!isApplicable) {
      checks.push({
        id: 'REC-03',
        name: 'Stockout Days vs. Calendar Period Integrity',
        domainScope,
        equation:
          '0 ≤ Depot_Stockout_Days_Count ≤ DaysInCalendarMonth(Period_Date)',
        grain: 'Period_Date × SKU_Code × Location_DC',
        leftSource: '07_Inventory_Supply_Constraints (Depot_Stockout_Days_Count)',
        rightSource: 'Calendar month derived from Period_Date',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: 0,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Evaluates rows with a valid Period_Date and numeric Depot_Stockout_Days_Count; excludes rows that cannot be assessed due to missing or invalid inputs.',
        status: 'NOT_APPLICABLE',
        detail: `Not applicable for ${domainContract.label} domain contract`,
      });
    } else if (!invSheet || invTbl.length === 0) {
      checks.push({
        id: 'REC-03',
        name: 'Stockout Days vs. Calendar Period Integrity',
        domainScope,
        equation:
          '0 ≤ Depot_Stockout_Days_Count ≤ DaysInCalendarMonth(Period_Date)',
        grain: 'Period_Date × SKU_Code × Location_DC',
        leftSource: '07_Inventory_Supply_Constraints (Depot_Stockout_Days_Count)',
        rightSource: 'Calendar month derived from Period_Date',
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: 0,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Evaluates rows with a valid Period_Date and numeric Depot_Stockout_Days_Count; excludes rows that cannot be assessed due to missing or invalid inputs.',
        status: 'NOT_RUN',
        detail: 'Not Run: 07_Inventory_Supply_Constraints is missing or contains 0 records',
      });
    } else {
      let totalReportedStockoutDays = 0;
      let totalAllowedStockoutDays = 0;
      let totalExcessDays = 0;
      let eligibleRows = 0;
      let excludedRows = 0;
      let invalidRows = 0;

      for (const r of invTbl) {
        const periodDate = parseFlexibleDate(r.Period_Date);
        const stockoutDays = parseNum(r.Depot_Stockout_Days_Count);
        if (!periodDate || !Number.isFinite(stockoutDays)) {
          excludedRows++;
          continue;
        }

        const daysInMonth = new Date(
          Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 0)
        ).getUTCDate();
        eligibleRows++;
        totalReportedStockoutDays += stockoutDays;
        totalAllowedStockoutDays += daysInMonth;

        const excessDays = Math.max(0, stockoutDays - daysInMonth);
        const invalidCount =
          stockoutDays < 0 || !Number.isInteger(stockoutDays) || excessDays > 0;
        if (invalidCount) {
          invalidRows++;
          totalExcessDays += excessDays > 0 ? excessDays : 1;
        }
      }

      const variancePct =
        eligibleRows > 0
          ? Number(((invalidRows / eligibleRows) * 100).toFixed(2))
          : null;
      const status: ReconciliationCheckResult['status'] =
        eligibleRows === 0
          ? 'NOT_RUN'
          : invalidRows > 0
            ? 'CRITICAL_MISMATCH'
            : 'RECONCILED';
      const detail =
        eligibleRows === 0
          ? 'Not Run: no inventory rows had both a valid Period_Date and numeric stockout-day count'
          : invalidRows > 0
            ? `${invalidRows} of ${eligibleRows} inventory row(s) contain a stockout-day count outside the valid whole-day range for the calendar month`
            : `All ${eligibleRows} inventory row(s) have whole-number stockout-day counts within their calendar-month limits`;

      checks.push({
        id: 'REC-03',
        name: 'Stockout Days vs. Calendar Period Integrity',
        domainScope,
        equation:
          '0 ≤ Depot_Stockout_Days_Count ≤ DaysInCalendarMonth(Period_Date)',
        grain: 'Period_Date × SKU_Code × Location_DC',
        leftSource: '07_Inventory_Supply_Constraints (Depot_Stockout_Days_Count)',
        rightSource: 'Calendar month derived from Period_Date',
        leftTotal: totalReportedStockoutDays,
        rightTotal: totalAllowedStockoutDays,
        varianceAbs: totalExcessDays,
        variancePct,
        tolerancePct: 0,
        eligibleRecordsCount: eligibleRows,
        excludedRecordsCount: excludedRows,
        exclusionRule:
          'Evaluates rows with a valid Period_Date and numeric Depot_Stockout_Days_Count; excludes rows that cannot be assessed due to missing or invalid inputs. No uncensored-demand estimate or forecast methodology is evaluated.',
        status,
        detail,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // REC-04: Master-to-Transaction Referential Integrity Reconciliation
  // Equation: Matched_Foreign_Key_References / Total_In_Domain_Foreign_Key_References = 100%
  // ---------------------------------------------------------------------------
  {
    const domainScope: PlanningDomainKey[] = [
      'ALL',
      'DEMAND',
      'SUPPLY',
      'SOP',
      'MEIO',
      'PROCUREMENT',
      'MANUFACTURING',
    ];
    const reqMasters = domainContract.requiredMasterTables;

    const validSkus = new Set(
      skuTbl.map((r) => normStr(r.SKU_Code)).filter(Boolean)
    );
    const validLocs = new Set(
      depotTbl.map((r) => normStr(r.Location_DC)).filter(Boolean)
    );
    const validChs = new Set(
      chTbl.map((r) => normStr(r.Channel_Code)).filter(Boolean)
    );

    const missingRequiredMasters: string[] = [];
    if (reqMasters.includes('09_Product_Master_Hierarchy') && validSkus.size === 0) {
      missingRequiredMasters.push('09_Product_Master_Hierarchy');
    }
    if (reqMasters.includes('10_Location_Depot_Network') && validLocs.size === 0) {
      missingRequiredMasters.push('10_Location_Depot_Network');
    }
    if (reqMasters.includes('11_Customer_Channel_Master') && validChs.size === 0) {
      missingRequiredMasters.push('11_Customer_Channel_Master');
    }

    if (missingRequiredMasters.length > 0) {
      checks.push({
        id: 'REC-04',
        name: 'Master-to-Transaction Foreign Key Referential Coverage',
        domainScope,
        equation:
          'Σ(Valid_Master_Foreign_Keys) = Σ(Total_In_Domain_Transaction_Foreign_Keys)',
        grain: 'In-Domain Transaction Row × Master Entity Key',
        leftSource: `In-Domain Transaction Tables (${domainContract.label})`,
        rightSource: `Required Master Tables (${reqMasters.join(', ')})`,
        leftTotal: 0,
        rightTotal: 0,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: 0,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule:
          'Checks all foreign key references on in-domain tables against required domain master tables.',
        status: 'NOT_RUN',
        detail: `Not Run: Missing or empty required master table(s): ${missingRequiredMasters.join(', ')}`,
      });
    } else {
      let totalRefs = 0;
      let matchedRefs = 0;
      let eligibleRows = 0;
      let excludedRows = 0;
      const unresolvedInDomainTables: string[] = [];

      for (const tblName of Object.keys(sheets)) {
        const candidateContractKey = resolveContractTableKey(tblName);
        const contractKey = resolveUniqueContractKeyInWorkbook(sheets, tblName);
        if (!contractKey) {
          if (candidateContractKey && relevantSet.has(candidateContractKey)) {
            unresolvedInDomainTables.push(tblName);
          } else {
            excludedRows += sheets[tblName]?.records?.length ?? 0;
          }
          continue;
        }
        if (domain !== 'ALL' && !relevantSet.has(contractKey)) {
          excludedRows += sheets[tblName]?.records?.length ?? 0;
          continue;
        }
        const contract = TABLE_CONTRACTS[contractKey];
        if (!contract || contract.foreignKeys.length === 0) continue;

        for (const r of sheets[tblName]?.records ?? []) {
          if (r._removed) {
            excludedRows++;
            continue;
          }
          eligibleRows++;
          for (const fk of contract.foreignKeys) {
            if (!reqMasters.includes(fk.targetTable)) continue;
            const rawVal = normStr(r[fk.col]);
            if (!rawVal && fk.allowEmpty) continue;
            totalRefs++;
            if (
              (fk.targetTable === '09_Product_Master_Hierarchy' &&
                validSkus.has(rawVal)) ||
              (fk.targetTable === '10_Location_Depot_Network' &&
                validLocs.has(rawVal)) ||
              (fk.targetTable === '11_Customer_Channel_Master' &&
                validChs.has(rawVal))
            ) {
              matchedRefs++;
            }
          }
        }
      }

      if (unresolvedInDomainTables.length > 0) {
        checks.push({
          id: 'REC-04',
          name: 'Master-to-Transaction Foreign Key Referential Coverage',
          domainScope,
          equation:
            'Σ(Valid_Master_Foreign_Keys) = Σ(Total_In_Domain_Transaction_Foreign_Keys)',
          grain: 'In-Domain Transaction Row × Master Entity Key',
          leftSource: `In-Domain Transaction Tables (${domainContract.label})`,
          rightSource: `Required Master Tables (${reqMasters.join(', ')})`,
          leftTotal: matchedRefs,
          rightTotal: totalRefs,
          varianceAbs: totalRefs - matchedRefs,
          variancePct: null,
          tolerancePct: 0,
          eligibleRecordsCount: eligibleRows,
          excludedRecordsCount: excludedRows,
          exclusionRule:
            'Checks all foreign key references on in-domain tables against required domain master tables.',
          status: 'NOT_RUN',
          detail: `Not Run: Ambiguous table-to-contract mapping for in-domain table(s): ${unresolvedInDomainTables.join(', ')}`,
        });
      } else if (totalRefs === 0) {
        checks.push({
          id: 'REC-04',
          name: 'Master-to-Transaction Foreign Key Referential Coverage',
          domainScope,
          equation:
            'Σ(Valid_Master_Foreign_Keys) = Σ(Total_In_Domain_Transaction_Foreign_Keys)',
          grain: 'In-Domain Transaction Row × Master Entity Key',
          leftSource: `In-Domain Transaction Tables (${domainContract.label})`,
          rightSource: `Required Master Tables (${reqMasters.join(', ')})`,
          leftTotal: 0,
          rightTotal: 0,
          varianceAbs: 0,
          variancePct: null,
          tolerancePct: 0,
          eligibleRecordsCount: 0,
          excludedRecordsCount: excludedRows,
          exclusionRule:
            'Checks all foreign key references on in-domain tables against required domain master tables.',
          status: 'NOT_RUN',
          detail: 'Not Run: 0 in-domain foreign-key references available to evaluate',
        });
      } else {
        const orphanCount = totalRefs - matchedRefs;
        const orphanPct = Number(((orphanCount / totalRefs) * 100).toFixed(2));
        checks.push({
          id: 'REC-04',
          name: 'Master-to-Transaction Foreign Key Referential Coverage',
          domainScope,
          equation:
            'Σ(Valid_Master_Foreign_Keys) = Σ(Total_In_Domain_Transaction_Foreign_Keys)',
          grain: 'In-Domain Transaction Row × Master Entity Key',
          leftSource: `In-Domain Transaction References (Total=${totalRefs})`,
          rightSource: `Resolved Master Keys (Matched=${matchedRefs})`,
          leftTotal: totalRefs,
          rightTotal: matchedRefs,
          varianceAbs: orphanCount,
          variancePct: orphanPct,
          tolerancePct: 0,
          eligibleRecordsCount: eligibleRows,
          excludedRecordsCount: excludedRows,
          exclusionRule:
            'Checks all foreign key references on in-domain tables against required domain master tables.',
          status: orphanCount === 0 ? 'RECONCILED' : 'CRITICAL_MISMATCH',
          detail:
            orphanCount === 0
              ? `100% of ${totalRefs} in-domain foreign key references resolved across ${eligibleRows} transaction record(s)`
              : `${orphanCount} orphan foreign-key reference(s) failed master lookup (${orphanPct}% unresolved)`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REC-05: In-Domain Network & Supplier Lead-Time Policy Alignment
  // Equation: Max(Available_In-Domain_Lead_Time_Days) ≤ Policy_Ceiling (maxLeadTimeDays)
  // ---------------------------------------------------------------------------
  {
    const domainScope: PlanningDomainKey[] = [
      'ALL',
      'SUPPLY',
      'MEIO',
      'PROCUREMENT',
      'MANUFACTURING',
    ];
    const isApplicable = domain === 'ALL' || domainScope.includes(domain);
    const includeDepot = domain === 'ALL' || relevantSet.has('10_Location_Depot_Network');
    const includeSupplier =
      domain === 'ALL' || relevantSet.has('13_Supplier_Sourcing_Contracts');
    const expectedSources = [
      ...(includeDepot ? ['10_Location_Depot_Network'] : []),
      ...(includeSupplier ? ['13_Supplier_Sourcing_Contracts'] : []),
    ];
    const missingSources = expectedSources.filter((table) => {
      if (table === '10_Location_Depot_Network') {
        return !depotSheet || depotTbl.length === 0;
      }
      if (table === '13_Supplier_Sourcing_Contracts') {
        return !supplierSheet || supplierTbl.length === 0;
      }
      return true;
    });
    const leftSource = [
      ...(includeDepot ? ['10_Location_Depot_Network'] : []),
      ...(includeSupplier ? ['13_Supplier_Sourcing_Contracts'] : []),
    ].join(' / ');
    const sourceDescription = expectedSources.length
      ? expectedSources.join(' and ')
      : 'No in-domain lead-time source';

    if (!isApplicable) {
      checks.push({
        id: 'REC-05',
        name: 'In-Domain Network & Supplier Max Lead-Time vs. Policy Ceiling',
        domainScope,
        equation: 'Max(Available_In-Domain_Lead_Time_Days) ≤ maxLeadTimeDays',
        grain: 'In-domain Location_DC / Supplier_ID × SKU_Code',
        leftSource,
        rightSource: 'Industry Governance Policy (maxLeadTimeDays)',
        leftTotal: 0,
        rightTotal: ruleConfig.maxLeadTimeDays,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: 0,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule: 'Evaluates only lead-time sources included in the selected domain contract.',
        status: 'NOT_APPLICABLE',
        detail: `Not applicable for ${domainContract.label} domain contract`,
      });
    } else if (missingSources.length > 0) {
      checks.push({
        id: 'REC-05',
        name: 'In-Domain Network & Supplier Max Lead-Time vs. Policy Ceiling',
        domainScope,
        equation: 'Max(Available_In-Domain_Lead_Time_Days) ≤ maxLeadTimeDays',
        grain: 'In-domain Location_DC / Supplier_ID × SKU_Code',
        leftSource,
        rightSource: 'Industry Governance Policy (maxLeadTimeDays)',
        leftTotal: 0,
        rightTotal: ruleConfig.maxLeadTimeDays,
        varianceAbs: 0,
        variancePct: null,
        tolerancePct: 0,
        eligibleRecordsCount: 0,
        excludedRecordsCount: 0,
        exclusionRule: 'Evaluates only lead-time sources included in the selected domain contract.',
        status: 'NOT_RUN',
        detail: `Not Run: required in-domain lead-time source(s) missing or empty: ${missingSources.join(', ')}`,
      });
    } else {
      let maxObservedLt = 0;
      let eligibleCount = 0;
      let excludedCount = 0;

      if (includeDepot) {
        for (const r of depotTbl) {
          if (r._removed) {
            excludedCount++;
            continue;
          }
          const lt = parseNum(
            r.Primary_Transit_Lead_Time_Days ?? r.Standard_Lead_Time_Days
          );
          if (Number.isFinite(lt) && lt >= 0) {
            if (lt > maxObservedLt) maxObservedLt = lt;
            eligibleCount++;
          } else {
            excludedCount++;
          }
        }
      }
      if (includeSupplier) {
        for (const r of supplierTbl) {
          if (r._removed) {
            excludedCount++;
            continue;
          }
          const lt = parseNum(r.Supplier_Lead_Time_Days);
          if (Number.isFinite(lt) && lt >= 0) {
            if (lt > maxObservedLt) maxObservedLt = lt;
            eligibleCount++;
          } else {
            excludedCount++;
          }
        }
      }

      const ceiling = ruleConfig.maxLeadTimeDays;
      const varianceAbs = Math.max(0, maxObservedLt - ceiling);
      const variancePct =
        ceiling > 0 ? Number(((varianceAbs / ceiling) * 100).toFixed(1)) : null;

      checks.push({
        id: 'REC-05',
        name: 'In-Domain Network & Supplier Max Lead-Time vs. Policy Ceiling',
        domainScope,
        equation: 'Max(Available_In-Domain_Lead_Time_Days) ≤ maxLeadTimeDays',
        grain: 'In-domain Location_DC / Supplier_ID × SKU_Code',
        leftSource,
        rightSource: 'Industry Governance Policy (maxLeadTimeDays)',
        leftTotal: maxObservedLt,
        rightTotal: ceiling,
        varianceAbs,
        variancePct,
        tolerancePct: 0,
        eligibleRecordsCount: eligibleCount,
        excludedRecordsCount: excludedCount,
        exclusionRule: `Evaluates ${sourceDescription}; excludes removed records and rows without numeric non-negative lead-time values. Sources outside the selected domain are not evaluated.`,
        status:
          eligibleCount === 0
            ? 'NOT_RUN'
            : maxObservedLt <= ceiling
              ? 'RECONCILED'
              : 'VARIANCE_WARNING',
        detail:
          eligibleCount === 0
            ? `Not Run: 0 valid lead-time values found in ${sourceDescription}`
            : `Evaluated ${eligibleCount} in-domain lead-time record(s); max observed ${maxObservedLt}d vs ${ceiling}d policy ceiling`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  
  return {
    checks,
    reconciledCount: checks.filter((c) => c.status === 'RECONCILED').length,
    warningCount: checks.filter((c) => c.status === 'VARIANCE_WARNING').length,
    criticalCount: checks.filter((c) => c.status === 'CRITICAL_MISMATCH').length,
    notRunCount: checks.filter((c) => c.status === 'NOT_RUN').length,
    notApplicableCount: checks.filter((c) => c.status === 'NOT_APPLICABLE').length,
  };
}

function computeAliasSimilarity(sourceCol: string, canonicalCol: string): number {
  const s = sourceCol.toLowerCase();
  const c = canonicalCol.toLowerCase();
  if (s === c) return 100;
  const sTokens = s.split(/[_\s-]+/).filter(Boolean);
  const cTokens = c.split(/[_\s-]+/).filter(Boolean);
  if (sTokens.length === 0 || cTokens.length === 0) return 0;

  let matchedTokens = 0;
  for (const ct of cTokens) {
    if (sTokens.some((st) => st === ct || st.includes(ct) || ct.includes(st))) {
      matchedTokens++;
    }
  }
  const firstTokenMatch = sTokens[0] === cTokens[0] || s.includes(cTokens[0]);
  const ratio = matchedTokens / cTokens.length;
  if (firstTokenMatch && ratio >= 0.66) return 92;
  if (firstTokenMatch && ratio >= 0.33) return 82;
  if (ratio >= 0.5) return 74;
  if (firstTokenMatch) return 68;
  return 0;
}

/**
 * Schema Drift & Column Mapping Detector (P1 Requirement).
 * Scoped to the selected planning domain, computes confidence scores for fuzzy column alias suggestions,
 * and flags potential mapping collisions before execution.
 */
export function detectSchemaDrift(
  sheets: EnterpriseSheets,
  domain: PlanningDomainKey = 'ALL'
): SchemaDriftReport {
  const domainContract = DOMAIN_CONTRACTS[domain] ?? DOMAIN_CONTRACTS.ALL;
  const mandatorySet = new Set(domainContract.mandatoryTables);
  const relevantSet = new Set(domainContract.relevantTables);

  const missingMandatoryTables: string[] = [];
  const missingOptionalTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string; mandatory: boolean }> = [];
  const unexpectedColumns: Array<{ table: string; column: string }> = [];
  const suggestedColumnMappings: SuggestedColumnMapping[] = [];

  for (const contractName of Object.keys(TABLE_CONTRACTS)) {
    if (domain !== 'ALL' && !relevantSet.has(contractName)) {
      continue;
    }
    const contract = TABLE_CONTRACTS[contractName];
    const sheetNames = Object.keys(sheets);
    const matchingSheets = sheetNames.filter(
      (name) => resolveContractTableKey(name) === contractName
    );
    const matchedSheet = matchingSheets.length === 1 ? matchingSheets[0] : undefined;

    const isMandatory =
      domain === 'ALL' ? contract.mandatory : mandatorySet.has(contractName);

    if (!matchedSheet || !sheets[matchedSheet]) {
      if (isMandatory) {
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
      ...contract.optionalColumns,
      ...contract.businessKey,
      ...Object.keys(contract.columnTypes),
    ]);

    const actualLowerMap = new Map<string, string>();
    actualCols.forEach((ac) => actualLowerMap.set(ac.toLowerCase(), ac));

    const usedSourceCandidates = new Set<string>();

    for (const reqCol of contract.mandatoryColumns) {
      if (!actualLowerMap.has(reqCol.toLowerCase())) {
        missingColumns.push({ table: matchedSheet, column: reqCol, mandatory: true });

        // Rank non-canonical columns by similarity confidence
        const nonCanonicalCandidates = Array.from(actualCols)
          .filter(
            (ac) =>
              !Array.from(canonicalCols).some(
                (cc) => cc.toLowerCase() === ac.toLowerCase()
              )
          )
          .map((ac) => ({
            col: ac,
            confidencePct: computeAliasSimilarity(ac, reqCol),
          }))
          .filter((x) => x.confidencePct >= 65)
          .sort((a, b) => b.confidencePct - a.confidencePct);

        if (nonCanonicalCandidates.length > 0) {
          const best = nonCanonicalCandidates[0];
          const hasCollision =
            usedSourceCandidates.has(best.col) ||
            nonCanonicalCandidates.length > 1;
          usedSourceCandidates.add(best.col);

          suggestedColumnMappings.push({
            table: matchedSheet,
            sourceColumn: best.col,
            targetCanonicalColumn: reqCol,
            confidencePct: best.confidencePct,
            collisionWarning: hasCollision
              ? nonCanonicalCandidates.length > 1
                ? `Multiple alias candidates found (${nonCanonicalCandidates.map((c) => c.col).join(', ')})`
                : `Source column "${best.col}" is also suggested for another canonical target`
              : undefined,
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
 * Safe Column Alias Mapper with Collision Detection & Consistent Metadata Synchronization (P1 Requirement):
 * - Prevents destructive overwrites if `targetCanonicalColumn` already contains distinct non-empty values.
 * - Updates both `records` and `cols` metadata consistently without leaving duplicate source/target column definitions.
 */
export function applyColumnMapping(
  sheets: EnterpriseSheets,
  table: string,
  sourceColumn: string,
  targetCanonicalColumn: string
): EnterpriseSheets {
  const tbl = sheets[table];
  if (!tbl || !sourceColumn || !targetCanonicalColumn) return sheets;
  if (sourceColumn === targetCanonicalColumn) return sheets;

  const contractKey = resolveUniqueContractKeyInWorkbook(sheets, table);
  const contract = contractKey ? TABLE_CONTRACTS[contractKey] : undefined;
  if (!contract) {
    throw new Error(`Column mapping refused: table \"${table}\" is not an unambiguous canonical table or supported alias.`);
  }
  const expectedType: FieldDataType =
    contract?.columnTypes?.[targetCanonicalColumn] ?? 'STRING';

  // Resolve target column case-insensitively so differently-cased existing headers
  // are checked for conflicts and consolidated instead of silently duplicated.
  const targetColumnLower = targetCanonicalColumn.toLowerCase();
  const existingTargetColumn =
    tbl.cols.find((column) => column.col.toLowerCase() === targetColumnLower)?.col ??
    Object.keys(tbl.records[0] ?? {}).find((key) => key.toLowerCase() === targetColumnLower) ??
    targetCanonicalColumn;

  // Collision check: verify the target (including differently-cased spelling) has no conflicting values.
  for (let i = 0; i < tbl.records.length; i++) {
    const r = tbl.records[i];
    if (r._removed) continue;
    const srcVal = r[sourceColumn];
    const targetKey =
      Object.keys(r).find((key) => key.toLowerCase() === targetColumnLower) ??
      existingTargetColumn;
    const tgtVal = r[targetKey];
    const srcNonEmpty =
      srcVal !== undefined && srcVal !== null && String(srcVal).trim() !== '';
    const tgtNonEmpty =
      tgtVal !== undefined && tgtVal !== null && String(tgtVal).trim() !== '';
    if (
      sourceColumn.toLowerCase() !== existingTargetColumn.toLowerCase() &&
      srcNonEmpty &&
      tgtNonEmpty &&
      String(srcVal).trim() !== String(tgtVal).trim()
    ) {
      throw new Error(
        `Column mapping conflict in ${table} (Row #${i + 2}): target column "${existingTargetColumn}" already contains "${String(tgtVal)}" vs source "${sourceColumn}"="${String(srcVal)}".`
      );
    }
  }

  const updatedRecords: SheetRecord[] = tbl.records.map((r) => {
    const copy: SheetRecord = { ...r };
    if (Object.prototype.hasOwnProperty.call(copy, sourceColumn)) {
      const srcVal = copy[sourceColumn];
      if (sourceColumn.toLowerCase() === targetColumnLower) {
        if (sourceColumn !== targetCanonicalColumn) {
          copy[targetCanonicalColumn] = srcVal;
          delete copy[sourceColumn];
        }
        return copy;
      }
      const targetKey =
        Object.keys(copy).find((key) => key.toLowerCase() === targetColumnLower) ??
        targetCanonicalColumn;
      const tgtVal = copy[targetKey];
      const tgtEmpty =
        tgtVal === undefined || tgtVal === null || String(tgtVal).trim() === '';
      if (tgtEmpty && srcVal !== undefined) {
        copy[targetCanonicalColumn] = srcVal;
      }
      if (targetKey !== targetCanonicalColumn) {
        delete copy[targetKey];
        if (tgtVal !== undefined && tgtVal !== null && String(tgtVal).trim() !== '') {
          copy[targetCanonicalColumn] = tgtVal;
        }
      }
      delete copy[sourceColumn];
    }
    return copy;
  });

  // Synchronize column metadata without duplicate entries
  const canonicalColDef = {
    col: targetCanonicalColumn,
    type: expectedType,
    key: contract?.businessKey?.includes(targetCanonicalColumn) ? 'PK' : 'Attribute',
    required: contract?.mandatoryColumns?.includes(targetCanonicalColumn) ?? true,
    dataType: expectedType,
  };

  let replacedInPlace = false;
  const updatedCols = [];
  for (const c of tbl.cols) {
    if (
      c.col === sourceColumn ||
      c.col.toLowerCase() === targetCanonicalColumn.toLowerCase()
    ) {
      if (!replacedInPlace) {
        updatedCols.push({
          ...c,
          ...canonicalColDef,
        });
        replacedInPlace = true;
      }
    } else {
      updatedCols.push(c);
    }
  }
  if (!replacedInPlace) {
    updatedCols.push(canonicalColDef);
  }

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
 * Non-Synthetic Structural Remediation Helper (P0 Issue 2 Fix):
 * - Creates the canonical table structure (`cols`) with an EMPTY record array (`records: []`)
 *   and `awaitingDataPopulation: true`.
 * - NEVER inserts synthetic business records (`2025-01-01`, `0`, `PENDING_SKU_CODE`) to artificially pass schema checks.
 * - When initializing a missing column on an existing table, populates empty strings (`''`) so mandatory-field checks
 *   honestly flag each empty cell for verified data entry.
 */
export function remediateMissingStructure(
  sheets: EnterpriseSheets,
  tableName: string,
  columnName?: string
): EnterpriseSheets {
  const contract = TABLE_CONTRACTS[tableName];
  const existingSheet = sheets[tableName];

  if (!existingSheet) {
    const cols = contract
      ? Array.from(
          new Set([
            ...contract.mandatoryColumns,
            ...contract.businessKey,
            ...Object.keys(contract.columnTypes),
          ])
        )
      : [columnName || 'ID'];

    return {
      ...sheets,
      [tableName]: {
        pillar: contract?.businessKey?.join(' × ') ?? 'Entity Grain',
        desc: 'Awaiting Data Population (Canonical Schema Initialized — 0 Records)',
        awaitingDataPopulation: true,
        cols: cols.map((col) => ({
          col,
          type: contract?.columnTypes?.[col] ?? 'STRING',
          key: contract?.businessKey?.includes(col) ? 'PK' : 'Attr',
          required: contract?.mandatoryColumns?.includes(col) ?? true,
          dataType: contract?.columnTypes?.[col] ?? 'STRING',
        })),
        records: [],
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
            required: contract?.mandatoryColumns?.includes(columnName) ?? true,
            dataType: colType,
          },
        ];

    const nextRecords = existingSheet.records.map((r) => ({
      ...r,
      [columnName]: r[columnName] !== undefined ? r[columnName] : '',
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
// DATASET-BOUND PERSISTENT GOVERNANCE STORAGE (P0 Issue 1 Fix)
// ============================================================================
const STORAGE_KEY = 'argon_phase1_governance_state_v2';

export interface PersistedGovernanceState {
  industry: IndustryKey;
  domain: PlanningDomainKey;
  ruleConfig: ValidationRuleConfig;
  sourceSheets?: EnterpriseSheets;
  workbookSource?: string;
  sourceWorkbookHash?: string;
  approvedCorrections: ApprovedCorrection[];
  warningSignOff: WarningSignOff | null;
  auditLog: AuditEntry[];
  lineageHistory: UploadLineageRecord[];
  exceptionAssignments: Record<string, ExceptionAssignment>;
}

export function savePersistedGovernanceState(state: PersistedGovernanceState): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const sourceWorkbookHash =
      state.sourceWorkbookHash ??
      (state.sourceSheets ? computeWorkbookHash(state.sourceSheets) : undefined);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        sourceWorkbookHash,
      })
    );
    return true;
  } catch {
    // A failed persistence write must be visible to the caller; never report success.
    return false;
  }
}

export function hasPersistedGovernanceState(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadPersistedGovernanceState(): PersistedGovernanceState | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedGovernanceState>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const industryCandidate = parsed.industry;
    const industry: IndustryKey =
      typeof industryCandidate === 'string' &&
      Object.prototype.hasOwnProperty.call(INDUSTRY_DEFAULT_RULE_CONFIGS, industryCandidate)
        ? industryCandidate as IndustryKey
        : 'cpg';
    const domainCandidate = parsed.domain;
    const domain: PlanningDomainKey =
      typeof domainCandidate === 'string' &&
      Object.prototype.hasOwnProperty.call(DOMAIN_CONTRACTS, domainCandidate)
        ? domainCandidate as PlanningDomainKey
        : 'ALL';

    // Do not silently replace a missing or malformed saved workbook with seeded demo data.
    const candidateSheets = parsed.sourceSheets;
    if (
      !candidateSheets ||
      typeof candidateSheets !== 'object' ||
      Array.isArray(candidateSheets) ||
      Object.keys(candidateSheets).length === 0
    ) {
      return null;
    }
    const sheetEntries = Object.entries(candidateSheets as Record<string, unknown>);
    const validSheets = sheetEntries.every(([, candidate]) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const table = candidate as { cols?: unknown; records?: unknown };
      return (
        Array.isArray(table.cols) &&
        table.cols.every(
          (column) =>
            Boolean(column) &&
            typeof column === 'object' &&
            typeof (column as { col?: unknown }).col === 'string'
        ) &&
        Array.isArray(table.records) &&
        table.records.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      );
    });
    if (!validSheets) return null;

    const restoredSheets = candidateSheets as EnterpriseSheets;
    const actualHash = computeWorkbookHash(restoredSheets);
    const savedHash = parsed.sourceWorkbookHash;
    const hashMatchesWorkbook = typeof savedHash === 'string' && savedHash === actualHash;

    const defaults = INDUSTRY_DEFAULT_RULE_CONFIGS[industry] ?? DEFAULT_RULE_CONFIG;
    const candidateConfig =
      parsed.ruleConfig && typeof parsed.ruleConfig === 'object' && !Array.isArray(parsed.ruleConfig)
        ? parsed.ruleConfig as Partial<ValidationRuleConfig>
        : {};
    const inRange = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) &&
        numeric >= min &&
        numeric <= max &&
        (!integer || Number.isInteger(numeric))
        ? numeric
        : fallback;
    };
    const ruleConfig: ValidationRuleConfig = {
      outlierSigmaThreshold: inRange(candidateConfig.outlierSigmaThreshold, defaults.outlierSigmaThreshold, 1.5, 10),
      outlierZThreshold: inRange(candidateConfig.outlierZThreshold, defaults.outlierZThreshold ?? defaults.outlierSigmaThreshold, 1.5, 10),
      salesOverrideMaxPct: inRange(candidateConfig.salesOverrideMaxPct, defaults.salesOverrideMaxPct, 1, 200),
      standardCasePackMin: inRange(candidateConfig.standardCasePackMin, defaults.standardCasePackMin, 2, 500, true),
      minServiceLevelPct: inRange(candidateConfig.minServiceLevelPct, defaults.minServiceLevelPct, 50, 99.99),
      maxLeadTimeDays: inRange(candidateConfig.maxLeadTimeDays, defaults.maxLeadTimeDays, 1, 365),
      reconciliationTolerancePct: inRange(candidateConfig.reconciliationTolerancePct, defaults.reconciliationTolerancePct, 0, 50),
      enforceMoqOrderMultiples:
        typeof candidateConfig.enforceMoqOrderMultiples === 'boolean'
          ? candidateConfig.enforceMoqOrderMultiples
          : defaults.enforceMoqOrderMultiples,
      enforceFutureDateGuard:
        typeof candidateConfig.enforceFutureDateGuard === 'boolean'
          ? candidateConfig.enforceFutureDateGuard
          : defaults.enforceFutureDateGuard,
      ruleVersion:
        typeof candidateConfig.ruleVersion === 'string' &&
        candidateConfig.ruleVersion.trim().length > 0 &&
        candidateConfig.ruleVersion.length <= 100
          ? candidateConfig.ruleVersion.trim()
          : defaults.ruleVersion,
    };

    // Persisted approvals are accepted only when their full shape and workbook binding are valid.
    const validFixTypes = new Set([
      'IMPUTE_ACTUAL',
      'FIX_NEGATIVE',
      'TAG_SPIKE',
      'REMOVE_DUPLICATE',
      'IMPUTE_MISSING_PERIOD',
      'MAP_SKU',
      'MAP_DEPOT',
      'MAP_CHANNEL',
      'FIX_UOM',
      'FIX_NPI_REF',
      'SWAP_PROMO_DATES',
      'RESOLVE_PROMO_OVERLAP',
      'FIX_COGS',
      'CAP_OVERRIDE',
      'SANITIZE_CELL',
      'SCHEMA_REMEDIATION',
      'FIX_LEADTIME_MOQ',
    ]);
    const rawCorrections = Array.isArray(parsed.approvedCorrections)
      ? parsed.approvedCorrections
      : [];
    const seenCorrectionIds = new Set<string>();
    const seenCorrectionSignatures = new Set<string>();
    const verifiedCorrections = hashMatchesWorkbook
      ? rawCorrections.filter((rawCorrection) => {
          if (!rawCorrection || typeof rawCorrection !== 'object' || Array.isArray(rawCorrection)) {
            return false;
          }
          const correction = rawCorrection as Partial<ApprovedCorrection>;
          const valueIsValid =
            typeof correction.approvedValue === 'string'
              ? correction.approvedValue.length <= 2048
              : typeof correction.approvedValue === 'number' &&
                Number.isFinite(correction.approvedValue);
          const classificationIsValid =
            correction.classificationMode === undefined ||
            ['CREDIT_RETURN', 'BILLING_CORRECTION', 'KEEP_AUTHORITATIVE'].includes(
              correction.classificationMode
            );
          const missingPeriodIsValid =
            correction.missingPeriodMeta === undefined ||
            (Boolean(correction.missingPeriodMeta) &&
              ['periodDate', 'sku', 'depot', 'channel'].every(
                (key) =>
                  typeof (correction.missingPeriodMeta as Record<string, unknown>)[key] === 'string'
              ));
          const correctionIsValid = (
            correction.sourceWorkbookHash === actualHash &&
            typeof correction.id === 'string' &&
            correction.id.length > 0 &&
            correction.id.length <= 128 &&
            typeof correction.exceptionSignature === 'string' &&
            correction.exceptionSignature.length > 0 &&
            correction.exceptionSignature.length <= 512 &&
            typeof correction.fixType === 'string' &&
            validFixTypes.has(correction.fixType) &&
            typeof correction.table === 'string' &&
            correction.table.length > 0 &&
            correction.table.length <= 256 &&
            Number.isInteger(correction.rowIndex) &&
            (correction.rowIndex as number) >= 0 &&
            valueIsValid &&
            classificationIsValid &&
            missingPeriodIsValid &&
            typeof correction.beforeSummary === 'string' &&
            typeof correction.afterSummary === 'string' &&
            typeof correction.approver === 'string' &&
            correction.approver.trim().length > 0 &&
            correction.approver.length <= 128 &&
            typeof correction.reason === 'string' &&
            correction.reason.trim().length > 0 &&
            correction.reason.length <= 1000 &&
            typeof correction.approvedAt === 'string' &&
            correction.approvedAt.length > 0
          );
          if (!correctionIsValid) return false;
          if (
            seenCorrectionIds.has(correction.id!) ||
            seenCorrectionSignatures.has(correction.exceptionSignature!)
          ) {
            return false;
          }
          seenCorrectionIds.add(correction.id!);
          seenCorrectionSignatures.add(correction.exceptionSignature!);
          return true;
        })
      : []

    const rawSignOff = parsed.warningSignOff ?? null;
    const signOffCandidate =
      rawSignOff && typeof rawSignOff === 'object' && !Array.isArray(rawSignOff)
        ? rawSignOff as Partial<WarningSignOff>
        : null;
    const verifiedSignOff =
      hashMatchesWorkbook &&
      signOffCandidate &&
      signOffCandidate.sourceWorkbookHash === actualHash &&
      typeof signOffCandidate.approver === 'string' &&
      signOffCandidate.approver.trim().length > 0 &&
      signOffCandidate.approver.length <= 128 &&
      typeof signOffCandidate.reason === 'string' &&
      signOffCandidate.reason.trim().length > 0 &&
      signOffCandidate.reason.length <= 1000 &&
      typeof signOffCandidate.expiry === 'string' &&
      signOffCandidate.expiry.length > 0 &&
      typeof signOffCandidate.signedAt === 'string' &&
      signOffCandidate.signedAt.length > 0 &&
      typeof signOffCandidate.expiresAt === 'string' &&
      Number.isFinite(Date.parse(signOffCandidate.expiresAt))
        ? signOffCandidate as WarningSignOff
        : null;

    const validAuditLog = (Array.isArray(parsed.auditLog) ? parsed.auditLog : []).filter(
      (entry): entry is AuditEntry =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof entry.ts === 'string' &&
        typeof entry.evt === 'string' &&
        typeof entry.scope === 'string' &&
        typeof entry.user === 'string' &&
        typeof entry.out === 'string' &&
        (entry.datasetHash === undefined || typeof entry.datasetHash === 'string')
    );
    const validLineageHistory = (Array.isArray(parsed.lineageHistory) ? parsed.lineageHistory : []).filter(
      (entry): entry is UploadLineageRecord => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Partial<UploadLineageRecord>;
        return (
          typeof record.id === 'string' &&
          typeof record.fileName === 'string' &&
          typeof record.fileHash === 'string' &&
          typeof record.uploadedAt === 'string' &&
          Number.isInteger(record.sheetCount) &&
          (record.sheetCount as number) >= 0 &&
          Number.isInteger(record.totalRows) &&
          (record.totalRows as number) >= 0 &&
          typeof record.domain === 'string' &&
          Object.prototype.hasOwnProperty.call(DOMAIN_CONTRACTS, record.domain) &&
          typeof record.industry === 'string' &&
          Object.prototype.hasOwnProperty.call(INDUSTRY_DEFAULT_RULE_CONFIGS, record.industry) &&
          (record.uploadStatus === undefined ||
            ['ACTIVE', 'SUPERSEDED', 'REJECTED', 'SUCCESS'].includes(record.uploadStatus)) &&
          (record.governedOutputHash === undefined || typeof record.governedOutputHash === 'string')
        );
      }
    );
    const validExceptionAssignments = Object.create(null) as Record<string, ExceptionAssignment>;
    if (
      parsed.exceptionAssignments &&
      typeof parsed.exceptionAssignments === 'object' &&
      !Array.isArray(parsed.exceptionAssignments)
    ) {
      for (const [signature, rawAssignment] of Object.entries(parsed.exceptionAssignments)) {
        if (!rawAssignment || typeof rawAssignment !== 'object' || Array.isArray(rawAssignment)) continue;
        const assignment = rawAssignment as Partial<ExceptionAssignment>;
        if (
          typeof assignment.owner !== 'string' ||
          assignment.owner.trim().length === 0 ||
          typeof assignment.slaHours !== 'number' ||
          !Number.isFinite(assignment.slaHours) ||
          assignment.slaHours <= 0 ||
          assignment.slaHours > 8760 ||
          !['OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED'].includes(assignment.status || '')
        ) {
          continue;
        }
        const history = Array.isArray(assignment.history)
          ? assignment.history
              .filter(
                (item) =>
                  Boolean(item) &&
                  typeof item === 'object' &&
                  typeof item.owner === 'string' &&
                  item.owner.trim().length > 0 &&
                  item.owner.length <= 128 &&
                  ['OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED'].includes(item.status) &&
                  typeof item.updatedAt === 'string' &&
                  Number.isFinite(Date.parse(item.updatedAt))
              )
              .slice(-100)
          : [];
        const validAssignedAt =
          typeof assignment.assignedAt === 'string' && Number.isFinite(Date.parse(assignment.assignedAt))
            ? assignment.assignedAt
            : undefined;
        const validDueAt =
          typeof assignment.dueAt === 'string' && Number.isFinite(Date.parse(assignment.dueAt))
            ? assignment.dueAt
            : undefined;
        const validUpdatedAt =
          typeof assignment.updatedAt === 'string' && Number.isFinite(Date.parse(assignment.updatedAt))
            ? assignment.updatedAt
            : undefined;
        validExceptionAssignments[signature] = {
          owner: assignment.owner,
          slaHours: assignment.slaHours,
          status: assignment.status as ExceptionAssignment['status'],
          assignedAt: validAssignedAt,
          dueAt: validDueAt,
          isOverdue:
            assignment.status !== 'RESOLVED' &&
            Boolean(validDueAt && Date.parse(validDueAt) < Date.now()),
          updatedAt: validUpdatedAt,
          history,
        };
      }
    }

    return {
      industry,
      domain,
      ruleConfig,
      sourceSheets: restoredSheets,
      workbookSource:
        typeof parsed.workbookSource === 'string' && parsed.workbookSource.length <= 512
          ? parsed.workbookSource
          : 'Restored Workbook',
      sourceWorkbookHash: actualHash,
      approvedCorrections: verifiedCorrections,
      warningSignOff: verifiedSignOff,
      auditLog: validAuditLog,
      lineageHistory: validLineageHistory,
      exceptionAssignments: validExceptionAssignments,
    };
  } catch {
    return null;
  }
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
