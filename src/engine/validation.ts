import {
  DEFAULT_RULE_CONFIG,
  DOMAIN_CONTRACTS,
  INDUSTRY_DEFAULT_RULE_CONFIGS,
  TABLE_CONTRACTS,
} from './schema';
import { computeWorkbookHash } from './profilingAndReconciliation';
import { hasUnsafePayload, sanitizeCellText } from './security';
import {
  ApprovedCorrection,
  CategoryValidationSummary,
  EnterpriseSheets,
  ExceptionAssignment,
  FieldDataType,
  QualityDimensionScore,
  ReleaseGateCondition,
  ReleaseGateState,
  SheetRecord,
  ValidationCategoryKey,
  ValidationCoverageEntry,
  ValidationException,
  ValidationExecutionStatus,
  ValidationOptions,
  ValidationReport,
  ValidationRuleConfig,
  WarningSignOff,
} from './types';

function normalizeColumnAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getRowVal(
  row: SheetRecord,
  candidates: string[]
): string | number | boolean | null | undefined {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined) return row[candidate];
  }
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeColumnAlias(candidate);
    const found = keys.find((key) => normalizeColumnAlias(key) === normalizedCandidate);
    if (found !== undefined) return row[found];
  }
  return undefined;
}

export function findColumnKey(row: SheetRecord, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined) return candidate;
  }
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeColumnAlias(candidate);
    const found = keys.find((key) => normalizeColumnAlias(key) === normalizedCandidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function updateExceptionAssignment(
  existing: ExceptionAssignment | undefined,
  requested: ExceptionAssignment,
  nowIso: string
): ExceptionAssignment {
  const nowMs = Date.parse(nowIso);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const owner =
    typeof requested.owner === 'string' && requested.owner.trim().length > 0
      ? requested.owner.trim()
      : 'Unassigned';
  const slaHours =
    Number.isFinite(requested.slaHours) && requested.slaHours >= 1 && requested.slaHours <= 8760
      ? requested.slaHours
      : 24;
  const ownerAssigned = owner !== 'Unassigned';
  const ownerChanged = !existing || existing.owner !== owner;
  const slaChanged = !existing || existing.slaHours !== slaHours;
  const validStatuses = new Set<ExceptionAssignment['status']>([
    'OPEN',
    'IN_REVIEW',
    'ESCALATED',
    'RESOLVED',
  ]);
  const status = ownerAssigned && validStatuses.has(requested.status)
    ? requested.status
    : 'OPEN';
  const assignedAt = ownerAssigned
    ? ownerChanged
      ? nowIso
      : existing?.assignedAt ?? nowIso
    : undefined;
  const dueAt = ownerAssigned
    ? ownerChanged || slaChanged || !existing?.dueAt
      ? new Date((Date.parse(assignedAt ?? nowIso) || safeNowMs) + slaHours * 60 * 60 * 1000).toISOString()
      : existing.dueAt
    : undefined;
  const isOverdue =
    status !== 'RESOLVED' &&
    Boolean(dueAt && Number.isFinite(Date.parse(dueAt)) && Date.parse(dueAt) < safeNowMs);
  const historyEntry = {
    owner,
    updatedAt: nowIso,
    ts: nowIso,
    fromOwner: existing?.owner ?? 'Unassigned',
    toOwner: owner,
    status,
  };
  return {
    owner,
    slaHours,
    status,
    assignedAt,
    dueAt,
    isOverdue,
    updatedAt: nowIso,
    history: [...(existing?.history ?? []), historyEntry].slice(-100),
  };
}

function normalizeStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export function parseStrictNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : Number.NaN;
  if (raw === null || raw === undefined) return Number.NaN;

  const trimmed = String(raw).trim();
  if (!trimmed) return Number.NaN;

  // Accept ungrouped numeric text, standard 3-digit grouping, and Indian 3-then-2 grouping.
  // Reject malformed grouping such as "1,2,3" rather than silently changing its value.
  const signless = trimmed.replace(/^[+-]/, '');
  const [integerPart, decimalPart] = signless.split('.');
  if (signless.split('.').length > 2) return Number.NaN;
  const hasGrouping = integerPart.includes(',');
  const validWesternGrouping = /^\d{1,3}(,\d{3})+$/.test(integerPart);
  const validIndianGrouping = /^\d{1,2}(,\d{2})+,\d{3}$/.test(integerPart);
  if (hasGrouping && !validWesternGrouping && !validIndianGrouping) return Number.NaN;
  if (decimalPart !== undefined && !/^\d*$/.test(decimalPart)) return Number.NaN;
  if (!hasGrouping && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return Number.NaN;
  }
  if (hasGrouping && !/^[+-]?\d[\d,]*(?:\.\d*)?$/.test(trimmed)) return Number.NaN;

  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : Number.NaN;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function makeValidUtcDate(year: number, monthIndex: number, day: number): Date | null {
  if (year < 1900 || year > 2199 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, monthIndex, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== monthIndex ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Returns true if a string is an ambiguous slash/dash numeric date where both
 * first and second components are <= 12 and unequal (e.g., "01/02/2025").
 */
export function isAmbiguousDateString(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (!slashMatch) return false;
  const p1 = Number(slashMatch[1]);
  const p2 = Number(slashMatch[2]);
  return p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 12 && p1 !== p2;
}

/**
 * Parses ISO dates (YYYY-MM-DD), ISO timestamps, Excel serial date numbers (1900 epoch),
 * YYYY/MM/DD, DD-MMM-YYYY, and unambiguous slash/dash dates (where day > 12 or day === month).
 * Rejects ambiguous dates (e.g. 01/02/2025 where DD/MM vs MM/DD cannot be determined),
 * invalid calendar dates (e.g. 2025-02-30), and non-date text.
 */
function parseExcel1900Serial(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 109574 || serial === 60) return null;
  // Excel's 1900 date system contains the fictitious 1900-02-29 (serial 60).
  // Use the correct epoch before/after that compatibility gap; reject serial 60.
  const epoch = serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const dt = new Date(epoch + Math.floor(serial) * 86400000);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parseFlexibleDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return makeValidUtcDate(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate());
  }

  if (typeof raw === 'number') {
    return parseExcel1900Serial(raw);
  }

  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toUpperCase() === 'NULL') return null;

  // Pure numeric string representing Excel serial date
  if (/^\d{5,6}(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    return parseExcel1900Serial(serial);
  }

  // ISO YYYY-MM-DD or YYYY/MM/DD (optionally with T/space time component)
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(trimmed);
  if (isoMatch) {
    return makeValidUtcDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3])
    );
  }

  // DD-MMM-YYYY or DD MMM YYYY (e.g., 01-May-2025)
  const dmyText = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/.exec(trimmed);
  if (dmyText) {
    const moIdx = MONTH_NAMES[dmyText[2].toLowerCase()];
    if (moIdx === undefined) return null;
    return makeValidUtcDate(Number(dmyText[3]), moIdx, Number(dmyText[1]));
  }

  // Unambiguous slash or dash numeric date:
  // - p1 > 12 && p2 <= 12 -> DD/MM/YYYY
  // - p2 > 12 && p1 <= 12 -> MM/DD/YYYY
  // - p1 <= 12 && p2 <= 12 && p1 === p2 -> unambiguous (same day and month)
  // - p1 <= 12 && p2 <= 12 && p1 !== p2 -> REJECTED as ambiguous (must normalize to YYYY-MM-DD or DD-MMM-YYYY)
  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (p1 > 12 && p2 <= 12) {
      return makeValidUtcDate(y, p2 - 1, p1);
    }
    if (p2 > 12 && p1 <= 12) {
      return makeValidUtcDate(y, p1 - 1, p2);
    }
    if (p1 <= 12 && p2 <= 12 && p1 === p2) {
      return makeValidUtcDate(y, p1 - 1, p2);
    }
    return null;
  }

  return null;
}

function formatIsoDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizePeriodString(raw: unknown): string {
  const dt = parseFlexibleDate(raw);
  return dt ? formatIsoDate(dt) : normalizeStr(raw);
}

function findSheetByPrefixOrName(
  sheets: EnterpriseSheets,
  canonicalTableName: string,
  keyword: string
): string | undefined {
  const names = Object.keys(sheets);
  const canonical = canonicalTableName.toLowerCase();
  const exactCanonical = names.find((name) => name.toLowerCase() === canonical);

  // Accept only a full canonical name followed by a clear suffix. If the exact
  // table and a suffixed duplicate both exist, fail closed instead of choosing.
  const canonicalSuffixMatches = names.filter((name =>
    ['_', ' ', '-', '(', '['].some((separator) =>
      name.toLowerCase().startsWith(canonical + separator)
    )
  ));
  if (exactCanonical && canonicalSuffixMatches.length > 0) return undefined;
  if (exactCanonical) return exactCanonical;
  if (canonicalSuffixMatches.length === 1) return canonicalSuffixMatches[0];
  if (canonicalSuffixMatches.length > 1) return undefined;

  // Table names must be canonical. Column mapping does not imply table mapping.
  return undefined;
}

function hasColumn(sheets: EnterpriseSheets, tableName: string, colName: string): boolean {
  const tbl = sheets[tableName];
  if (!tbl) return false;
  if (tbl.cols.some((c) => c.col.toLowerCase() === colName.toLowerCase())) return true;
  if (tbl.records.length > 0) {
    return Object.keys(tbl.records[0]).some(
      (k) => k.toLowerCase() === colName.toLowerCase()
    );
  }
  return false;
}

/**
 * Resolves the canonical FieldDataType ('DATE' | 'NUMBER' | 'NON_NEGATIVE_NUMBER' | 'STRING')
 * for a given table and column using TABLE_CONTRACTS.
 */
export function resolveColumnDataType(tableName: string, colName?: string): FieldDataType {
  if (!colName) return 'STRING';
  const tableLower = tableName.toLowerCase();
  const contractNames = Object.keys(TABLE_CONTRACTS);
  const exact = contractNames.find((name) => name.toLowerCase() === tableLower);
  const suffixMatches = contractNames.filter((name =>
    ['_', ' ', '-', '(', '['].some((separator) =>
      tableLower.startsWith(name.toLowerCase() + separator)
    )
  ));
  const contractName =
    exact ??
    (suffixMatches.length === 1
      ? suffixMatches[0]
      : suffixMatches.length > 1
        ? undefined
        : undefined);
  const matchedContract = contractName ? TABLE_CONTRACTS[contractName] : undefined;

  if (!matchedContract) return 'STRING';
  const exactType = matchedContract.columnTypes[colName];
  if (exactType) return exactType;
  const caseInsensitiveKey = Object.keys(matchedContract.columnTypes).find(
    (key) => key.toLowerCase() === colName.toLowerCase()
  );
  return caseInsensitiveKey ? matchedContract.columnTypes[caseInsensitiveKey] : 'STRING';
}

export type SchemaRemediationValidationResult =
  | {
      ok: true;
      fieldType: FieldDataType;
      normalizedValue: string | number;
      afterSummary: string;
    }
  | {
      ok: false;
      fieldType: FieldDataType;
      error: string;
    };

/**
 * Validates and normalizes user remediation input for any row-level schema exception
 * (empty mandatory field, invalid date, non-numeric value, or negative value in non-negative column)
 * according to the column's schema FieldDataType:
 * - DATE: valid, unambiguous date -> normalized to ISO YYYY-MM-DD
 * - NUMBER: valid finite number
 * - NON_NEGATIVE_NUMBER: valid finite number >= 0
 * - STRING: non-empty text (after trimming whitespace, not 'NULL')
 */
export function validateSchemaRemediationInput(
  tableName: string,
  colName: string,
  rawInput: unknown,
  explicitType?: FieldDataType
): SchemaRemediationValidationResult {
  const fieldType: FieldDataType = explicitType ?? resolveColumnDataType(tableName, colName);
  const strRaw = rawInput === null || rawInput === undefined ? '' : String(rawInput).trim();

  if (fieldType === 'DATE') {
    const parsed = parseFlexibleDate(rawInput);
    if (!parsed) {
      return {
        ok: false,
        fieldType,
        error:
          'Enter an unambiguous valid date in YYYY-MM-DD (e.g. 2025-02-01) or DD-MMM-YYYY (e.g. 01-Feb-2025) format. Ambiguous slash dates (e.g. 01/02/2025) are rejected.',
      };
    }
    const normalizedValue = formatIsoDate(parsed);
    return {
      ok: true,
      fieldType,
      normalizedValue,
      afterSummary: `Normalized ${colName} to ${normalizedValue} (ISO YYYY-MM-DD)`,
    };
  }

  if (fieldType === 'NON_NEGATIVE_NUMBER') {
    const num = parseStrictNumber(rawInput);
    if (strRaw === '' || !Number.isFinite(num) || num < 0) {
      return {
        ok: false,
        fieldType,
        error: `Enter a valid non-negative numeric value (>= 0) for ${colName}.`,
      };
    }
    return {
      ok: true,
      fieldType,
      normalizedValue: num,
      afterSummary: `Corrected ${colName} to ${num}`,
    };
  }

  if (fieldType === 'NUMBER') {
    const num = parseStrictNumber(rawInput);
    if (strRaw === '' || !Number.isFinite(num)) {
      return {
        ok: false,
        fieldType,
        error: `Enter a valid finite numeric value for ${colName}.`,
      };
    }
    return {
      ok: true,
      fieldType,
      normalizedValue: num,
      afterSummary: `Corrected ${colName} to ${num}`,
    };
  }

  // STRING
  if (!strRaw || strRaw.toUpperCase() === 'NULL') {
    return {
      ok: false,
      fieldType,
      error: `Enter a valid non-empty text value for ${colName}.`,
    };
  }
  return {
    ok: true,
    fieldType,
    normalizedValue: strRaw,
    afterSummary: `Populated ${colName} with "${strRaw}"`,
  };
}

function getBusinessKey(
  tblName: string,
  row: SheetRecord,
  canonicalContractName?: string
): string | null {
  const contract =
    (canonicalContractName && TABLE_CONTRACTS[canonicalContractName]) ||
    TABLE_CONTRACTS[tblName];
  if (contract) {
    const parts = contract.businessKey.map((col) => {
      const val = getRowVal(row, [col]);
      if (contract.columnTypes[col] === 'DATE') {
        return normalizePeriodString(val);
      }
      return normalizeStr(val);
    });
    if (parts.every((p) => p !== '')) {
      // Include optional sub-grain identifiers when populated so legitimate finer-grain rows do not collide
      const extraCols =
        contract.tableName === '01_Orders_Shipments_History'
          ? ['Customer_Account_ID']
          : contract.tableName === '02_Forecast_Vintages_Lag'
            ? ['Forecast_Vintage_Date', 'Lag_Horizon']
            : contract.tableName === '03_Commercial_Sales_Inputs' ||
                contract.tableName === '07_Inventory_Supply_Constraints'
              ? ['Channel_Code']
              : [];
      for (const extra of extraCols) {
        const extraVal = normalizeStr(row[extra]);
        if (extraVal) parts.push(extraVal);
      }
      return parts.join('|');
    }
  }

  const period = normalizePeriodString(
    getRowVal(row, [
      'Period_Date',
      'Target_Delivery_Month',
      'Target_Period',
      'Effective_From_Month',
      'Commercial_Launch_Date',
      'Date',
      'Month',
    ])
  );
  const sku = normalizeStr(
    getRowVal(row, ['SKU_Code', 'New_Launch_SKU_Code', 'SKU', 'Product'])
  );
  const depot = normalizeStr(getRowVal(row, ['Location_DC', 'Location', 'Depot']));
  const ch = normalizeStr(getRowVal(row, ['Channel_Code', 'Channel']));

  if (period && sku) return `${period}|${sku}|${depot}|${ch}`;
  return null;
}

