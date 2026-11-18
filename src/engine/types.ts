export type IndustryKey =
  | 'cpg'
  | 'pharma'
  | 'retail'
  | 'electronics'
  | 'auto'
  | 'chemicals';

export type UserRole = 'all' | 'exec' | 'planner' | 'supply';

export type ModuleId = 'm01' | 'm02' | 'm03' | 'm04' | 'm05' | 'm06';

export type Step1Tab = 'errors' | 'calctest' | 'schema12';

export type Severity = 'CRITICAL' | 'WARNING';

export interface ColumnDef {
  col: string;
  type: string;
  key: string;
}

export type SheetRecord = Record<string, string | number | boolean | null | undefined>;

export interface SheetTable {
  pillar: string;
  desc: string;
  cols: ColumnDef[];
  records: SheetRecord[];
}

export type EnterpriseSheets = Record<string, SheetTable>;

export type FixType =
  | 'IMPUTE_ACTUAL'
  | 'FIX_NEGATIVE'
  | 'TAG_SPIKE'
  | 'REMOVE_DUPLICATE'
  | 'IMPUTE_MISSING_PERIOD'
  | 'MAP_SKU'
  | 'MAP_DEPOT'
  | 'MAP_CHANNEL'
  | 'FIX_UOM'
  | 'FIX_NPI_REF'
  | 'CAP_FORECAST'
  | 'RESTORE_STOCKOUT'
  | 'SWAP_PROMO_DATES'
  | 'RESOLVE_PROMO_OVERLAP'
  | 'FIX_COGS'
  | 'CAP_OVERRIDE'
  | 'SANITIZE_CELL';

export interface ValidationException {
  id: string;
  severity: Severity;
  category:
    | 'TIME_CONTINUITY'
    | 'DUPLICATE_KEY'
    | 'CROSS_TABLE'
    | 'STOCKOUT'
    | 'PROMO_PRICE'
    | 'UOM_CURRENCY'
    | 'SECURITY';
  table: string;
  rowNum: number;
  rowIndex: number;
  intersection: string;
  issue: string;
  badVal: string;
  fixValText: string;
  fixType: FixType;
  fixVal?: string | number;
  targetCol?: string;
  missingPeriodMeta?: {
    periodDate: string;
    sku: string;
    depot: string;
    channel: string;
    imputedQty: number;
  };
}

export interface FormulaTestCase {
  id: string;
  name: string;
  scenario: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface AuditEntry {
  ts: string;
  evt: string;
  scope: string;
  user: string;
  out: string;
}

export interface WarningSignOff {
  approver: string;
  reason: string;
  expiry: string;
  signedAt: string;
}

export interface ReleaseGateState {
  criticalCount: number;
  warningCount: number;
  step2Unlocked: boolean;
  status: 'BLOCKED' | 'PASSED' | 'WARNING_ACKNOWLEDGED';
}
