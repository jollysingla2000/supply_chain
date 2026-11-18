export type IndustryKey =
  | 'cpg'
  | 'pharma'
  | 'retail'
  | 'electronics'
  | 'auto'
  | 'chemicals';

export type PlanningDomainKey =
  | 'ALL'
  | 'DEMAND'
  | 'SUPPLY'
  | 'SOP'
  | 'MEIO'
  | 'PROCUREMENT'
  | 'MANUFACTURING';

export type UserRole = 'all' | 'exec' | 'planner' | 'supply';

export type ModuleId = 'm01' | 'm02' | 'm03' | 'm04' | 'm05' | 'm06';

export type Step1Tab =
  | 'errors'
  | 'profiling'
  | 'reconciliation'
  | 'calctest'
  | 'schema12';

export type Severity = 'CRITICAL' | 'WARNING';

export type ValidationExecutionStatus = 'PASSED' | 'FAILED' | 'NOT_RUN' | 'PARTIAL';

export type FieldDataType = 'DATE' | 'NUMBER' | 'NON_NEGATIVE_NUMBER' | 'STRING';

export type InferredColumnDataType = FieldDataType | 'MIXED' | 'EMPTY';

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
  domains?: PlanningDomainKey[];
}

export type SheetRecord = Record<string, string | number | boolean | null | undefined>;

export interface SheetTable {
  pillar: string;
  desc: string;
  cols: ColumnDef[];
  records: SheetRecord[];
  awaitingDataPopulation?: boolean;
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
  | 'SCHEMA_REMEDIATION'
  | 'FIX_LEADTIME_MOQ';

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
  targetColType?: FieldDataType;
  domainTag?: PlanningDomainKey;
  missingPeriodMeta?: {
    periodDate: string;
    sku: string;
    depot: string;
    channel: string;
    referenceAvgQty: number;
  };
}

export type ValidationCategoryKey =
  | 'schemaCompleteness'
  | 'timeAndKeyIntegrity'
  | 'stockoutDetection'
  | 'crossTableJoins'
  | 'promoAndPriceBounds'
  | 'uomAndSecuritySync';