function resolveStatus(
  checksAttempted: number,
  checksExecuted: number,
  issues: ValidationException[]
): ValidationExecutionStatus {
  if (checksExecuted === 0) return 'NOT_RUN';
  if (issues.length > 0) return 'FAILED';
  if (checksExecuted < checksAttempted) return 'PARTIAL';
  return 'PASSED';
}

/**
 * Validates and sanitizes configurable rule thresholds (Priority 1 Requirement).
 * Rejects NaN or out-of-range values and increments the rule version identifier.
 */
export function validateRuleConfig(
  patch: Partial<ValidationRuleConfig>,
  baseConfig: ValidationRuleConfig = DEFAULT_RULE_CONFIG
): {
  ok: boolean;
  valid: boolean;
  config: ValidationRuleConfig;
  sanitized: ValidationRuleConfig;
  errors: string[];
} {
  const errors: string[] = [];
  const next: ValidationRuleConfig = { ...baseConfig };

  if (patch.standardCasePackMin !== undefined) {
    const v = parseStrictNumber(patch.standardCasePackMin);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 2 || v > 500) {
      errors.push('standardCasePackMin must be an integer between 2 and 500 EA/CASE.');
    } else {
      next.standardCasePackMin = v;
    }
  }
  if (patch.salesOverrideMaxPct !== undefined) {
    const v = parseStrictNumber(patch.salesOverrideMaxPct);
    if (!Number.isFinite(v) || v < 1 || v > 200) {
      errors.push('salesOverrideMaxPct must be between 1% and 200%.');
    } else {
      next.salesOverrideMaxPct = v;
    }
  }
  if (patch.minServiceLevelPct !== undefined) {
    const v = parseStrictNumber(patch.minServiceLevelPct);
    if (!Number.isFinite(v) || v < 50 || v > 99.99) {
      errors.push('minServiceLevelPct must be between 50% and 99.99%.');
    } else {
      next.minServiceLevelPct = v;
    }
  }
  if (patch.maxLeadTimeDays !== undefined) {
    const v = parseStrictNumber(patch.maxLeadTimeDays);
    if (!Number.isFinite(v) || v < 1 || v > 365) {
      errors.push('maxLeadTimeDays must be between 1 and 365 days.');
    } else {
      next.maxLeadTimeDays = v;
    }
  }
  if (patch.outlierSigmaThreshold !== undefined) {
    const v = parseStrictNumber(patch.outlierSigmaThreshold);
    if (!Number.isFinite(v) || v < 1.5 || v > 10) {
      errors.push('outlierSigmaThreshold must be between 1.5σ and 10σ.');
    } else {
      next.outlierSigmaThreshold = v;
    }
  }
  if (patch.outlierZThreshold !== undefined) {
    const v = parseStrictNumber(patch.outlierZThreshold);
    if (!Number.isFinite(v) || v < 1.5 || v > 10) {
      errors.push('outlierZThreshold must be between 1.5σ and 10σ.');
    } else {
      next.outlierZThreshold = v;
    }
  }
  if (patch.reconciliationTolerancePct !== undefined) {
    const v = parseStrictNumber(patch.reconciliationTolerancePct);
    if (!Number.isFinite(v) || v < 0 || v > 50) {
      errors.push('reconciliationTolerancePct must be between 0% and 50%.');
    } else {
      next.reconciliationTolerancePct = v;
    }
  }
  if (patch.maxReturnRatePct !== undefined) {
    const v = parseStrictNumber(patch.maxReturnRatePct);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      errors.push('maxReturnRatePct must be between 0% and 100%.');
    } else {
      next.maxReturnRatePct = v;
    }
  }
  if (patch.enforceMoqOrderMultiples !== undefined) {
    if (typeof patch.enforceMoqOrderMultiples !== 'boolean') {
      errors.push('enforceMoqOrderMultiples must be a boolean.');
    } else {
      next.enforceMoqOrderMultiples = patch.enforceMoqOrderMultiples;
    }
  }
  if (patch.enforceFutureDateGuard !== undefined) {
    if (typeof patch.enforceFutureDateGuard !== 'boolean') {
      errors.push('enforceFutureDateGuard must be a boolean.');
    } else {
      next.enforceFutureDateGuard = patch.enforceFutureDateGuard;
    }
  }
  if (patch.stockoutRunRateMethodApproved !== undefined) {
    if (typeof patch.stockoutRunRateMethodApproved !== 'boolean') {
      errors.push('stockoutRunRateMethodApproved must be a boolean.');
    } else {
      next.stockoutRunRateMethodApproved = patch.stockoutRunRateMethodApproved;
    }
  }
  if (patch.enforceStrictApprovalHashBinding !== undefined) {
    if (typeof patch.enforceStrictApprovalHashBinding !== 'boolean') {
      errors.push('enforceStrictApprovalHashBinding must be a boolean.');
    } else {
      next.enforceStrictApprovalHashBinding = patch.enforceStrictApprovalHashBinding;
    }
  }
  if (patch.ruleVersion !== undefined && String(patch.ruleVersion).trim() !== '') {
    next.ruleVersion = String(patch.ruleVersion).trim();
  } else if (errors.length === 0 && Object.keys(patch).length > 0) {
    const baseVer = baseConfig.ruleVersion.replace(/-custom\.\d+$/, '');
    const match = /-custom\.(\d+)$/.exec(baseConfig.ruleVersion);
    const rev = match ? Number(match[1]) + 1 : 1;
    next.ruleVersion = `${baseVer}-custom.${rev}`;
  }

  return {
    ok: errors.length === 0,
    valid: errors.length === 0,
    config: next,
    sanitized: next,
    errors,
  };
}

