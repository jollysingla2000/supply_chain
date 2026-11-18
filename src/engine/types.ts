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

export type ValidationExecutionStatus = 'PASSED' | 'FAILED' | 'NOT_RUN' | 'PARTIAL';

export type FieldDataType = 'DATE' | 'NUMBER' | 'NON_NEGATIVE_NUMBER' | 'STRING';

export interface ColumnDef {
  col: string;
  type: string;
  key: string;
  required?: boolean;
  dataType?: FieldDataType;
}

export interface ForeignKeyContract {
  col: string;
  targetTable: string;
  targetCol: string;
  allowEmpty?: boolean;
}

export interface TableContract {
  tableName: string;
  mandatory: boolean;
  mandatoryColumns: string[];
  optionalColumns: string[];
  businessKey: string[];
  foreignKeys: ForeignKeyContract[];
  columnTypes: Record<string, FieldDataType>;
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
  | 'SANITIZE_CELL'
  | 'SCHEMA_REMEDIATION';

export type ExceptionCategory =
  | 'SCHEMA'
  | 'TIME_CONTINUITY'
  | 'DUPLICATE_KEY'
  | 'CROSS_TABLE'
  | 'STOCKOUT'
  | 'PROMO_PRICE'
  | 'UOM_CURRENCY'
  | 'SECURITY';

export interface ValidationException {
  id: string;
  signature: string;
  severity: Severity;
  category: ExceptionCategory;
  requiresBusinessJudgement: boolean;
  table: string;
  rowNum: number;
  rowIndex: number;
  intersection: string;
  issue: string;
  badVal: string;
  suggestedValText: string;
  fixType: FixType;
  suggestedVal?: string | number;
  availableOptions?: string[];
  targetCol?: string;
  missingPeriodMeta?: {
    periodDate: string;
    sku: string;
    depot: string;
    channel: string;
    referenceAvgQty: number;
  };
}

export interface CategoryValidationSummary {
  key:
    | 'schemaCompleteness'
    | 'timeAndKeyIntegrity'
    | 'stockoutDetection'
    | 'crossTableJoins'
    | 'promoAndPriceBounds'
    | 'uomAndSecuritySync';
  label: string;
  status: ValidationExecutionStatus;
  detail: string;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
  checksAttempted: number;
  checksExecuted: number;
  missingDependencies: string[];
}

export interface HealthBreakdown {
  totalRows: number;
  cleanRows: number;
  rowPassRatePct: number | null;
  executedCategories: number;
  totalCategories: number;
  ruleCoveragePct: number;
}

export interface ValidationReport {
  exceptions: ValidationException[];
  categories: CategoryValidationSummary[];
  health: HealthBreakdown;
  schemaPassed: boolean;
  allRequiredValidationsExecuted: boolean;
}

export interface ApprovedCorrection {
  id: string;
  exceptionSignature: string;
  fixType: FixType;
  table: string;
  rowIndex: number;
  targetCol?: string;
  approvedValue: string | number;
  classificationMode?: 'CREDIT_RETURN' | 'BILLING_CORRECTION' | 'KEEP_AUTHORITATIVE';
  beforeSummary: string;
  afterSummary: string;
  approver: string;
  reason: string;
  approvedAt: string;
  missingPeriodMeta?: {
    periodDate: string;
    sku: string;
    depot: string;
    channel: string;
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
  beforeVal?: string;
  afterVal?: string;
  out: string;
}

export interface WarningSignOff {
  approver: string;
  reason: string;
  expiry: string;
  signedAt: string;
  expiresAt?: string;
}

export interface ReleaseGateCondition {
  label: string;
  passed: boolean;
  detail: string;
}

export interface ReleaseGateState {
  criticalCount: number;
  warningCount: number;
  schemaPassed: boolean;
  allRequiredValidationsExecuted: boolean;
  formulaTestsPassed: boolean;
  warningPolicySatisfied: boolean;
  step2Unlocked: boolean;
  status: 'BLOCKED' | 'AWAITING_WARNING_SIGNOFF' | 'PASSED' | 'WARNING_ACKNOWLEDGED';
  blockingReasons: string[];
  conditions: ReleaseGateCondition[];
}