export interface CategoryValidationSummary {
  key: ValidationCategoryKey;
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

export interface QualityDimensionScore {
  dimension: string;
  scorePct: number;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  issuesCount: number;
  summary: string;
}

export interface HealthBreakdown {
  totalRows: number;
  cleanRows: number;
  rowPassRatePct: number | null;
  overallQualityScorePct: number | null;
  structuralPenaltyPct: number;
  tableLevelFailureCount: number;
  executedCategories: number;
  totalCategories: number;
  ruleCoveragePct: number;
  dimensions?: QualityDimensionScore[];
}

export interface ValidationRuleConfig {
  outlierSigmaThreshold: number;
  outlierZThreshold?: number;
  forecastUpperCorridorPct: number;
  salesOverrideMaxPct: number;
  standardCasePackMin: number;
  minServiceLevelPct: number;
  maxLeadTimeDays: number;
  reconciliationTolerancePct: number;
  enforceMoqOrderMultiples: boolean;
  enforceFutureDateGuard: boolean;
  ruleVersion: string;
}

export interface ValidationOptions {
  industry?: IndustryKey;
  domain?: PlanningDomainKey;
  ruleConfig?: Partial<ValidationRuleConfig>;
}

export interface ValidationCoverageEntry {
  table: string;
  tableName: string;
  domainRole: 'MANDATORY' | 'OPTIONAL_IN_DOMAIN' | 'OUT_OF_DOMAIN';
  requiredByDomain: boolean;
  relevantToDomain: boolean;
  presentInWorkbook: boolean;
  rowCount: number;
  checksExecuted: number;
  issueCount: number;
  status:
    | 'EXECUTED'
    | 'SKIPPED_OUT_OF_DOMAIN'
    | 'NOT_RUN_MISSING_TABLE'
    | 'NOT_RUN_EMPTY_TABLE';
  executionStatus:
    | 'EXECUTED'
    | 'SKIPPED_OUT_OF_DOMAIN'
    | 'NOT_RUN_MISSING_TABLE'
    | 'NOT_RUN_EMPTY_TABLE';
  reason: string;
}

export interface ValidationReport {
  exceptions: ValidationException[];
  categories: CategoryValidationSummary[];
  health: HealthBreakdown;
  schemaPassed: boolean;
  allRequiredValidationsExecuted: boolean;
  activeDomain?: PlanningDomainKey;
  activeIndustry?: IndustryKey;
  appliedRuleConfig?: ValidationRuleConfig;
  coverageMatrix?: ValidationCoverageEntry[];
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
  sourceWorkbookHash?: string;
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
  datasetHash?: string;
}

export interface WarningSignOff {
  approver: string;
  reason: string;
  expiry: string;
  signedAt: string;
  expiresAt?: string;
  sourceWorkbookHash?: string;
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

export interface ColumnProfile {
  table: string;
  column: string;
  expectedType: FieldDataType;
  inferredType: InferredColumnDataType;
  typeMismatch: boolean;
  totalCount: number;
  nonNullCount: number;
  nullCount: number;
  nullPct: number;
  distinctCount: number;
  distinctPct: number;
  invalidTypeCount: number;
  zeroCount: number;
  negativeCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  iqr: number | null;
  p5: number | null;
  p95: number | null;
  outlierCount: number;
  iqrOutlierCount: number;
  distinctDateFormats?: string[];
  invalidSampleValues?: string[];
}

export interface TableProfile {
  table: string;
  grain: string;
  rowCount: number;
  columnCount: number;
  completenessPct: number;
  duplicateKeyCount: number;
  orphanFkCount: number;
  timeSeriesGapCount: number;
  timeGranularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'IRREGULAR' | 'NONE';
  minPeriod: string | null;
  maxPeriod: string | null;
  columns: ColumnProfile[];
}

export interface EntityHotspot {
  entityType: 'SKU' | 'DEPOT' | 'TABLE';
  entityKey: string;
  exceptionCount: number;
  criticalCount: number;
  warningCount: number;
}

export interface WorkbookProfileReport {
  tables: TableProfile[];
  topProblematicSkus: EntityHotspot[];
  topProblematicDepots: EntityHotspot[];
  topProblematicTables: EntityHotspot[];
}

export interface ReconciliationCheckResult {
  id: string;
  name: string;
  domainScope: PlanningDomainKey[];
  equation: string;
  grain: string;
  leftSource: string;
  rightSource: string;
  leftTotal: number;
  rightTotal: number;
  varianceAbs: number;
  variancePct: number | null;
  tolerancePct: number;
  eligibleRecordsCount: number;
  excludedRecordsCount: number;
  exclusionRule: string;
  status:
    | 'RECONCILED'
    | 'VARIANCE_WARNING'
    | 'CRITICAL_MISMATCH'
    | 'NOT_RUN'
    | 'NOT_APPLICABLE';
  detail: string;
}

export interface ReconciliationReport {
  checks: ReconciliationCheckResult[];
  reconciledCount: number;
  warningCount: number;
  criticalCount: number;
  notRunCount: number;
  notApplicableCount: number;
}

export interface SuggestedColumnMapping {
  table: string;
  sourceColumn: string;
  targetCanonicalColumn: string;
  confidencePct: number;
  collisionWarning?: string;
}

export interface SchemaDriftReport {
  missingMandatoryTables: string[];
  missingOptionalTables: string[];
  missingColumns: Array<{ table: string; column: string; mandatory: boolean }>;
  unexpectedColumns: Array<{ table: string; column: string }>;
  suggestedColumnMappings: SuggestedColumnMapping[];
}

export interface UploadLineageRecord {
  id: string;
  fileName: string;
  fileHash: string;
  governedOutputHash?: string;
  sourceVersion?: string | number;
  uploadStatus?: 'ACTIVE' | 'SUPERSEDED' | 'REJECTED' | 'SUCCESS';
  uploadedAt: string;
  sheetCount: number;
  totalRows: number;
  domain: PlanningDomainKey;
  industry: IndustryKey;
}

export interface ExceptionAssignmentHistoryEntry {
  owner: string;
  status: 'OPEN' | 'IN_REVIEW' | 'ESCALATED' | 'RESOLVED';
  updatedAt: string;
  ts?: string;
  fromOwner?: string;
  toOwner?: string;
}

export interface ExceptionAssignment {
  owner: string;
  slaHours: number;
  status: 'OPEN' | 'IN_REVIEW' | 'ESCALATED' | 'RESOLVED';
  assignedAt?: string;
  dueAt?: string;
  isOverdue?: boolean;
  updatedAt?: string;
  history?: ExceptionAssignmentHistoryEntry[];
}