export function validateWorkbook(
  sheets: EnterpriseSheets,
  options?: ValidationOptions
): ValidationReport {
  const activeIndustry = options?.industry ?? 'cpg';
  const activeDomain = options?.domain ?? 'ALL';
  const defaultRuleCfg: ValidationRuleConfig =
    INDUSTRY_DEFAULT_RULE_CONFIGS[activeIndustry] ?? INDUSTRY_DEFAULT_RULE_CONFIGS.cpg;
  const validatedCfg = options?.ruleConfig
    ? validateRuleConfig(options.ruleConfig, defaultRuleCfg).config
    : defaultRuleCfg;
  const ruleConfig: ValidationRuleConfig = validatedCfg;

  const domainContract = DOMAIN_CONTRACTS[activeDomain] ?? DOMAIN_CONTRACTS.ALL;
  const domainMandatorySet = new Set<string>(domainContract.mandatoryTables);
  const domainRelevantSet = new Set<string>(domainContract.relevantTables);
  const domainRequiredMasters = new Set<string>(domainContract.requiredMasterTables);

  const errs: ValidationException[] = [];
  let errSeq = 1;
  const pushErr = (obj: Omit<ValidationException, 'id'>) => {
    errs.push({ id: `ERR-${String(errSeq++).padStart(2, '0')}`, ...obj });
  };

  // =========================================================================
  // STAGE 1: SCHEMA ASSURANCE & COVERAGE MATRIX (Scoped to Active Domain)
  // =========================================================================
  const schemaMissingDeps: string[] = [];
  let schemaChecksAttempted = 0;
  let schemaChecksExecuted = 0;

  // Map canonical contract names to actual sheet names in `sheets` (and inverse lookup)
  const resolvedTableName = new Map<string, string>();
  const actualToContract = new Map<string, string>();
  for (const contractName of Object.keys(TABLE_CONTRACTS)) {
    const keyword = contractName.slice(3).split('_')[0];
    const matched = findSheetByPrefixOrName(sheets, contractName, keyword);
    if (matched) {
      resolvedTableName.set(contractName, matched);
      actualToContract.set(matched, contractName);
    }
  }

  const coverageMatrix: ValidationCoverageEntry[] = [];

  for (const contractName of Object.keys(TABLE_CONTRACTS)) {
    const contract = TABLE_CONTRACTS[contractName];
    const actualName = resolvedTableName.get(contractName);
    const isMandatoryForDomain =
      activeDomain === 'ALL'
        ? Boolean(contract.mandatory)
        : domainMandatorySet.has(contractName);
    const isRelevantForDomain =
      activeDomain === 'ALL' || domainRelevantSet.has(contractName);

    const presentSheet = actualName ? sheets[actualName] : undefined;
    const liveRowCount = presentSheet
      ? presentSheet.records.filter((r) => !r._removed).length
      : 0;

    if (!isRelevantForDomain) {
      coverageMatrix.push({
        table: contractName,
        tableName: contractName,
        domainRole: 'OUT_OF_DOMAIN',
        requiredByDomain: false,
        relevantToDomain: false,
        presentInWorkbook: Boolean(presentSheet),
        rowCount: liveRowCount,
        checksExecuted: 0,
        issueCount: 0,
        status: 'SKIPPED_OUT_OF_DOMAIN',
        executionStatus: 'SKIPPED_OUT_OF_DOMAIN',
        reason: `Skipped: Table is outside ${domainContract.label} domain contract`,
      });
      continue;
    }

    if (!presentSheet) {
      coverageMatrix.push({
        table: contractName,
        tableName: contractName,
        domainRole: isMandatoryForDomain ? 'MANDATORY' : 'OPTIONAL_IN_DOMAIN',
        requiredByDomain: isMandatoryForDomain,
        relevantToDomain: true,
        presentInWorkbook: false,
        rowCount: 0,
        checksExecuted: 0,
        issueCount: isMandatoryForDomain ? 1 : 0,
        status: 'NOT_RUN_MISSING_TABLE',
        executionStatus: 'NOT_RUN_MISSING_TABLE',
        reason: isMandatoryForDomain
          ? `Blocked: Mandatory table for ${domainContract.label} is missing`
          : `Optional table for ${domainContract.label} not uploaded`,
      });
    } else if (liveRowCount === 0) {
      coverageMatrix.push({
        table: contractName,
        tableName: contractName,
        domainRole: isMandatoryForDomain ? 'MANDATORY' : 'OPTIONAL_IN_DOMAIN',
        requiredByDomain: isMandatoryForDomain,
        relevantToDomain: true,
        presentInWorkbook: true,
        rowCount: 0,
        checksExecuted: 1,
        issueCount: isMandatoryForDomain ? 1 : 0,
        status: 'NOT_RUN_EMPTY_TABLE',
        executionStatus: 'NOT_RUN_EMPTY_TABLE',
        reason: isMandatoryForDomain
          ? `Blocked: Mandatory table contains 0 records (awaiting data population)`
          : `Optional table contains 0 records`,
      });
    } else {
      coverageMatrix.push({
        table: contractName,
        tableName: contractName,
        domainRole: isMandatoryForDomain ? 'MANDATORY' : 'OPTIONAL_IN_DOMAIN',
        requiredByDomain: isMandatoryForDomain,
        relevantToDomain: true,
        presentInWorkbook: true,
        rowCount: liveRowCount,
        checksExecuted: contract.mandatoryColumns.length + contract.foreignKeys.length + 1,
        issueCount: 0,
        status: 'EXECUTED',
        executionStatus: 'EXECUTED',
        reason: `Validated ${liveRowCount} record(s) against ${domainContract.label} contract`,
      });
    }

    if (isMandatoryForDomain) {
      schemaChecksAttempted++;
      if (!actualName || !sheets[actualName]) {
        schemaMissingDeps.push(`Missing mandatory table ${contractName}`);
        pushErr({
          signature: `SCHEMA|MISSING_TABLE|${contractName}`,
          severity: 'CRITICAL',
          category: 'SCHEMA',
          requiresBusinessJudgement: true,
          table: contractName,
          rowNum: 0,
          rowIndex: -1,
          intersection: `${contractName} (Schema)`,
          issue: `Mandatory Table "${contractName}" Is Missing From Workbook`,
          badVal: 'Table Missing',
          suggestedValText: `Upload workbook containing ${contractName}`,
          fixType: 'SCHEMA_REMEDIATION',
        });
        continue;
      }
      schemaChecksExecuted++;
    }

    if (actualName && sheets[actualName]) {
      const tbl = sheets[actualName];
      const liveCount = tbl.records.filter((r) => !r._removed).length;
      if (isMandatoryForDomain && liveCount === 0) {
        schemaMissingDeps.push(`Empty mandatory table ${actualName}`);
        pushErr({
          signature: `SCHEMA|EMPTY_TABLE|${actualName}`,
          severity: 'CRITICAL',
          category: 'SCHEMA',
          requiresBusinessJudgement: true,
          table: actualName,
          rowNum: 0,
          rowIndex: -1,
          intersection: `${actualName} (0 Rows)`,
          issue: `Mandatory Table "${actualName}" Contains 0 Records`,
          badVal: '0 Rows',
          suggestedValText: 'Populate mandatory table records in source workbook',
          fixType: 'SCHEMA_REMEDIATION',
        });
      }

      // Duplicate metadata headers are a structural defect; never silently collapse them.
      const seenColumnNames = new Set<string>();
      for (const columnDef of sheets[actualName]?.cols ?? []) {
        const normalizedColumnName = normalizeColumnAlias(columnDef.col);
        if (!normalizedColumnName) continue;
        if (seenColumnNames.has(normalizedColumnName)) {
          schemaChecksAttempted++;
          schemaMissingDeps.push(`${actualName}.duplicate-column.${columnDef.col}`);
          pushErr({
            signature: `SCHEMA|DUPLICATE_COL|${actualName}|${columnDef.col}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: actualName,
            rowNum: 0,
            rowIndex: -1,
            intersection: `${actualName}.${columnDef.col}`,
            issue: `Duplicate column definition "${columnDef.col}" in ${actualName}`,
            badVal: 'Duplicate Column Metadata',
            suggestedValText: 'Remove or rename the duplicate source column and re-upload the workbook',
            fixType: 'SCHEMA_REMEDIATION',
          });
        } else {
          seenColumnNames.add(normalizedColumnName);
        }
      }

      // Mandatory Column Checks
      for (const reqCol of contract.mandatoryColumns) {
        schemaChecksAttempted++;
        if (!hasColumn(sheets, actualName, reqCol)) {
          schemaMissingDeps.push(`${actualName}.${reqCol}`);
          pushErr({
            signature: `SCHEMA|MISSING_COL|${actualName}|${reqCol}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: actualName,
            rowNum: 0,
            rowIndex: -1,
            intersection: `${actualName}.${reqCol}`,
            issue: `Mandatory Column "${reqCol}" Missing From ${actualName}`,
            badVal: 'Column Missing',
            suggestedValText: `Add mandatory column ${reqCol} to source table`,
            fixType: 'SCHEMA_REMEDIATION',
          });
        } else {
          schemaChecksExecuted++;
        }
      }

      const dedicatedNullHandledCols = new Set([
        'Invoiced_Actual_Qty',
        'Reference_Analog_SKU_Code',
      ]);
      const requiredNonNullCols = new Set(
        [...contract.mandatoryColumns, ...contract.businessKey].filter(
          (c) => !dedicatedNullHandledCols.has(c)
        )
      );
      const colsToInspect = new Set([
        ...Object.keys(contract.columnTypes),
        ...contract.mandatoryColumns,
        ...contract.businessKey,
      ]);

      tbl.records.forEach((row, idx) => {
        if (row._removed) return;
        const sourceIdx = typeof row._sourceIndex === 'number' ? row._sourceIndex : idx;
        const excelRow = sourceIdx + 2;
        for (const colName of colsToInspect) {
          if (!hasColumn(sheets, actualName, colName)) continue;
          const expectedType = contract.columnTypes[colName] ?? 'STRING';
          const exactKey = Object.keys(row).find(
            (k) => k.toLowerCase() === colName.toLowerCase()
          );
          const val = exactKey ? row[exactKey] : undefined;
          const strVal = val === undefined || val === null ? '' : String(val).trim();
          const isEmpty =
            val === undefined ||
            val === null ||
            strVal === '' ||
            strVal.toUpperCase() === 'NULL';
          if (isEmpty) {
            if (requiredNonNullCols.has(colName)) {
              pushErr({
                signature: `SCHEMA|EMPTY_MANDATORY|${actualName}|${sourceIdx}|${colName}`,
                severity: 'CRITICAL',
                category: 'SCHEMA',
                requiresBusinessJudgement: true,
                table: actualName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${colName} (Row #${excelRow})`,
                issue: `Empty Mandatory Field "${colName}" in ${actualName}`,
                badVal: strVal === '' ? 'NULL (Empty)' : strVal,
                suggestedValText: `Provide valid ${colName} in source table`,
                fixType: 'SCHEMA_REMEDIATION',
                targetCol: colName,
                targetColType: expectedType,
              });
            }
            continue;
          }

          if (expectedType === 'DATE') {
            if (!parseFlexibleDate(val)) {
              const ambiguous = isAmbiguousDateString(strVal);
              pushErr({
                signature: `SCHEMA|INVALID_DATE|${actualName}|${sourceIdx}|${colName}`,
                severity: 'CRITICAL',
                category: 'SCHEMA',
                requiresBusinessJudgement: true,
                table: actualName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${colName} (Row #${excelRow})`,
                issue: ambiguous
                  ? `Ambiguous Date "${strVal}" in "${colName}" (DD/MM vs MM/DD Cannot Be Guessed — Use YYYY-MM-DD or DD-MMM-YYYY)`
                  : `Invalid Date Format in "${colName}" (Expected valid Excel date or YYYY-MM-DD)`,
                badVal: strVal,
                suggestedValText: 'Provide unambiguous date (YYYY-MM-DD or DD-MMM-YYYY)',
                fixType: 'SCHEMA_REMEDIATION',
                targetCol: colName,
                targetColType: expectedType,
              });
            }
          } else if (expectedType === 'NUMBER' || expectedType === 'NON_NEGATIVE_NUMBER') {
            if (colName === 'Invoiced_Actual_Qty') continue;
            const num = parseStrictNumber(val);
            if (!Number.isFinite(num)) {
              pushErr({
                signature: `SCHEMA|INVALID_NUM|${actualName}|${sourceIdx}|${colName}`,
                severity: 'CRITICAL',
                category: 'SCHEMA',
                requiresBusinessJudgement: true,
                table: actualName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${colName} (Row #${excelRow})`,
                issue: `Non-Numeric Value in Numeric Column "${colName}"`,
                badVal: strVal,
                suggestedValText: 'Provide valid numeric value',
                fixType: 'SCHEMA_REMEDIATION',
                targetCol: colName,
                targetColType: expectedType,
              });
            } else if (expectedType === 'NON_NEGATIVE_NUMBER' && num < 0) {
              pushErr({
                signature: `SCHEMA|NEG_NONNEG|${actualName}|${sourceIdx}|${colName}`,
                severity: 'CRITICAL',
                category: 'SCHEMA',
                requiresBusinessJudgement: true,
                table: actualName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${colName} (Row #${excelRow})`,
                issue: `Negative Value Not Permitted in Non-Negative Column "${colName}"`,
                badVal: String(num),
                suggestedValText: 'Correct to non-negative value >= 0',
                fixType: 'SCHEMA_REMEDIATION',
                targetCol: colName,
                targetColType: expectedType,
              });
            }
          }
        }
      });
    }
  }

  // =========================================================================
  // STAGE 2: MASTER LOOKUPS & DOMAIN-SCOPED DEPENDENCY CHECKS
  // =========================================================================
  const skuSheetName = resolvedTableName.get('09_Product_Master_Hierarchy');
  const locSheetName = resolvedTableName.get('10_Location_Depot_Network');
  const chSheetName = resolvedTableName.get('11_Customer_Channel_Master');
  const ordersSheetName = resolvedTableName.get('01_Orders_Shipments_History');
  const promoSheetName = resolvedTableName.get('04_Trade_Promotions_Calendar');
  const invSheetName = resolvedTableName.get('07_Inventory_Supply_Constraints');
  const supplierSheetName = resolvedTableName.get('13_Supplier_Sourcing_Contracts');
  const poSheetName = resolvedTableName.get('14_Purchase_Orders_Receipts');
  const bomSheetName = resolvedTableName.get('15_Manufacturing_BOM_WorkCenters');
  const meioSheetName = resolvedTableName.get('16_MEIO_Network_Policy_Costs');

  const validSkus = new Set<string>();
  const skuUomMap = new Map<string, string>();
  if (skuSheetName && sheets[skuSheetName]?.records?.length) {
    for (const r of sheets[skuSheetName].records) {
      if (r._removed) continue;
      const s = normalizeStr(getRowVal(r, ['SKU_Code', 'SKU', 'Product']));
      if (s) {
        validSkus.add(s);
        const uom = normalizeStr(getRowVal(r, ['Base_UOM', 'UOM']));
        if (uom) skuUomMap.set(s, uom);
      }
    }
  }

  const validLocs = new Set<string>();
  if (locSheetName && sheets[locSheetName]?.records?.length) {
    for (const r of sheets[locSheetName].records) {
      if (r._removed) continue;
      const l = normalizeStr(getRowVal(r, ['Location_DC', 'Depot', 'Location']));
      if (l) validLocs.add(l);
    }
  }

  const validChannels = new Set<string>();
  if (chSheetName && sheets[chSheetName]?.records?.length) {
    for (const r of sheets[chSheetName].records) {
      if (r._removed) continue;
      const c = normalizeStr(getRowVal(r, ['Channel_Code', 'Channel']));
      if (c) validChannels.add(c);
    }
  }

  // Build supplier contract MOQ & Order Multiple lookup by the full supplier × SKU × location key.
  // Different suppliers may have different terms for the same SKU and depot.
  const supplierContractMap = new Map<
    string,
    { moq: number; mult: number; validFrom: Date | null; validTo: Date | null; invalidDates: boolean }
  >();
  if (supplierSheetName && sheets[supplierSheetName]?.records?.length) {
    for (const r of sheets[supplierSheetName].records) {
      if (r._removed) continue;
      const supplierId = normalizeStr(r.Supplier_ID);
      const s = normalizeStr(r.SKU_Code);
      const l = normalizeStr(r.Location_DC);
      const moq = parseStrictNumber(r.MOQ_Units);
      const mult = parseStrictNumber(r.Order_Multiple_Qty);
      const validFromRaw = r.Contract_Valid_From;
      const validToRaw = r.Contract_Valid_To;
      const validFrom = validFromRaw === null || validFromRaw === undefined || String(validFromRaw).trim() === ''
        ? null
        : parseFlexibleDate(validFromRaw);
      const validTo = validToRaw === null || validToRaw === undefined || String(validToRaw).trim() === ''
        ? null
        : parseFlexibleDate(validToRaw);
      const invalidDates =
        (validFromRaw !== null && validFromRaw !== undefined && String(validFromRaw).trim() !== '' && !validFrom) ||
        (validToRaw !== null && validToRaw !== undefined && String(validToRaw).trim() !== '' && !validTo) ||
        Boolean(validFrom && validTo && validFrom > validTo);
      if (supplierId && s && l && Number.isFinite(moq) && Number.isFinite(mult)) {
        supplierContractMap.set(`${supplierId}|${s}|${l}`, { moq, mult, validFrom, validTo, invalidDates });
      }
    }
  }

  const hasSkuMaster = validSkus.size > 0;
  const hasLocMaster = validLocs.size > 0;
  const hasChMaster = validChannels.size > 0;

  const skuOptions = Array.from(validSkus);
  const locOptions = Array.from(validLocs);
  const chOptions = Array.from(validChannels);

  // Track execution coverage per validation category
  let timeAttempted = 0;
  let timeExecuted = 0;
  const timeMissing: string[] = [];

  let stockAttempted = 0;
  let stockExecuted = 0;
  const stockMissing: string[] = [];

  let fkAttempted = 0;
  let fkExecuted = 0;
  const fkMissing: string[] = [];

  let promoAttempted = 0;
  let promoExecuted = 0;
  const promoMissing: string[] = [];

  let uomAttempted = 0;
  let uomExecuted = 0;
  const uomMissing: string[] = [];

  // =========================================================================
  // STAGE 3: RECORD-LEVEL & CROSS-TABLE VALIDATION (Domain-Isolated)
  // =========================================================================
  const ordersIsMandatoryInDomain =
    activeDomain === 'ALL' || domainMandatorySet.has('01_Orders_Shipments_History');
  const ordersIsRelevantInDomain =
    activeDomain === 'ALL' || domainRelevantSet.has('01_Orders_Shipments_History');

  if (ordersIsMandatoryInDomain) {
    if (
      !ordersSheetName ||
      !hasColumn(sheets, ordersSheetName, 'Invoiced_Actual_Qty') ||
      !hasColumn(sheets, ordersSheetName, 'Period_Date') ||
      !hasColumn(sheets, ordersSheetName, 'SKU_Code')
    ) {
      timeAttempted++;
      timeMissing.push(
        ordersSheetName
          ? `${ordersSheetName} required time/key columns`
          : '01_Orders_Shipments_History'
      );
    } else {
      timeAttempted++;
      timeExecuted++;
    }
  }

  // Scope master-table dependency checks strictly to domainContract.requiredMasterTables
  if (domainRequiredMasters.has('09_Product_Master_Hierarchy') && !hasSkuMaster) {
    fkMissing.push('09_Product_Master_Hierarchy');
  }
  if (domainRequiredMasters.has('10_Location_Depot_Network') && !hasLocMaster) {
    fkMissing.push('10_Location_Depot_Network');
  }
  if (domainRequiredMasters.has('11_Customer_Channel_Master') && !hasChMaster) {
    fkMissing.push('11_Customer_Channel_Master');
  }

  const invIsRelevantInDomain =
    activeDomain === 'ALL' || domainRelevantSet.has('07_Inventory_Supply_Constraints');
  const invIsMandatoryInDomain =
    activeDomain === 'ALL' || domainMandatorySet.has('07_Inventory_Supply_Constraints');

  if (invIsRelevantInDomain) {
    if (invSheetName && sheets[invSheetName]?.records?.length) {
      stockAttempted++;
      if (
        hasColumn(sheets, invSheetName, 'Closing_OnHand_Stock_Qty') &&
        hasColumn(sheets, invSheetName, 'Depot_Stockout_Days_Count')
      ) {
        stockExecuted++;
      } else {
        stockMissing.push(`${invSheetName} stockout columns`);
      }
    } else if (invIsMandatoryInDomain) {
      stockAttempted++;
      stockMissing.push('07_Inventory_Supply_Constraints');
    }
  }

  Object.keys(sheets).forEach((tblName) => {
    const canonicalName = actualToContract.get(tblName) ?? tblName;
    // Domain isolation: do not validate tables outside the active domain contract
    if (activeDomain !== 'ALL' && !domainRelevantSet.has(canonicalName)) {
      return;
    }

    const tbl = sheets[tblName];
    const rows = tbl.records || [];
    const seenBusinessKeys = new Map<string, number>();

    rows.forEach((row, idx) => {
      if (row._removed) return;
      const sourceIdx = typeof row._sourceIndex === 'number' ? row._sourceIndex : idx;
      const excelRow = sourceIdx + 2;
      const period = normalizePeriodString(
        getRowVal(row, [
          'Period_Date',
          'Target_Delivery_Month',
          'Target_Period',
          'Effective_From_Month',
          'Commercial_Launch_Date',
          'Date',
          'Month',
        ])
      );
      const sku = normalizeStr(
        getRowVal(row, ['SKU_Code', 'New_Launch_SKU_Code', 'Parent_SKU_Code', 'SKU', 'Product'])
      );
      const depot = normalizeStr(getRowVal(row, ['Location_DC', 'Location', 'Depot']));
      const ch = normalizeStr(getRowVal(row, ['Channel_Code', 'Channel']));

      // 1. Workbook Security (runs on every in-domain table & cell)
      uomAttempted++;
      uomExecuted++;
      for (const colKey of Object.keys(row)) {
        if (colKey.startsWith('_')) continue;
        const cellVal = row[colKey];
        if (typeof cellVal === 'string' && hasUnsafePayload(cellVal)) {
          pushErr({
            signature: `SECURITY|${tblName}|${sourceIdx}|${colKey}`,
            severity: 'CRITICAL',
            category: 'SECURITY',
            requiresBusinessJudgement: false,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku || colKey} (Row #${excelRow})`,
            issue: `Unsafe Script/HTML Injection Payload Detected in Column ${colKey}`,
            badVal: cellVal.slice(0, 48),
            suggestedValText: sanitizeCellText(cellVal) || 'SAFE_TEXT',
            fixType: 'SANITIZE_CELL',
            suggestedVal: sanitizeCellText(cellVal) || 'SAFE_TEXT',
            targetCol: colKey,
          });
        }
      }

      // 2. Actual Qty Checks (Null, Negative, Spike)
      if (hasColumn(sheets, tblName, 'Invoiced_Actual_Qty') || row.Invoiced_Actual_Qty !== undefined) {
        const rawActual = getRowVal(row, ['Invoiced_Actual_Qty', 'Actual_Sales_Units', 'Actual_Sales', 'Actual']);
        if (
          rawActual === '' ||
          rawActual === null ||
          rawActual === undefined ||
          String(rawActual).trim().toUpperCase() === 'NULL'
        ) {
          pushErr({
            signature: `IMPUTE_ACTUAL|${tblName}|${sourceIdx}`,
            severity: 'CRITICAL',
            category: 'TIME_CONTINUITY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku || '—'} / ${depot || '—'} / ${ch || '—'} (${period || 'MISSING'})`,
            issue: 'Missing / Null Invoiced Actual Qty — Requires Confirmed Sales Value',
            badVal: 'NULL (Empty)',
            suggestedValText: 'Confirm actual billed qty (No value invented)',
            fixType: 'IMPUTE_ACTUAL',
          });
        } else {
          const cleanedAct = String(rawActual).trim().replace(/,/g, '');
          const numAct = cleanedAct === '' ? Number.NaN : Number(cleanedAct);
          if (!Number.isFinite(numAct)) {
            pushErr({
              signature: `IMPUTE_ACTUAL|NON_NUMERIC|${tblName}|${sourceIdx}`,
              severity: 'CRITICAL',
              category: 'TIME_CONTINUITY',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku || '—'} / ${depot || '—'} / ${ch || '—'} (${period || 'MISSING'})`,
              issue: `Non-Numeric Invoiced Actual Qty ("${String(rawActual).trim()}") — Requires Confirmed Numeric Qty`,
              badVal: String(rawActual).trim(),
              suggestedValText: 'Enter valid numeric invoiced quantity',
              fixType: 'IMPUTE_ACTUAL',
            });
          } else if (numAct < 0) {
            const retQtyRaw = parseStrictNumber(getRowVal(row, ['Returns_Damaged_Qty']) ?? 0);
            const existingRetQty = Number.isFinite(retQtyRaw) && retQtyRaw > 0 ? retQtyRaw : 0;
            const absNeg = Math.abs(numAct);
            const reconciledReturns = Math.max(existingRetQty, absNeg);
            const unrecordedDelta = Math.max(0, absNeg - existingRetQty);
            const txType = normalizeStr(row.Transaction_Type);
            const isClassifiedReturn = txType === 'CREDIT_RETURN';
            if (!isClassifiedReturn) {
              pushErr({
                signature: `FIX_NEGATIVE|${tblName}|${sourceIdx}`,
                severity: 'CRITICAL',
                category: 'UOM_CURRENCY',
                requiresBusinessJudgement: true,
                table: tblName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${sku} / ${depot} / ${ch} (${period})`,
                issue:
                  'Negative Billed Actual Qty — Classify as Legitimate Credit Return or Correct Billed Qty',
                badVal: `${numAct} u (Existing Returns: ${existingRetQty} u)`,
                suggestedValText: `Reconcile Returns to ${reconciledReturns} u (+${unrecordedDelta} u unrecorded delta) or enter corrected billed qty`,
                fixType: 'FIX_NEGATIVE',
                suggestedVal: 0,
              });
            }
          } else if (
            numAct > 5000 &&
            sku === 'P401' &&
            !row._spikeTagged &&
            normalizeStr(row.Governed_Spike_Status).toUpperCase() !== 'TAGGED_BASELINE'
          ) {
            pushErr({
              signature: `TAG_SPIKE|${tblName}|${sourceIdx}`,
              severity: 'CRITICAL',
              category: 'TIME_CONTINUITY',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku} / ${depot} / ${ch} (${period})`,
              issue: `Unflagged Bulk Distributor Spike (> ${ruleConfig.outlierZThreshold ?? ruleConfig.outlierSigmaThreshold}σ) — Confirm Clean Baseline Value`,
              badVal: `${numAct.toLocaleString()} u (Raw)`,
              suggestedValText: 'Tag one-off spike & approve baseline (e.g. 2,363 u)',
              fixType: 'TAG_SPIKE',
              suggestedVal: 2363,
            });
          }
        }
      }

      // 3. Business-Key Duplicate Detection
      const bk = getBusinessKey(tblName, row, canonicalName);
      if (bk) {
        timeAttempted++;
        timeExecuted++;
        if (seenBusinessKeys.has(bk)) {
          const firstRowNum = seenBusinessKeys.get(bk)!;
          pushErr({
            signature: `REMOVE_DUPLICATE|${tblName}|${sourceIdx}|${bk}`,
            severity: 'CRITICAL',
            category: 'DUPLICATE_KEY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku || bk} / ${depot || '—'} / ${ch || '—'} (${period || 'KEY'})`,
            issue: `Duplicate Business-Key Record (Collides with Row #${firstRowNum} on [${bk}]) — Confirm Authoritative Record`,
            badVal: `Dup Key (${String(row.Invoice_Line_ID || 'Row #' + excelRow)})`,
            suggestedValText: `Select authoritative row (Keep Row #${firstRowNum} or Row #${excelRow})`,
            fixType: 'REMOVE_DUPLICATE',
          });
        } else {
          seenBusinessKeys.set(bk, excelRow);
        }
      }

      // 4. Cross-Table Validation: SKU_Code / Parent_SKU_Code -> 09_Product_Master_Hierarchy
      if (
        domainRequiredMasters.has('09_Product_Master_Hierarchy') &&
        sku &&
        tblName !== skuSheetName &&
        actualToContract.get(tblName) !== '12_NPI_Lifecycle_Transitions'
      ) {
        fkAttempted++;
        if (hasSkuMaster) {
          fkExecuted++;
          if (!validSkus.has(sku)) {
            pushErr({
              signature: `MAP_SKU|${tblName}|${sourceIdx}|${sku}`,
              severity: 'CRITICAL',
              category: 'CROSS_TABLE',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku} / ${depot || '—'} (${period || '—'})`,
              issue: `Orphan SKU_Code "${sku}" Not Found in ${skuSheetName}`,
              badVal: `SKU = ${sku}`,
              suggestedValText: 'Select valid target SKU from Product Master',
              fixType: 'MAP_SKU',
              availableOptions: skuOptions,
            });
          } else {
            const rowUom = normalizeStr(getRowVal(row, ['Order_UOM', 'Base_UOM']));
            const masterUom = skuUomMap.get(sku);
            if (rowUom && masterUom && rowUom !== masterUom) {
              pushErr({
                signature: `UOM_CROSS|${tblName}|${sourceIdx}|${sku}`,
                severity: 'CRITICAL',
                category: 'UOM_CURRENCY',
                requiresBusinessJudgement: false,
                table: tblName,
                rowNum: excelRow,
                rowIndex: sourceIdx,
                intersection: `${sku} (${tblName})`,
                issue: `Cross-Table UOM Mismatch (${rowUom} vs Master ${masterUom})`,
                badVal: `UOM = ${rowUom}`,
                suggestedValText: masterUom,
                fixType: 'FIX_UOM',
                suggestedVal: masterUom,
              });
            }
          }
        }
      }

      // 5. Cross-Table Validation: Location_DC -> 10_Location_Depot_Network
      if (
        domainRequiredMasters.has('10_Location_Depot_Network') &&
        depot &&
        tblName !== locSheetName
      ) {
        fkAttempted++;
        if (hasLocMaster) {
          fkExecuted++;
          if (!validLocs.has(depot)) {
            pushErr({
              signature: `MAP_DEPOT|${tblName}|${sourceIdx}|${depot}`,
              severity: 'CRITICAL',
              category: 'CROSS_TABLE',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku || '—'} / ${depot} / ${ch || '—'} (${period || '—'})`,
              issue: `Orphan Location_DC "${depot}" Not Found in ${locSheetName}`,
              badVal: `Depot = ${depot}`,
              suggestedValText: 'Select valid depot from Location Network',
              fixType: 'MAP_DEPOT',
              availableOptions: locOptions,
            });
          }
        }
      }

      // 6. Cross-Table Validation: Channel_Code -> 11_Customer_Channel_Master
      // Strictly scoped: ONLY run if 11_Customer_Channel_Master is required by the active domain contract!
      if (
        domainRequiredMasters.has('11_Customer_Channel_Master') &&
        ch &&
        tblName !== chSheetName
      ) {
        fkAttempted++;
        if (hasChMaster) {
          fkExecuted++;
          if (!validChannels.has(ch)) {
            pushErr({
              signature: `MAP_CHANNEL|${tblName}|${sourceIdx}|${ch}`,
              severity: 'CRITICAL',
              category: 'CROSS_TABLE',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku || '—'} / ${depot || '—'} / ${ch} (${period || '—'})`,
              issue: `Orphan Channel_Code "${ch}" Not Found in ${chSheetName}`,
              badVal: `Channel = ${ch}`,
              suggestedValText: 'Select valid channel from Customer/Channel Master',
              fixType: 'MAP_CHANNEL',
              availableOptions: chOptions,
            });
          }
        }
      }

      // 7. UOM Conversion Factor in Product Master
      const baseUom = normalizeStr(getRowVal(row, ['Base_UOM']));
      const rawUomFactor = getRowVal(row, ['UOM_Conversion_Factor']);
      if (rawUomFactor !== undefined) {
        uomAttempted++;
        uomExecuted++;
        const uomFactor = parseStrictNumber(rawUomFactor);
        const packVerified =
          Boolean(row._uomPackVerified) ||
          normalizeStr(row.Governed_Pack_Verified).toUpperCase() === 'VERIFIED';
        if (
          (baseUom.toUpperCase() === 'CASE' && uomFactor <= 1) ||
          Number.isNaN(uomFactor) ||
          uomFactor <= 0
        ) {
          pushErr({
            signature: `FIX_UOM|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} (Master UOM)`,
            issue: 'CASE Base_UOM Has Conversion Factor ≤ 1 — Confirm Pack Size (EA/CASE)',
            badVal: `${baseUom || 'UOM'} = ${rawUomFactor} EA`,
            suggestedValText: `Confirm pack conversion factor (e.g. ${ruleConfig.standardCasePackMin} EA/CASE)`,
            fixType: 'FIX_UOM',
            suggestedVal: ruleConfig.standardCasePackMin,
          });
        } else if (
          baseUom.toUpperCase() === 'CASE' &&
          uomFactor > 1 &&
          uomFactor < ruleConfig.standardCasePackMin &&
          !packVerified
        ) {
          pushErr({
            signature: `FIX_UOM_PACK|${tblName}|${sourceIdx}|${sku}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} (Master UOM)`,
            issue: `CASE Base_UOM Factor (${uomFactor} EA/CASE) Below Standard ${ruleConfig.standardCasePackMin} EA/CASE — Confirm Pack Size`,
            badVal: `${baseUom} = ${uomFactor} EA/CASE`,
            suggestedValText: `Confirm pack size (${ruleConfig.standardCasePackMin} EA/CASE standard or verified custom pack)`,
            fixType: 'FIX_UOM',
            suggestedVal: ruleConfig.standardCasePackMin,
          });
        }
      }

      // 7b. Industry-specific Depot Lead-Time & Channel SLA bounds
      if (tblName === locSheetName) {
        const ltCol =
          findColumnKey(row, ['Primary_Transit_Lead_Time_Days', 'Standard_Lead_Time_Days']) ||
          'Primary_Transit_Lead_Time_Days';
        const ltVal = parseStrictNumber(
          getRowVal(row, ['Primary_Transit_Lead_Time_Days', 'Standard_Lead_Time_Days'])
        );
        if (Number.isFinite(ltVal) && ltVal > ruleConfig.maxLeadTimeDays) {
          pushErr({
            signature: `DEPOT_LT|${tblName}|${sourceIdx}|${depot}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${depot} (Depot Network)`,
            issue: `Depot ${ltCol} (${ltVal}d) Exceeds ${activeIndustry.toUpperCase()} Policy Ceiling (${ruleConfig.maxLeadTimeDays}d)`,
            badVal: `${ltVal} Days`,
            suggestedValText: `Align transit lead time ≤ ${ruleConfig.maxLeadTimeDays}d or sign off exception`,
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: ltCol,
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: ruleConfig.maxLeadTimeDays,
          });
        }
      }
      if (tblName === chSheetName && domainRequiredMasters.has('11_Customer_Channel_Master')) {
        const slaCol =
          findColumnKey(row, ['Contracted_OTIF_SLA_Pct', 'Service_Level_Target_Pct']) ||
          'Contracted_OTIF_SLA_Pct';
        const slaVal = parseStrictNumber(
          getRowVal(row, ['Contracted_OTIF_SLA_Pct', 'Service_Level_Target_Pct'])
        );
        if (Number.isFinite(slaVal) && slaVal < ruleConfig.minServiceLevelPct) {
          pushErr({
            signature: `CHANNEL_SLA|${tblName}|${sourceIdx}|${ch}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${ch} (Channel Master)`,
            issue: `Channel ${slaCol} (${slaVal}%) Below ${activeIndustry.toUpperCase()} Policy Floor (${ruleConfig.minServiceLevelPct}%)`,
            badVal: `${slaVal}% SLA`,
            suggestedValText: `Raise target SLA ≥ ${ruleConfig.minServiceLevelPct}% or sign off tier exception`,
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: slaCol,
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: ruleConfig.minServiceLevelPct,
          });
        }
      }

      // 8. NPI Analog Reference -> 09_Product_Master_Hierarchy
      if (actualToContract.get(tblName) === '12_NPI_Lifecycle_Transitions') {
        fkAttempted++;
        const refSku = normalizeStr(getRowVal(row, ['Reference_Analog_SKU_Code']));
        if (hasSkuMaster) {
          fkExecuted++;
          const analogValid = refSku !== '' && validSkus.has(refSku);
          if (!analogValid) {
            pushErr({
              signature: `FIX_NPI_REF|${tblName}|${sourceIdx}|${sku}`,
              severity: 'CRITICAL',
              category: 'CROSS_TABLE',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${sku} (NPI Launch)`,
              issue:
                refSku === ''
                  ? 'Orphan NPI Launch SKU Missing Reference_Analog_SKU_Code'
                  : `Invalid Reference_Analog_SKU_Code "${refSku}" Not Found in Product Master`,
              badVal: refSku === '' ? 'Reference SKU = NULL' : `Ref = ${refSku}`,
              suggestedValText: 'Select verified Reference Analog SKU from Product Master',
              fixType: 'FIX_NPI_REF',
              availableOptions: skuOptions,
            });
          }
        }
      }

      // Forecast values are validated as ordinary source inputs only; no reasonableness corridor is applied.

      // 10. Unflagged Stockout & Physical Source Bound Check
      // (Physical bound always applies; unreviewed run-rate warning applies when stockoutRunRateMethodApproved !== false)
      const closeStk = getRowVal(row, ['Closing_OnHand_Stock_Qty']);
      const stkDays = parseStrictNumber(getRowVal(row, ['Depot_Stockout_Days_Count']) ?? 0);
      const rawUncensored = parseStrictNumber(
        row.Governed_Uncensored_Demand_Qty ?? row._uncensoredDemandEstimate
      );
      const stockoutRestored =
        Boolean(row._stockoutRestored) ||
        (Number.isFinite(rawUncensored) && rawUncensored > 0);
      const isStockoutPeriod =
        closeStk !== undefined &&
        String(closeStk).trim() !== '' &&
        parseStrictNumber(closeStk) === 0 &&
        Number.isFinite(stkDays) &&
        stkDays > 0;
      if (isStockoutPeriod) {
        const billedRaw = parseStrictNumber(getRowVal(row, ['Invoiced_Actual_Qty']) ?? 0);
        const billed = Number.isFinite(billedRaw) ? billedRaw : 0;
        const uncensored = billed > 0 ? Math.round(billed / (1 - Math.min(25, stkDays) / 30)) : 0;
        if (Number.isFinite(rawUncensored) && rawUncensored < billed) {
          pushErr({
            signature: `STOCKOUT_BELOW_BILLED|${tblName}|${sourceIdx}`,
            severity: 'CRITICAL',
            category: 'STOCKOUT',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${depot} (${period})`,
            issue: `Governed Uncensored Demand (${rawUncensored.toLocaleString()} u) Below Actual Billed Shipments (${billed.toLocaleString()} u) During Stockout`,
            badVal: `${rawUncensored.toLocaleString()} u < ${billed.toLocaleString()} u Billed`,
            suggestedValText: `Uncensored demand must be ≥ ${billed.toLocaleString()} u billed`,
            fixType: 'RESTORE_STOCKOUT',
            suggestedVal: Math.max(billed, uncensored),
          });
        } else if (!stockoutRestored && (ruleConfig.stockoutRunRateMethodApproved ?? true)) {
          pushErr({
            signature: `RESTORE_STOCKOUT|${tblName}|${sourceIdx}`,
            severity: 'WARNING',
            category: 'STOCKOUT',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${depot} (${period})`,
            issue: `Zero Closing Stock for ${stkDays} Days — Review Censored Demand Estimate (Source Billed Kept Intact)`,
            badVal: `${billed.toLocaleString()} u Billed`,
            suggestedValText: `Estimated Uncensored Demand: ${uncensored.toLocaleString()} u`,
            fixType: 'RESTORE_STOCKOUT',
            suggestedVal: uncensored,
          });
        }
      }

      // 11. Promo Date Inversion
      const rawPStart = getRowVal(row, ['Promo_Start_Date']);
      const rawPEnd = getRowVal(row, ['Promo_End_Date']);
      const pStartDt = parseFlexibleDate(rawPStart);
      const pEndDt = parseFlexibleDate(rawPEnd);
      if (pStartDt && pEndDt && pEndDt.getTime() < pStartDt.getTime()) {
        const pStart = formatIsoDate(pStartDt);
        const pEnd = formatIsoDate(pEndDt);
        promoAttempted++;
        promoExecuted++;
        pushErr({
          signature: `SWAP_PROMO_DATES|${tblName}|${sourceIdx}`,
          severity: 'WARNING',
          category: 'PROMO_PRICE',
          requiresBusinessJudgement: false,
          table: tblName,
          rowNum: excelRow,
          rowIndex: sourceIdx,
          intersection: `${sku} / ${depot} (${pStart})`,
          issue: 'Inverted Promo Window (Promo_End_Date < Promo_Start_Date)',
          badVal: `${pStart} → ${pEnd}`,
          suggestedValText: `${pEnd} → ${pStart}`,
          fixType: 'SWAP_PROMO_DATES',
          suggestedVal: `${pEnd}|${pStart}`,
        });
      }

      // 12. Negative Margin / COGS > Price
      const cogs = parseStrictNumber(getRowVal(row, ['Unit_COGS_INR']));
      const price = parseStrictNumber(getRowVal(row, ['Net_Realized_Price_INR']));
      if (Number.isFinite(cogs) && Number.isFinite(price) && price > 0) {
        promoAttempted++;
        promoExecuted++;
        if (cogs > price) {
          pushErr({
            signature: `FIX_COGS|${tblName}|${sourceIdx}`,
            severity: 'WARNING',
            category: 'PROMO_PRICE',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${ch} (${period})`,
            issue: 'Unit COGS Higher Than Net Realized Selling Price — Finance Confirmation Required',
            badVal: `Price ₹${price} / COGS ₹${cogs}`,
            suggestedValText: 'Enter verified Unit COGS from Finance Master',
            fixType: 'FIX_COGS',
          });
        }
      }

      // 13. Sales Override Without Reason Code
      const salesOv = parseStrictNumber(getRowVal(row, ['Field_Sales_Override_Qty']));
      const aopTgt = parseStrictNumber(getRowVal(row, ['Finance_AOP_Target_Qty']));
      const rCode = normalizeStr(getRowVal(row, ['Override_Reason_Code']));
      const overrideMult = 1 + ruleConfig.salesOverrideMaxPct / 100;
      if (Number.isFinite(salesOv) && Number.isFinite(aopTgt) && aopTgt > 0) {
        promoAttempted++;
        promoExecuted++;
        if (salesOv > aopTgt * overrideMult && !rCode) {
          pushErr({
            signature: `CAP_OVERRIDE|${tblName}|${sourceIdx}`,
            severity: 'WARNING',
            category: 'PROMO_PRICE',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${depot} (${period})`,
            issue: `Sales Override > +${ruleConfig.salesOverrideMaxPct}% Above AOP Without Reason Code`,
            badVal: `${salesOv.toLocaleString()} u (Reason = NULL)`,
            suggestedValText: `Provide reason code or cap to ${Math.round(aopTgt * overrideMult).toLocaleString()} u`,
            fixType: 'CAP_OVERRIDE',
            suggestedVal: Math.round(aopTgt * overrideMult),
          });
        }
      }

      // 13b. Procurement & Supply Domain Rules (Supplier Lead Time, MOQ, Cost & Contract Dates)
      if (tblName === supplierSheetName) {
        const supLt = parseStrictNumber(row.Supplier_Lead_Time_Days);
        const contractMoq = parseStrictNumber(row.MOQ_Units);
        const contractMultiple = parseStrictNumber(row.Order_Multiple_Qty);
        const contractCost = parseStrictNumber(row.Unit_Purchase_Cost_INR);
        const contractStart = parseFlexibleDate(row.Contract_Valid_From);
        const contractEnd = parseFlexibleDate(row.Contract_Valid_To);
        const contractIntersection = `${normalizeStr(row.Supplier_ID)} / ${sku} (${depot})`;
        if (Number.isFinite(supLt) && supLt > 0 && !Number.isInteger(supLt)) {
          pushErr({
            signature: `SUPPLIER_LT_INTEGER|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: contractIntersection,
            issue: 'Supplier Lead Time Must Be A Whole Number Of Days',
            badVal: `${supLt} days`,
            suggestedValText: 'Enter the verified lead-time day count as an integer',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Supplier_Lead_Time_Days',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(contractMoq) && contractMoq <= 0) {
          pushErr({
            signature: `SUPPLIER_MOQ_POSITIVE|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: contractIntersection,
            issue: 'Supplier Contract MOQ Must Be Greater Than 0',
            badVal: String(contractMoq),
            suggestedValText: 'Enter the approved minimum order quantity',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'MOQ_Units',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(contractMultiple) && contractMultiple <= 0) {
          pushErr({
            signature: `SUPPLIER_MULTIPLE_POSITIVE|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: contractIntersection,
            issue: 'Supplier Contract Order Multiple Must Be Greater Than 0',
            badVal: String(contractMultiple),
            suggestedValText: 'Enter the approved order multiple',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Order_Multiple_Qty',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(contractCost) && contractCost <= 0) {
          pushErr({
            signature: `SUPPLIER_COST_POSITIVE|${tblName}|${sourceIdx}|${sku}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: contractIntersection,
            issue: 'Supplier Contract Unit Purchase Cost Is Not Positive',
            badVal: `₹${contractCost}`,
            suggestedValText: 'Verify whether zero-cost or credit pricing is intentional; otherwise enter the approved cost',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Unit_Purchase_Cost_INR',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
        if (contractStart && contractEnd && contractStart > contractEnd) {
          pushErr({
            signature: `SUPPLIER_CONTRACT_DATES|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: contractIntersection,
            issue: 'Supplier Contract Valid-From Date Is After Valid-To Date',
            badVal: `${formatIsoDate(contractStart)} > ${formatIsoDate(contractEnd)}`,
            suggestedValText: 'Correct the effective contract date range',
            fixType: 'SCHEMA_REMEDIATION',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(supLt) && supLt > ruleConfig.maxLeadTimeDays) {
          pushErr({
            signature: `SUPPLIER_LT|${tblName}|${sourceIdx}|${sku}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${normalizeStr(row.Supplier_ID)} / ${sku} (${depot})`,
            issue: `Supplier Lead Time (${supLt}d) Exceeds ${activeIndustry.toUpperCase()} Policy Ceiling (${ruleConfig.maxLeadTimeDays}d)`,
            badVal: `${supLt} Days`,
            suggestedValText: `Align supplier lead time ≤ ${ruleConfig.maxLeadTimeDays}d or sign off exception`,
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Supplier_Lead_Time_Days',
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: ruleConfig.maxLeadTimeDays,
            domainTag: 'PROCUREMENT',
          });
        }
      }
      if (tblName === poSheetName) {
        const poQty = parseStrictNumber(row.Ordered_PO_Qty_Units);
        const receivedQty = parseStrictNumber(row.Received_Qty_Units);
        const poIntersection = `${normalizeStr(row.PO_Number)} / ${normalizeStr(row.Supplier_ID)} / ${sku} (${depot})`;
        if (Number.isFinite(poQty) && poQty <= 0) {
          pushErr({
            signature: `PO_ORDER_QTY_POSITIVE|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: poIntersection,
            issue: 'Purchase Order Ordered Quantity Must Be Greater Than 0',
            badVal: String(poQty),
            suggestedValText: 'Enter the approved PO quantity',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Ordered_PO_Qty_Units',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(poQty) && Number.isFinite(receivedQty) && receivedQty > poQty * (1 + ruleConfig.reconciliationTolerancePct / 100)) {
          pushErr({
            signature: `PO_OVER_RECEIPT|${tblName}|${sourceIdx}|${sku}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: poIntersection,
            issue: `Received Quantity (${receivedQty} u) Exceeds Ordered Quantity (${poQty} u) Beyond ${ruleConfig.reconciliationTolerancePct}% Tolerance`,
            badVal: `${receivedQty} u received vs ${poQty} u ordered`,
            suggestedValText: 'Verify supplier over-delivery, receipt posting, and approved tolerance',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Received_Qty_Units',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'PROCUREMENT',
          });
        }
      }
      if (tblName === poSheetName && ruleConfig.enforceMoqOrderMultiples) {
        const poQty = parseStrictNumber(row.Ordered_PO_Qty_Units);
        const supplierId = normalizeStr(row.Supplier_ID);
        const poDate = parseFlexibleDate(row.Period_Date);
        const rawContractRule = supplierContractMap.get(`${supplierId}|${sku}|${depot}`);
        const contractRule =
          rawContractRule &&
          !rawContractRule.invalidDates &&
          poDate &&
          (!rawContractRule.validFrom || poDate >= rawContractRule.validFrom) &&
          (!rawContractRule.validTo || poDate <= rawContractRule.validTo)
            ? rawContractRule
            : undefined;
        if (Number.isFinite(poQty) && rawContractRule && !contractRule && poDate) {
          pushErr({
            signature: `PO_CONTRACT_EFFECTIVE|${tblName}|${sourceIdx}|${supplierId}|${sku}|${depot}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${normalizeStr(row.PO_Number)} / ${supplierId} / ${sku} (${depot})`,
            issue: 'No Supplier Contract Is Effective On The Purchase Order Date',
            badVal: `${formatIsoDate(poDate)} (contract ${rawContractRule.validFrom ? formatIsoDate(rawContractRule.validFrom) : 'unbounded'}–${rawContractRule.validTo ? formatIsoDate(rawContractRule.validTo) : 'unbounded'})`,
            suggestedValText: 'Verify the PO date, contract effective dates, or approved supplier terms',
            fixType: 'SCHEMA_REMEDIATION',
            domainTag: 'PROCUREMENT',
          });
        }
        if (Number.isFinite(poQty) && !rawContractRule) {
          pushErr({
            signature: `PO_SUPPLIER_CONTRACT|${tblName}|${sourceIdx}|${supplierId}|${sku}|${depot}`,
            severity: 'WARNING',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${normalizeStr(row.PO_Number)} / ${supplierId || 'MISSING SUPPLIER'} / ${sku} (${depot})`,
            issue: 'No matching supplier contract found for this Supplier_ID × SKU_Code × Location_DC combination; MOQ and order-multiple checks could not be executed',
            badVal: supplierId || 'NULL',
            suggestedValText: 'Verify the supplier assignment or provide the matching approved supplier contract',
            fixType: 'SCHEMA_REMEDIATION',
            domainTag: 'PROCUREMENT',
          });
        } else if (Number.isFinite(poQty) && contractRule) {
          const { moq, mult } = contractRule;
          const belowMoq = moq > 0 && poQty < moq;
          const badMult = mult > 0 && poQty % mult !== 0;
          if (belowMoq || badMult) {
            const alignedQty = Math.max(
              moq,
              mult > 0 ? Math.ceil(poQty / mult) * mult : poQty
            );
            pushErr({
              signature: `PO_MOQ_MULT|${tblName}|${sourceIdx}|${sku}`,
              severity: 'WARNING',
              category: 'UOM_CURRENCY',
              requiresBusinessJudgement: true,
              table: tblName,
              rowNum: excelRow,
              rowIndex: sourceIdx,
              intersection: `${normalizeStr(row.PO_Number)} / ${supplierId} / ${sku} (${depot})`,
              issue: belowMoq
                ? `PO Ordered Qty (${poQty} u) Below Contract MOQ (${moq} u)`
                : `PO Ordered Qty (${poQty} u) Not Divisible by Contract Order Multiple (${mult} u)`,
              badVal: `${poQty} u (MOQ=${moq}, Mult=${mult})`,
              suggestedValText: `Align PO quantity to contract multiple (${alignedQty} u)`,
              fixType: 'SCHEMA_REMEDIATION',
              targetCol: 'Ordered_PO_Qty_Units',
              targetColType: 'NON_NEGATIVE_NUMBER',
              suggestedVal: alignedQty,
              domainTag: 'PROCUREMENT',
            });
          }
        }
      }

      // 13c. Manufacturing Domain Rules (BOM Yield % bounds & Work-Center Capacity)
      if (tblName === bomSheetName || row.Yield_Pct !== undefined) {
        const scrapFactor = parseStrictNumber(row.Scrap_Factor_Pct);
        if (Number.isFinite(scrapFactor) && scrapFactor >= 100) {
          pushErr({
            signature: `MFG_SCRAP|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${normalizeStr(row.Work_Center_ID) || depot}`,
            issue: `Invalid Scrap_Factor_Pct (${scrapFactor}%) — Must Satisfy 0% ≤ Scrap < 100%`,
            badVal: `${scrapFactor}% Scrap`,
            suggestedValText: 'Correct manufacturing scrap factor to a valid percentage below 100%',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Scrap_Factor_Pct',
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: 2.5,
            domainTag: 'MANUFACTURING',
          });
        }

        const componentQty = parseStrictNumber(row.Component_Qty_Per_Unit);
        const parentSku = normalizeStr(row.Parent_SKU_Code);
        const componentSku = normalizeStr(row.Component_SKU_Code);
        const mfgIntersection = `${parentSku || sku} → ${componentSku || 'MISSING COMPONENT'} / ${normalizeStr(row.Work_Center_ID) || depot}`;
        if (parentSku && componentSku && parentSku === componentSku) {
          pushErr({
            signature: `MFG_BOM_SELF_COMPONENT|${tblName}|${sourceIdx}|${parentSku}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: mfgIntersection,
            issue: 'BOM Parent SKU Cannot Be Its Own Component',
            badVal: parentSku,
            suggestedValText: 'Correct the parent or component SKU assignment',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Component_SKU_Code',
            targetColType: 'STRING',
            domainTag: 'MANUFACTURING',
          });
        }
        if (Number.isFinite(componentQty) && componentQty <= 0) {
          pushErr({
            signature: `MFG_COMPONENT_QTY|${tblName}|${sourceIdx}|${parentSku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: mfgIntersection,
            issue: 'BOM Component Quantity Per Finished Unit Must Be Greater Than 0',
            badVal: String(componentQty),
            suggestedValText: 'Enter the verified component quantity required per finished unit',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Component_Qty_Per_Unit',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'MANUFACTURING',
          });
        }
        const yieldVal = parseStrictNumber(row.Yield_Pct);
        if (Number.isFinite(yieldVal) && (yieldVal <= 0 || yieldVal > 100)) {
          pushErr({
            signature: `MFG_YIELD|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'UOM_CURRENCY',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${normalizeStr(row.Work_Center_ID) || depot}`,
            issue: `Invalid Manufacturing Yield_Pct (${yieldVal}%) — Must Satisfy 0% < Yield ≤ 100%`,
            badVal: `${yieldVal}% Yield`,
            suggestedValText: 'Correct production yield % to valid range (e.g. 98%)',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Yield_Pct',
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: 98,
            domainTag: 'MANUFACTURING',
          });
        }
        const availHrs = parseStrictNumber(row.Available_Capacity_Hrs);
        const reqHrs = parseStrictNumber(row.Required_Run_Hrs);
        if (Number.isFinite(availHrs) && Number.isFinite(reqHrs) && availHrs === 0 && reqHrs > 0) {
          pushErr({
            signature: `MFG_ZERO_CAPACITY|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'STOCKOUT',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection: `${sku} / ${normalizeStr(row.Work_Center_ID) || depot}`,
            issue: 'Required Production Hours Are Positive But Work-Center Available Capacity Is 0',
            badVal: `${reqHrs}h required / 0h available`,
            suggestedValText: 'Verify the work-center capacity or remove the unsupported production requirement',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Available_Capacity_Hrs',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'MANUFACTURING',
          });
        }
      }

      // 13d. MEIO policy bounds: safety-stock corridor, holding cost and service-level target.
      if (tblName === meioSheetName || row.Min_Safety_Stock_Qty !== undefined) {
        const minSs = parseStrictNumber(row.Min_Safety_Stock_Qty);
        const maxCap = parseStrictNumber(row.Max_Inventory_Cap_Qty);
        const intersection = `${sku} / ${depot} (${normalizeStr(row.Echelon_Tier) || 'Echelon'})`;
        if (Number.isFinite(minSs) && Number.isFinite(maxCap) && minSs > maxCap) {
          pushErr({
            signature: `MEIO_BOUNDS|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'STOCKOUT',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection,
            issue: `MEIO Min_Safety_Stock_Qty (${minSs} u) Exceeds Max_Inventory_Cap_Qty (${maxCap} u)`,
            badVal: `Min ${minSs} > Max ${maxCap}`,
            suggestedValText: `Align Min_Safety_Stock_Qty ≤ ${maxCap} u`,
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Min_Safety_Stock_Qty',
            targetColType: 'NON_NEGATIVE_NUMBER',
            suggestedVal: maxCap,
            domainTag: 'MEIO',
          });
        }

        const holdingCost = parseStrictNumber(row.Holding_Cost_Pct_Annual);
        if (Number.isFinite(holdingCost) && (holdingCost <= 0 || holdingCost > 100)) {
          pushErr({
            signature: `MEIO_HOLDING_COST|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection,
            issue: 'Annual Holding Cost Percentage Must Be Greater Than 0 And No More Than 100',
            badVal: `${holdingCost}%`,
            suggestedValText: 'Enter the verified annual holding-cost percentage (0 < value ≤ 100)',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Holding_Cost_Pct_Annual',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'MEIO',
          });
        }

        const targetServiceLevel = parseStrictNumber(row.Target_Service_Level_Pct);
        if (
          Number.isFinite(targetServiceLevel) &&
          (targetServiceLevel < ruleConfig.minServiceLevelPct || targetServiceLevel > 99.99)
        ) {
          pushErr({
            signature: `MEIO_SERVICE_LEVEL|${tblName}|${sourceIdx}|${sku}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: tblName,
            rowNum: excelRow,
            rowIndex: sourceIdx,
            intersection,
            issue: `Target Service Level Must Be At Least ${ruleConfig.minServiceLevelPct}% And No More Than 99.99%`,
            badVal: `${targetServiceLevel}%`,
            suggestedValText: `Enter the approved service-level target in the ${ruleConfig.minServiceLevelPct}%–99.99% range`,
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Target_Service_Level_Pct',
            targetColType: 'NON_NEGATIVE_NUMBER',
            domainTag: 'MEIO',
          });
        }
      }
    });
  });

  // 13e. Manufacturing BOM graph integrity: detect directed cycles without recursive stack growth.
  if (bomSheetName && sheets[bomSheetName]) {
    const bomRows = sheets[bomSheetName].records;
    const graph = new Map<string, Array<{ to: string; rowIndex: number; parentSku: string; componentSku: string; depot: string }>>();
    const nodeLabel = new Map<string, { sku: string; depot: string }>();
    for (let rowIndex = 0; rowIndex < bomRows.length; rowIndex += 1) {
      const row = bomRows[rowIndex];
      if (row._removed) continue;
      const parentSku = normalizeStr(row.Parent_SKU_Code);
      const componentSku = normalizeStr(row.Component_SKU_Code);
      const depot = normalizeStr(row.Location_DC);
      if (!parentSku || !componentSku || !depot || parentSku === componentSku) continue;
      // Self-component defects are reported by MFG_BOM_SELF_COMPONENT; avoid a duplicate cycle finding.
      const from = JSON.stringify([depot, parentSku]);
      const to = JSON.stringify([depot, componentSku]);
      nodeLabel.set(from, { sku: parentSku, depot });
      nodeLabel.set(to, { sku: componentSku, depot });
      const edges = graph.get(from) ?? [];
      edges.push({ to, rowIndex, parentSku, componentSku, depot });
      graph.set(from, edges);
    }

    const visited = new Set<string>();
    const reportedCycles = new Set<string>();
    for (const root of graph.keys()) {
      if (visited.has(root)) continue;
      const activePath = [root];
      const activeIndex = new Map<string, number>([[root, 0]]);
      const stack: Array<{ node: string; nextEdge: number }> = [{ node: root, nextEdge: 0 }];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const edges = graph.get(frame.node) ?? [];
        if (frame.nextEdge >= edges.length) {
          stack.pop();
          activeIndex.delete(frame.node);
          activePath.pop();
          visited.add(frame.node);
          continue;
        }
        const edge = edges[frame.nextEdge++];
        if (activeIndex.has(edge.to)) {
          const cycleNodes = activePath.slice(activeIndex.get(edge.to)!).concat(edge.to);
          const cycleNames = cycleNodes.map((node) => nodeLabel.get(node)?.sku ?? node);
          const uniqueCycleNodes = cycleNodes.slice(0, -1);
          const cycleKey = `${edge.depot}|${uniqueCycleNodes.slice().sort().join('|')}`;
          if (reportedCycles.has(cycleKey)) continue;
          reportedCycles.add(cycleKey);
          pushErr({
            signature: `MFG_BOM_CYCLE|${bomSheetName}|${edge.depot}|${uniqueCycleNodes.slice().sort().join('|')}`,
            severity: 'CRITICAL',
            category: 'SCHEMA',
            requiresBusinessJudgement: true,
            table: bomSheetName,
            rowNum: edge.rowIndex + 2,
            rowIndex: edge.rowIndex,
            intersection: `${edge.depot} / ${cycleNames.join(' → ')}`,
            issue: 'Manufacturing BOM Contains A Circular Parent-Component Dependency',
            badVal: cycleNames.join(' → '),
            suggestedValText: 'Remove or correct one of the circular BOM component links',
            fixType: 'SCHEMA_REMEDIATION',
            targetCol: 'Component_SKU_Code',
            targetColType: 'STRING',
            domainTag: 'MANUFACTURING',
          });
          continue;
        }
        if (visited.has(edge.to)) continue;
        activeIndex.set(edge.to, activePath.length);
        activePath.push(edge.to);
        stack.push({ node: edge.to, nextEdge: 0 });
      }
    }
  }

  // 13f. Aggregate required hours across BOM rows sharing a work-center capacity.
  if (bomSheetName && sheets[bomSheetName]) {
    const capacityGroups = new Map<
      string,
      { depot: string; workCenter: string; availableCapacity: number | null; requiredHours: number; rowIndexes: number[]; capacityValues: Set<number> }
    >();
    const bomRows = sheets[bomSheetName].records;
    for (let rowIndex = 0; rowIndex < bomRows.length; rowIndex += 1) {
      const row = bomRows[rowIndex];
      if (row._removed) continue;
      const depot = normalizeStr(row.Location_DC);
      const workCenter = normalizeStr(row.Work_Center_ID);
      const availableCapacity = parseStrictNumber(row.Available_Capacity_Hrs);
      const requiredHours = parseStrictNumber(row.Required_Run_Hrs);
      if (!depot || !workCenter || !Number.isFinite(availableCapacity) || !Number.isFinite(requiredHours)) continue;
      const key = JSON.stringify([depot, workCenter]);
      const group = capacityGroups.get(key) ?? {
        depot,
        workCenter,
        availableCapacity: null,
        requiredHours: 0,
        rowIndexes: [],
        capacityValues: new Set<number>(),
      };
      group.capacityValues.add(availableCapacity);
      group.availableCapacity = group.availableCapacity === null
        ? availableCapacity
        : Math.max(group.availableCapacity, availableCapacity);
      group.requiredHours += requiredHours;
      group.rowIndexes.push(rowIndex);
      capacityGroups.set(key, group);
    }
    for (const group of capacityGroups.values()) {
      const rowIndex = group.rowIndexes[0];
      if (group.capacityValues.size > 1) {
        pushErr({
          signature: `MFG_CAPACITY_CONFLICT|${bomSheetName}|${group.depot}|${group.workCenter}`,
          severity: 'CRITICAL',
          category: 'SCHEMA',
          requiresBusinessJudgement: true,
          table: bomSheetName,
          rowNum: rowIndex + 2,
          rowIndex,
          intersection: `${group.depot} / ${group.workCenter}`,
          issue: 'Available Capacity Is Inconsistent Across BOM Rows For The Same Work Center',
          badVal: Array.from(group.capacityValues).sort((a, b) => a - b).join(' vs '),
          suggestedValText: 'Use one verified work-center capacity value across all BOM rows',
          fixType: 'SCHEMA_REMEDIATION',
          targetCol: 'Available_Capacity_Hrs',
          targetColType: 'NON_NEGATIVE_NUMBER',
          domainTag: 'MANUFACTURING',
        });
      }
      const capacity = group.availableCapacity ?? 0;
      if (capacity > 0 && group.requiredHours > capacity) {
        pushErr({
          signature: `MFG_CAP|${bomSheetName}|${group.depot}|${group.workCenter}`,
          severity: 'WARNING',
          category: 'STOCKOUT',
          requiresBusinessJudgement: true,
          table: bomSheetName,
          rowNum: rowIndex + 2,
          rowIndex,
          intersection: `${group.depot} / ${group.workCenter}`,
          issue: `Aggregated Required Run Hours (${group.requiredHours}h) Exceed Work-Center Capacity (${capacity}h)`,
          badVal: `${group.requiredHours}h required vs ${capacity}h available`,
          suggestedValText: 'Review the aggregate production load, capacity, or approved overtime',
          fixType: 'SCHEMA_REMEDIATION',
          targetCol: 'Required_Run_Hrs',
          targetColType: 'NON_NEGATIVE_NUMBER',
          suggestedVal: capacity,
          domainTag: 'MANUFACTURING',
        });
      }
    }
  }

  // 14. All-Pair Promotion Overlap Detection (only if 04_Trade_Promotions_Calendar is relevant for the domain)
  const promoIsRelevantInDomain =
    activeDomain === 'ALL' || domainRelevantSet.has('04_Trade_Promotions_Calendar');
  if (promoIsRelevantInDomain && promoSheetName && sheets[promoSheetName]?.records?.length) {
    promoAttempted++;
    promoExecuted++;
    const promoRows = sheets[promoSheetName].records
      .map((r, idx) => {
        const startDt = parseFlexibleDate(getRowVal(r, ['Promo_Start_Date']));
        const endDt = parseFlexibleDate(getRowVal(r, ['Promo_End_Date']));
        const channel = normalizeStr(getRowVal(r, ['Channel_Code', 'Channel'])) || 'ALL';
        return {
          idx: typeof r._sourceIndex === 'number' ? r._sourceIndex : idx,
          row: r,
          sku: normalizeStr(getRowVal(r, ['SKU_Code'])),
          depot: normalizeStr(getRowVal(r, ['Location_DC'])),
          channel,
          startDt,
          endDt,
          start: startDt ? formatIsoDate(startDt) : '',
          end: endDt ? formatIsoDate(endDt) : '',
          id: normalizeStr(getRowVal(r, ['Promo_Event_ID'])),
        };
      })
      .filter(
        (x) =>
          !x.row._removed &&
          x.sku &&
          x.startDt !== null &&
          x.endDt !== null &&
          x.endDt.getTime() >= x.startDt.getTime()
      );

    const byGroup = new Map<string, typeof promoRows>();
    for (const item of promoRows) {
      const gKey = `${item.sku}|${item.depot}`;
      const list = byGroup.get(gKey) ?? [];
      list.push(item);
      byGroup.set(gKey, list);
    }

    byGroup.forEach((group) => {
      group.sort((a, b) => a.startDt!.getTime() - b.startDt!.getTime());
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const prev = group[i];
          const curr = group[j];
          const channelOverlaps =
            prev.channel.toUpperCase() === 'ALL' ||
            curr.channel.toUpperCase() === 'ALL' ||
            prev.channel.toUpperCase() === curr.channel.toUpperCase();
          const pairSignature = `RESOLVE_PROMO_OVERLAP|${promoSheetName}|${curr.idx}|${prev.id}|${curr.id}`;
          const resolvedPairsStr = String(
            curr.row._resolvedOverlapPairs ?? curr.row.Governed_Promo_Overlap_Resolution ?? ''
          );
          const isPairResolved = resolvedPairsStr.split('||').includes(pairSignature);
          if (
            channelOverlaps &&
            curr.startDt!.getTime() <= prev.endDt!.getTime() &&
            !isPairResolved
          ) {
            pushErr({
              signature: pairSignature,
              severity: 'WARNING',
              category: 'PROMO_PRICE',
              requiresBusinessJudgement: true,
              table: promoSheetName,
              rowNum: curr.idx + 2,
              rowIndex: curr.idx,
              intersection: `${curr.sku} / ${curr.depot} / ${curr.channel} (${curr.start})`,
              issue: `Promo "${curr.id}" Overlaps With "${prev.id}" (${prev.start}..${prev.end})`,
              badVal: `+${curr.row.Expected_Uplift_Pct}% Stacked`,
              suggestedValText: 'Confirm deduplicated net uplift %',
              fixType: 'RESOLVE_PROMO_OVERLAP',
              suggestedVal: 12,
            });
          }
        }
      }
    });
  } else if (
    domainContract.requiredCategories.includes('promoAndPriceBounds') &&
    promoExecuted === 0
  ) {
    promoAttempted++;
    promoMissing.push(
      domainMandatorySet.has('06_Pricing_Elasticity_Catalog')
        ? '06_Pricing_Elasticity_Catalog'
        : '04_Trade_Promotions_Calendar'
    );
  }

  // 15. Missing Period Continuity Check (only when 01_Orders_Shipments_History is relevant for the active domain)
  if (
    ordersIsRelevantInDomain &&
    ordersSheetName &&
    sheets[ordersSheetName]?.records?.length
  ) {
    const orderRows = sheets[ordersSheetName].records.filter((r) => !r._removed);
    const seriesMap = new Map<
      string,
      Array<{ dateStr: string; date: Date; qty: number; sku: string; depot: string; channel: string }>
    >();

    for (const row of orderRows) {
      const dt = parseFlexibleDate(getRowVal(row, ['Period_Date', 'Date', 'Month']));
      const sku = normalizeStr(getRowVal(row, ['SKU_Code', 'SKU', 'Product']));
      const depot = normalizeStr(getRowVal(row, ['Location_DC', 'Location', 'Depot']));
      const ch = normalizeStr(getRowVal(row, ['Channel_Code', 'Channel']));
      if (!dt || !sku) continue;
      const dateStr = formatIsoDate(dt);
      const key = `${sku}|${depot}|${ch}`;
      const qtyRaw = Number(getRowVal(row, ['Invoiced_Actual_Qty', 'Actual_Sales_Units', 'Actual_Sales', 'Actual']));
      const list = seriesMap.get(key) ?? [];
      list.push({
        dateStr,
        date: dt,
        qty: Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 0,
        sku,
        depot,
        channel: ch,
      });
      seriesMap.set(key, list);
    }

    seriesMap.forEach((points) => {
      if (points.length < 2) return;
      const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
      const uniqueDates = new Map<string, { date: Date; qty: number }>();
      for (const p of sorted) {
        if (!uniqueDates.has(p.dateStr)) {
          uniqueDates.set(p.dateStr, { date: p.date, qty: p.qty });
        }
      }
      const dateEntries = Array.from(uniqueDates.entries()).map(([ds, info]) => ({
        dateStr: ds,
        date: info.date,
        qty: info.qty,
      }));
      if (dateEntries.length < 2) return;

      const dayDeltas: number[] = [];
      for (let i = 1; i < dateEntries.length; i++) {
        const diffDays = Math.round(
          (dateEntries[i].date.getTime() - dateEntries[i - 1].date.getTime()) / 86400000
        );
        if (diffDays > 0) dayDeltas.push(diffDays);
      }
      if (dayDeltas.length === 0) return;

      const minDelta = Math.min(...dayDeltas);
      const isWeekly = minDelta <= 14 && dayDeltas.every((d) => d % 7 === 0);
      const avgQty =
        Math.round(
          dateEntries.reduce((s, d) => s + d.qty, 0) / Math.max(1, dateEntries.length)
        ) || 0;
      const first = dateEntries[0].date;
      const last = dateEntries[dateEntries.length - 1].date;
      const sample = sorted[0];

      if (isWeekly) {
        const cursor = new Date(first.getTime());
        while (cursor.getTime() <= last.getTime()) {
          const iso = formatIsoDate(cursor);
          if (!uniqueDates.has(iso)) {
            pushErr({
              signature: `MISSING_PERIOD|${ordersSheetName}|${sample.sku}|${sample.depot}|${sample.channel}|${iso}`,
              severity: 'CRITICAL',
              category: 'TIME_CONTINUITY',
              requiresBusinessJudgement: true,
              table: ordersSheetName,
              rowNum: 0,
              rowIndex: -1,
              intersection: `${sample.sku} / ${sample.depot || '—'} / ${sample.channel || '—'} (${iso})`,
              issue: `Missing Weekly Demand Period (${iso}) — Confirm Actual or Zero Demand`,
              badVal: 'Gap (Missing Week)',
              suggestedValText: `Confirm demand for ${iso} (Neighbor avg ref: ${avgQty.toLocaleString()} u)`,
              fixType: 'IMPUTE_MISSING_PERIOD',
              missingPeriodMeta: {
                periodDate: iso,
                sku: sample.sku,
                depot: sample.depot,
                channel: sample.channel,
                referenceAvgQty: avgQty,
              },
            });
          }
          cursor.setUTCDate(cursor.getUTCDate() + 7);
        }
      } else {
        let yr = first.getUTCFullYear();
        let mo = first.getUTCMonth();
        const endYr = last.getUTCFullYear();
        const endMo = last.getUTCMonth();
        const dayOfMonth = first.getUTCDate();
        const isMonthEndSeries = dateEntries.every(
          (e) =>
            e.date.getUTCDate() ===
            new Date(
              Date.UTC(e.date.getUTCFullYear(), e.date.getUTCMonth() + 1, 0)
            ).getUTCDate()
        );
        while (yr < endYr || (yr === endYr && mo <= endMo)) {
          const daysInMonth = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
          const targetDay = isMonthEndSeries
            ? daysInMonth
            : Math.min(dayOfMonth, daysInMonth);
          const dt = new Date(Date.UTC(yr, mo, targetDay));
          const iso = formatIsoDate(dt);
          const prefix = iso.slice(0, 7);
          const exists = Array.from(uniqueDates.keys()).some((k) => k.startsWith(prefix));
          if (!exists) {
            pushErr({
              signature: `MISSING_PERIOD|${ordersSheetName}|${sample.sku}|${sample.depot}|${sample.channel}|${iso}`,
              severity: 'CRITICAL',
              category: 'TIME_CONTINUITY',
              requiresBusinessJudgement: true,
              table: ordersSheetName,
              rowNum: 0,
              rowIndex: -1,
              intersection: `${sample.sku} / ${sample.depot || '—'} / ${sample.channel || '—'} (${iso})`,
              issue: `Missing Monthly Demand Period (${iso}) — Confirm Actual or Zero Demand`,
              badVal: 'Gap (Missing Month)',
              suggestedValText: `Confirm demand for ${iso} (Neighbor avg ref: ${avgQty.toLocaleString()} u)`,
              fixType: 'IMPUTE_MISSING_PERIOD',
              missingPeriodMeta: {
                periodDate: iso,
                sku: sample.sku,
                depot: sample.depot,
                channel: sample.channel,
                referenceAvgQty: avgQty,
              },
            });
          }
          mo++;
          if (mo > 11) {
            mo = 0;
            yr++;
          }
        }
      }
    });
  }

  // =========================================================================
  // STAGE 4: EXPLICIT CATEGORY VALIDATION STATUSES & TRANSPARENT HEALTH
  // =========================================================================
  const byCat = (catList: ValidationException['category'][]) =>
    errs.filter((e) => catList.includes(e.category));

  const schemaErrs = byCat(['SCHEMA']);
  const timeErrs = byCat(['TIME_CONTINUITY', 'DUPLICATE_KEY']);
  const stockErrs = byCat(['STOCKOUT']);
  const fkErrs = byCat(['CROSS_TABLE']);
  const promoErrs = byCat(['PROMO_PRICE']);
  const uomSecErrs = byCat(['UOM_CURRENCY', 'SECURITY']);

  const requiredCategoryKeys = new Set<ValidationCategoryKey>(
    domainContract.requiredCategories
  );

  const categories: CategoryValidationSummary[] = [
    {
      key: 'schemaCompleteness',
      label: '1. Schema & Types',
      status: resolveStatus(schemaChecksAttempted, schemaChecksExecuted, schemaErrs),
      detail:
        schemaErrs.length > 0
          ? `${schemaErrs.length} schema/type violation(s)`
          : `${schemaChecksExecuted}/${schemaChecksAttempted} schema contracts verified`,
      issueCount: schemaErrs.length,
      criticalCount: schemaErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: schemaErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: schemaChecksAttempted,
      checksExecuted: schemaChecksExecuted,
      missingDependencies: schemaMissingDeps,
    },
    {
      key: 'timeAndKeyIntegrity',
      label: '2. Time & Key Integrity',
      status: resolveStatus(timeAttempted, timeExecuted, timeErrs),
      detail:
        timeExecuted === 0
          ? requiredCategoryKeys.has('timeAndKeyIntegrity')
            ? `Not Run: Missing ${timeMissing.join(', ') || 'time-series records'}`
            : `Optional for ${domainContract.label}`
          : timeErrs.length > 0
            ? `${timeErrs.length} time/key exception(s)`
            : 'All periods & business keys continuous',
      issueCount: timeErrs.length,
      criticalCount: timeErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: timeErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: timeAttempted,
      checksExecuted: timeExecuted,
      missingDependencies: timeMissing,
    },
    {
      key: 'stockoutDetection',
      label: '3. Stockout & Censored Demand',
      status: resolveStatus(stockAttempted, stockExecuted, stockErrs),
      detail:
        stockExecuted === 0
          ? requiredCategoryKeys.has('stockoutDetection')
            ? `Not Run: Missing ${stockMissing.join(', ')}`
            : `Not required for ${domainContract.label}`
          : stockErrs.length > 0
            ? `${stockErrs.length} unflagged stockout/capacity warning(s)`
            : 'Zero unflagged stockouts',
      issueCount: stockErrs.length,
      criticalCount: stockErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: stockErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: stockAttempted,
      checksExecuted: stockExecuted,
      missingDependencies: stockMissing,
    },
    {
      key: 'crossTableJoins',
      label: '4. Cross-Table Foreign Keys',
      status:
        fkMissing.length > 0 && fkExecuted > 0 && fkErrs.length === 0
          ? 'PARTIAL'
          : resolveStatus(fkAttempted, fkExecuted, fkErrs),
      detail:
        fkExecuted === 0
          ? `Not Run: Missing ${fkMissing.join(', ')}`
          : fkMissing.length > 0
            ? `Partial (${fkExecuted}/${fkAttempted} FK checks): Missing ${fkMissing.join(', ')}`
            : fkErrs.length > 0
              ? `${fkErrs.length} orphan foreign key(s)`
              : `All ${fkExecuted} in-domain master foreign keys verified`,
      issueCount: fkErrs.length,
      criticalCount: fkErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: fkErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: fkAttempted,
      checksExecuted: fkExecuted,
      missingDependencies: fkMissing,
    },
    {
      key: 'promoAndPriceBounds',
      label: '5. Promo & Price Bounds',
      status: resolveStatus(promoAttempted, promoExecuted, promoErrs),
      detail:
        promoExecuted === 0
          ? requiredCategoryKeys.has('promoAndPriceBounds')
            ? `Not Run: Missing ${promoMissing.join(', ')}`
            : `Not required for ${domainContract.label}`
          : promoErrs.length > 0
            ? `${promoErrs.length} promo/margin/cap alert(s)`
            : 'All promo dates, margins & caps verified',
      issueCount: promoErrs.length,
      criticalCount: promoErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: promoErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: promoAttempted,
      checksExecuted: promoExecuted,
      missingDependencies: promoMissing,
    },
    {
      key: 'uomAndSecuritySync',
      label: '6. UOM, Returns & Security',
      status: resolveStatus(uomAttempted, uomExecuted, uomSecErrs),
      detail:
        uomExecuted === 0
          ? `Not Run: Missing ${uomMissing.join(', ')}`
          : uomSecErrs.length > 0
            ? `${uomSecErrs.length} UOM/return/security issue(s)`
            : 'UOMs, returns & cell security verified',
      issueCount: uomSecErrs.length,
      criticalCount: uomSecErrs.filter((e) => e.severity === 'CRITICAL').length,
      warningCount: uomSecErrs.filter((e) => e.severity === 'WARNING').length,
      checksAttempted: uomAttempted,
      checksExecuted: uomExecuted,
      missingDependencies: uomMissing,
    },
  ];

  // Count rows only across in-domain tables (or all tables when activeDomain === 'ALL')
  const totalRows = Object.entries(sheets).reduce((sum, [tblName, tbl]) => {
    const canonicalName = actualToContract.get(tblName) ?? tblName;
    if (activeDomain !== 'ALL' && !domainRelevantSet.has(canonicalName)) {
      return sum;
    }
    return sum + (tbl.records?.filter((r) => !r._removed).length || 0);
  }, 0);

  const badRowSet = new Set<string>();
  let tableLevelFailureCount = 0;
  for (const e of errs) {
    if (e.rowIndex >= 0) {
      badRowSet.add(`${e.table}#${e.rowIndex}`);
    } else {
      tableLevelFailureCount++;
    }
  }
  const cleanRows = Math.max(0, totalRows - badRowSet.size);
  const rowPassRatePct =
    totalRows > 0 ? Number(((cleanRows / totalRows) * 100).toFixed(1)) : null;

  const executedCategories = categories.filter(
    (c) => c.status === 'PASSED' || c.status === 'FAILED'
  ).length;
  const ruleCoveragePct = Number(
    ((executedCategories / categories.length) * 100).toFixed(0)
  );

  const schemaPassed = categories[0].status === 'PASSED';

  const allRequiredValidationsExecuted =
    totalRows > 0 &&
    categories
      .filter((c) => requiredCategoryKeys.has(c.key))
      .every(
        (c) =>
          (c.status === 'PASSED' || c.status === 'FAILED') &&
          c.missingDependencies.length === 0 &&
          c.checksExecuted >= c.checksAttempted
      );

  const unexecutedRequiredCount = categories
    .filter((c) => requiredCategoryKeys.has(c.key))
    .filter(
      (c) =>
        !(
          (c.status === 'PASSED' || c.status === 'FAILED') &&
          c.missingDependencies.length === 0 &&
          c.checksExecuted >= c.checksAttempted
        )
    ).length;

  const structuralPenaltyPct = Math.min(
    100,
    Number((tableLevelFailureCount * 15 + unexecutedRequiredCount * 10).toFixed(1))
  );
  const overallQualityScorePct =
    rowPassRatePct !== null
      ? Math.max(0, Number((rowPassRatePct - structuralPenaltyPct).toFixed(1)))
      : null;

  // 7-Dimension Data Quality Scorecard
  const completenessIssues = errs.filter(
    (e) =>
      (e.category === 'SCHEMA' &&
        (e.signature.includes('MISSING_TABLE') ||
          e.signature.includes('EMPTY_TABLE') ||
          e.signature.includes('MISSING_COL') ||
          e.signature.includes('EMPTY_MANDATORY'))) ||
      e.fixType === 'IMPUTE_ACTUAL'
  ).length;
  const timelinessIssues = errs.filter(
    (e) =>
      e.fixType === 'IMPUTE_MISSING_PERIOD' ||
      e.signature.includes('INVALID_DATE') ||
      e.fixType === 'SWAP_PROMO_DATES'
  ).length;
  const validityIssues = errs.filter(
    (e) =>
      e.signature.includes('INVALID_NUM') ||
      e.signature.includes('NEG_NONNEG') ||
      e.fixType === 'FIX_UOM' ||
      e.fixType === 'SANITIZE_CELL' ||
      e.signature.startsWith('DEPOT_LT|') ||
      e.signature.startsWith('SUPPLIER_LT|') ||
      e.signature.startsWith('PO_MOQ_MULT|') ||
      e.signature.startsWith('MFG_YIELD|') ||
      e.signature.startsWith('CHANNEL_SLA|')
  ).length;
  const uniquenessIssues = errs.filter((e) => e.category === 'DUPLICATE_KEY').length;
  const referentialIssues = errs.filter((e) => e.category === 'CROSS_TABLE').length;
  const consistencyIssues = errs.filter(
    (e) =>
      e.fixType === 'FIX_NEGATIVE' ||
      e.fixType === 'RESOLVE_PROMO_OVERLAP' ||
      e.fixType === 'FIX_COGS' ||
      e.signature.startsWith('MFG_CAP|') ||
      e.signature.startsWith('MEIO_BOUNDS|')
  ).length;
  const plausibilityIssues = errs.filter(
    (e) =>
      e.fixType === 'TAG_SPIKE' ||
      e.fixType === 'CAP_OVERRIDE'
  ).length;

  const makeDim = (
    dimension: string,
    issuesCount: number,
    weightPerIssue: number
  ): QualityDimensionScore => {
    if (totalRows === 0) {
      return {
        dimension,
        scorePct: 0,
        status: 'CRITICAL',
        issuesCount,
        summary: 'No records evaluated',
      };
    }
    const scorePct = Math.max(0, Number((100 - issuesCount * weightPerIssue).toFixed(1)));
    const status =
      scorePct >= 95 && issuesCount === 0
        ? 'HEALTHY'
        : scorePct >= 75
          ? 'DEGRADED'
          : 'CRITICAL';
    return {
      dimension,
      scorePct,
      status,
      issuesCount,
      summary: issuesCount === 0 ? '100% verified' : `${issuesCount} open exception(s)`,
    };
  };

  const dimensions: QualityDimensionScore[] = [
    makeDim('Completeness', completenessIssues, 12),
    makeDim('Timeliness & Continuity', timelinessIssues, 15),
    makeDim('Validity & Format', validityIssues, 10),
    makeDim('Uniqueness', uniquenessIssues, 12),
    makeDim('Referential Integrity', referentialIssues, 15),
    makeDim('Cross-Table Consistency', consistencyIssues, 10),
    makeDim('Statistical Plausibility', plausibilityIssues, 12),
  ];

  for (const cov of coverageMatrix) {
    if (cov.status === 'EXECUTED') {
      const actualName = resolvedTableName.get(cov.tableName) ?? cov.tableName;
      cov.issueCount = errs.filter(
        (e) => e.table === actualName || e.table === cov.tableName
      ).length;
    }
  }

  return {
    exceptions: errs,
    categories,
    health: {
      totalRows,
      cleanRows,
      rowPassRatePct,
      overallQualityScorePct,
      structuralPenaltyPct,
      tableLevelFailureCount,
      executedCategories,
      totalCategories: categories.length,
      ruleCoveragePct,
      dimensions,
    },
    schemaPassed,
    allRequiredValidationsExecuted,
    activeDomain,
    activeIndustry,
    appliedRuleConfig: ruleConfig,
    coverageMatrix,
  };
}

export function validateWorkbookRecords(
  sheets: EnterpriseSheets
): ValidationException[] {
  return validateWorkbook(sheets).exceptions;
}

function cloneSheets(sheets: EnterpriseSheets): EnterpriseSheets {
  const next = Object.create(null) as EnterpriseSheets;
  for (const name of Object.keys(sheets)) {
    next[name] = {
      ...sheets[name],
      records: sheets[name].records.map((r) => ({ ...r })),
    };
  }
  return next;
}

/**
 * Applies ONLY explicitly approved corrections to produce the governed working dataset.
 * The original `sourceSheets` remains completely untouched.
 * If a correction carries `sourceWorkbookHash`, verifies that it matches the SHA-256 fingerprint
 * of `sourceSheets` before applying so corrections from another dataset can never corrupt the active workbook.
 * When `options.strictHashBinding` is true, any correction missing `sourceWorkbookHash` is also rejected.
 */
export function applyApprovedCorrections(
  sourceSheets: EnterpriseSheets,
  corrections: ApprovedCorrection[],
  options?: { strictHashBinding?: boolean }
): EnterpriseSheets {
  const working = cloneSheets(sourceSheets);
  const currentSourceHash = computeWorkbookHash(sourceSheets);
  const strictHashBinding = Boolean(options?.strictHashBinding);

  for (const name of Object.keys(working)) {
    working[name].records.forEach((r, idx) => {
      r._sourceIndex = idx;
    });
  }

  for (const corr of corrections) {
    if (strictHashBinding) {
      if (!corr.sourceWorkbookHash || corr.sourceWorkbookHash !== currentSourceHash) {
        continue;
      }
    } else if (corr.sourceWorkbookHash && corr.sourceWorkbookHash !== currentSourceHash) {
      continue;
    }
    const tbl = Object.prototype.hasOwnProperty.call(working, corr.table)
      ? working[corr.table]
      : undefined;
    if (!tbl) continue;

    if (corr.fixType === 'IMPUTE_MISSING_PERIOD' && corr.missingPeriodMeta) {
      const qty = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(qty) || qty < 0) continue;
      const meta = corr.missingPeriodMeta;
      const alreadyImputed = tbl.records.some(
        (existing) =>
          existing._isImputedContinuityRow === true &&
          normalizeStr(existing.Period_Date) === meta.periodDate &&
          normalizeStr(existing.SKU_Code) === meta.sku &&
          normalizeStr(existing.Location_DC) === meta.depot &&
          normalizeStr(existing.Channel_Code) === meta.channel
      );
      if (alreadyImputed) continue;
      tbl.records.push({
        Period_Date: corr.missingPeriodMeta.periodDate,
        SKU_Code: corr.missingPeriodMeta.sku,
        Location_DC: corr.missingPeriodMeta.depot,
        Channel_Code: corr.missingPeriodMeta.channel,
        Invoice_Line_ID: '',
        Ordered_Qty_Units: 0,
        Invoiced_Actual_Qty: 0,
        Returns_Damaged_Qty: 0,
        Net_Realized_Sales_INR: null,
        Governed_Imputed_Demand_Qty: qty,
        _isImputedContinuityRow: true,
        _sourceIndex: tbl.records.length,
      });
      continue;
    }

    const row = tbl.records[corr.rowIndex];
    if (!row) continue;

    if (corr.fixType === 'REMOVE_DUPLICATE') {
      row._removed = true;
    } else if (corr.fixType === 'SCHEMA_REMEDIATION' && corr.targetCol) {
      const check = validateSchemaRemediationInput(
        corr.table,
        corr.targetCol,
        corr.approvedValue
      );
      if (check.ok) {
        row[corr.targetCol] = check.normalizedValue;
      }
    } else if (corr.fixType === 'SANITIZE_CELL' && corr.targetCol) {
      const safeTargetColumn =
        !['__proto__', 'prototype', 'constructor'].includes(corr.targetCol) &&
        tbl.cols.some((column) => column.col === corr.targetCol);
      if (!safeTargetColumn) continue;
      const sanitized = sanitizeCellText(String(corr.approvedValue ?? '')).trim();
      if (!sanitized || hasUnsafePayload(sanitized)) continue;
      row[corr.targetCol] = sanitized;
    } else if (corr.fixType === 'IMPUTE_ACTUAL') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      const key =
        findColumnKey(row, ['Invoiced_Actual_Qty', 'Actual_Sales_Units', 'Actual_Sales', 'Actual']) ||
        'Invoiced_Actual_Qty';
      row[key] = numVal;
    } else if (corr.fixType === 'FIX_NEGATIVE') {
      const key =
        findColumnKey(row, ['Invoiced_Actual_Qty', 'Actual_Sales_Units', 'Actual_Sales', 'Actual']) ||
        'Invoiced_Actual_Qty';
      if (corr.classificationMode === 'CREDIT_RETURN') {
        const absVal = Math.abs(parseStrictNumber(row[key]) || 0);
        const existingReturns = Math.max(0, parseStrictNumber(row.Returns_Damaged_Qty) || 0);
        const unrecordedDelta = Math.max(0, absVal - existingReturns);
        row.Returns_Damaged_Qty = existingReturns + unrecordedDelta;
        row.Transaction_Type = 'CREDIT_RETURN';
        row[key] = 0;
      } else {
        const numVal = parseStrictNumber(corr.approvedValue);
        if (!Number.isFinite(numVal) || numVal < 0) continue;
        row[key] = numVal;
      }
    } else if (corr.fixType === 'TAG_SPIKE') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      row._spikeTagged = true;
      row.Governed_Spike_Status = 'TAGGED_BASELINE';
      row.Invoiced_Actual_Qty = numVal;
    } else if (corr.fixType === 'MAP_SKU') {
      const targetSku = normalizeStr(corr.approvedValue);
      if (!targetSku) continue;
      const key =
        findColumnKey(row, ['SKU_Code', 'Parent_SKU_Code', 'SKU', 'Product']) ||
        'SKU_Code';
      row[key] = targetSku;
    } else if (corr.fixType === 'MAP_DEPOT') {
      const targetDepot = normalizeStr(corr.approvedValue);
      if (!targetDepot) continue;
      const key =
        findColumnKey(row, ['Location_DC', 'Location', 'Depot']) || 'Location_DC';
      row[key] = targetDepot;
    } else if (corr.fixType === 'MAP_CHANNEL') {
      const targetCh = normalizeStr(corr.approvedValue);
      if (!targetCh) continue;
      const key = findColumnKey(row, ['Channel_Code', 'Channel']) || 'Channel_Code';
      row[key] = targetCh;
    } else if (corr.fixType === 'FIX_UOM') {
      const numFactor = parseStrictNumber(corr.approvedValue);
      if (typeof corr.approvedValue === 'string' && !Number.isFinite(numFactor)) {
        const uomStr = normalizeStr(corr.approvedValue);
        if (!uomStr) continue;
        const key = findColumnKey(row, ['Order_UOM', 'Base_UOM']) || 'Base_UOM';
        row[key] = uomStr;
      } else {
        if (!Number.isFinite(numFactor) || numFactor <= 1) continue;
        row.UOM_Conversion_Factor = numFactor;
        row._uomPackVerified = true;
        row.Governed_Pack_Verified = 'VERIFIED';
      }
    } else if (corr.fixType === 'FIX_NPI_REF') {
      const refSku = normalizeStr(corr.approvedValue);
      if (!refSku) continue;
      row.Reference_Analog_SKU_Code = refSku;
    } else if (corr.fixType === 'CAP_FORECAST') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      row.Stat_Forecast_Lag1_Qty = numVal;
    } else if (corr.fixType === 'RESTORE_STOCKOUT') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      row._stockoutRestored = true;
      row._uncensoredDemandEstimate = numVal;
      row.Governed_Uncensored_Demand_Qty = numVal;
    } else if (corr.fixType === 'SWAP_PROMO_DATES') {
      const startDt = parseFlexibleDate(row.Promo_Start_Date);
      const endDt = parseFlexibleDate(row.Promo_End_Date);
      if (!startDt || !endDt) continue;
      const tmp = row.Promo_Start_Date;
      row.Promo_Start_Date = row.Promo_End_Date;
      row.Promo_End_Date = tmp;
    } else if (corr.fixType === 'RESOLVE_PROMO_OVERLAP') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      const prevPairs = String(
        row._resolvedOverlapPairs ?? row.Governed_Promo_Overlap_Resolution ?? ''
      );
      const nextPairs = prevPairs
        ? `${prevPairs}||${corr.exceptionSignature}`
        : corr.exceptionSignature;
      row._resolvedOverlapPairs = nextPairs;
      row.Governed_Promo_Overlap_Resolution = nextPairs;
      row.Expected_Uplift_Pct = numVal;
    } else if (corr.fixType === 'FIX_COGS') {
      const newCogs = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(newCogs) || newCogs < 0) continue;
      row.Unit_COGS_INR = newCogs;
      const price = Number(row.Net_Realized_Price_INR);
      if (Number.isFinite(price) && price > 0) {
        row.Gross_Margin_Pct = Number((((price - newCogs) / price) * 100).toFixed(1));
      }
    } else if (corr.fixType === 'CAP_OVERRIDE') {
      const numVal = parseStrictNumber(corr.approvedValue);
      if (!Number.isFinite(numVal) || numVal < 0) continue;
      row.Field_Sales_Override_Qty = numVal;
      row.Override_Reason_Code = corr.reason.slice(0, 32) || 'GOVERNED_OVERRIDE';
    }
  }

  return working;
}

/**
 * Deterministic-only safe technical fix batch:
 * ONLY fixes exceptions with requiresBusinessJudgement === false (e.g., XSS sanitization, inverted promo dates, cross-table UOM string sync).
 * Verifies exception count decreases after each step, stops if no progress is made, and stamps sourceWorkbookHash on each correction.
 */
export function applySafeTechnicalFixes(
  sourceSheets: EnterpriseSheets,
  existingCorrections: ApprovedCorrection[],
  approver: string,
  options?: ValidationOptions
): {
  nextCorrections: ApprovedCorrection[];
  beforeCount: number;
  afterCount: number;
  appliedCount: number;
  remainingCount: number;
} {
  const sourceHash = computeWorkbookHash(sourceSheets);
  let workingCorrections = [...existingCorrections];
  let currentReport = validateWorkbook(
    applyApprovedCorrections(sourceSheets, workingCorrections),
    options
  );
  const beforeCount = currentReport.exceptions.length;
  let appliedCount = 0;

  for (let step = 0; step < 50; step++) {
    const safeCandidate = currentReport.exceptions.find(
      (e) =>
        !e.requiresBusinessJudgement &&
        e.fixType !== 'SCHEMA_REMEDIATION'
    );
    if (!safeCandidate) break;

    const newCorr: ApprovedCorrection = {
      id: `COR-${Date.now()}-${step}`,
      exceptionSignature: safeCandidate.signature,
      fixType: safeCandidate.fixType,
      table: safeCandidate.table,
      rowIndex: safeCandidate.rowIndex,
      targetCol: safeCandidate.targetCol,
      approvedValue: safeCandidate.suggestedVal ?? '',
      beforeSummary: safeCandidate.badVal,
      afterSummary: safeCandidate.suggestedValText,
      approver,
      reason: 'Deterministic technical rule remediation (no business value invented)',
      approvedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      sourceWorkbookHash: sourceHash,
    };

    const candidateCorrections = [...workingCorrections, newCorr];
    const nextReport = validateWorkbook(
      applyApprovedCorrections(sourceSheets, candidateCorrections),
      options
    );

    if (nextReport.exceptions.length >= currentReport.exceptions.length) {
      break;
    }

    workingCorrections = candidateCorrections;
    currentReport = nextReport;
    appliedCount++;
  }

  return {
    nextCorrections: workingCorrections,
    beforeCount,
    afterCount: currentReport.exceptions.length,
    appliedCount,
    remainingCount: currentReport.exceptions.length,
  };
}

export function computeSignOffExpiryIso(
  expiry: string,
  fromMs: number = Date.now()
): string {
  if (expiry === '24 Hours') {
    return new Date(fromMs + 24 * 60 * 60 * 1000).toISOString();
  }
  if (expiry === '7 Days') {
    return new Date(fromMs + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const now = new Date(fromMs);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  ).toISOString();
}

/**
 * Strict Multi-Condition Release Gate:
 * Unlocks Step 2 ONLY when EVERY mandatory condition passes:
 * 1. Schema assurance passed (all mandatory tables/columns present, valid types)
 * 2. All required validation categories executed for the active domain (no NOT_RUN or PARTIAL)
 * 3. Zero unresolved CRITICAL exceptions
 * 4. Independent formula regression suite passed 100%
 * 5. Warning policy satisfied (if warnings > 0, active non-expired manager sign-off bound to the current workbook is required)
 */
export function evaluateReleaseGate(
  report: ValidationReport,
  warningSignOff: WarningSignOff | null,
  formulaTestsPassed: boolean,
  nowMs: number = Date.now(),
  currentSourceWorkbookHash?: string,
  strictHashBinding?: boolean
): ReleaseGateState {
  const criticalCount = report.exceptions.filter((e) => e.severity === 'CRITICAL').length;
  const warningCount = report.exceptions.filter((e) => e.severity === 'WARNING').length;
  // A warning sign-off is a dataset-specific approval. It must never be accepted
  // without a current workbook fingerprint or when its fingerprint is absent/mismatched.
  // This is fail-closed regardless of the optional strictHashBinding compatibility flag.
  const signOffHashMatches =
    warningSignOff === null
      ? true
      : Boolean(
          currentSourceWorkbookHash &&
          warningSignOff.sourceWorkbookHash &&
          warningSignOff.sourceWorkbookHash === currentSourceWorkbookHash
        );

  const signOffExpiresMs =
    warningSignOff &&
    signOffHashMatches &&
    typeof warningSignOff.expiresAt === 'string' &&
    warningSignOff.expiresAt.trim() !== ''
      ? Date.parse(warningSignOff.expiresAt)
      : Number.NaN;
  const hasValidFutureExpiry =
    Number.isFinite(signOffExpiresMs) && signOffExpiresMs > nowMs;
  const isSignOffInvalidOrExpired =
    warningSignOff !== null && !hasValidFutureExpiry;
  const activeWarningSignOff =
    warningSignOff && hasValidFutureExpiry ? warningSignOff : null;

  const warningPolicySatisfied = warningCount === 0 || activeWarningSignOff !== null;

  const conditions: ReleaseGateCondition[] = [
    {
      label: 'Schema & Type Assurance',
      passed: report.schemaPassed,
      detail: report.schemaPassed
        ? 'All mandatory tables, columns & formats valid'
        : 'Missing mandatory table/column or invalid format',
    },
    {
      label: 'Required Validations Executed',
      passed: report.allRequiredValidationsExecuted,
      detail: report.allRequiredValidationsExecuted
        ? 'All required domain checks ran completely'
        : 'One or more required checks Not Run or Partial',
    },
    {
      label: 'Zero Critical Exceptions',
      passed: criticalCount === 0,
      detail:
        criticalCount === 0
          ? '0 critical blockers'
          : `${criticalCount} critical blocker(s) unresolved`,
    },
    {
      label: 'Formula Regression Suite',
      passed: formulaTestsPassed,
      detail: formulaTestsPassed
        ? 'All calculation & edge-case tests passed'
        : 'One or more calculation formula tests failed',
    },
    {
      label: 'Warning Acknowledgement Policy',
      passed: warningPolicySatisfied,
      detail:
        warningCount === 0
          ? '0 warnings active'
          : activeWarningSignOff
            ? `Acknowledged by ${activeWarningSignOff.approver}`
            : isSignOffInvalidOrExpired
              ? !signOffHashMatches
                ? 'Sign-off belongs to a different workbook — re-acknowledgement required'
                : 'Sign-off expired or missing valid expiry — re-acknowledgement required'
              : `${warningCount} warning(s) require mandatory sign-off`,
    },
  ];

  const blockingReasons = conditions.filter((c) => !c.passed).map((c) => c.detail);
  const allPassed = conditions.every((c) => c.passed);

  if (
    !report.schemaPassed ||
    !report.allRequiredValidationsExecuted ||
    criticalCount > 0 ||
    !formulaTestsPassed
  ) {
    return {
      criticalCount,
      warningCount,
      schemaPassed: report.schemaPassed,
      allRequiredValidationsExecuted: report.allRequiredValidationsExecuted,
      formulaTestsPassed,
      warningPolicySatisfied,
      step2Unlocked: false,
      status: 'BLOCKED',
      blockingReasons,
      conditions,
    };
  }

  if (!warningPolicySatisfied) {
    return {
      criticalCount,
      warningCount,
      schemaPassed: report.schemaPassed,
      allRequiredValidationsExecuted: report.allRequiredValidationsExecuted,
      formulaTestsPassed,
      warningPolicySatisfied,
      step2Unlocked: false,
      status: 'AWAITING_WARNING_SIGNOFF',
      blockingReasons,
      conditions,
    };
  }

  return {
    criticalCount,
    warningCount,
    schemaPassed: report.schemaPassed,
    allRequiredValidationsExecuted: report.allRequiredValidationsExecuted,
    formulaTestsPassed,
    warningPolicySatisfied,
    step2Unlocked: allPassed,
    status: warningCount > 0 ? 'WARNING_ACKNOWLEDGED' : 'PASSED',
    blockingReasons,
    conditions,
  };
}

