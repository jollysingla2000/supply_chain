import React, { useEffect, useMemo, useState } from 'react';
import {
  DOMAIN_CONTRACTS,
  INDUSTRY_LABELS,
  PLANNING_DOMAIN_LABELS,
} from '../engine/schema';
import { hasUnsafePayload } from '../engine/security';
import {
  ApprovedCorrection,
  EnterpriseSheets,
  ExceptionAssignment,
  FormulaTestCase,
  IndustryKey,
  PlanningDomainKey,
  ReconciliationReport,
  ReleaseGateState,
  SchemaDriftReport,
  Step1Tab,
  UploadLineageRecord,
  ValidationException,
  ValidationExecutionStatus,
  ValidationReport,
  ValidationRuleConfig,
  WarningSignOff,
  WorkbookProfileReport,
} from '../engine/types';

interface Step1DataAssuranceProps {
  industry: IndustryKey;
  domain: PlanningDomainKey;
  onDomainChange: (domain: PlanningDomainKey) => void;
  onLoadDomainDataset?: (domain: PlanningDomainKey) => void;
  ruleConfig: ValidationRuleConfig;
  onUpdateRuleConfig: (patch: Partial<ValidationRuleConfig>) => void;
  onResetRuleConfig: () => void;
  sourceSheets: EnterpriseSheets;
  governedSheets: EnterpriseSheets;
  report: ValidationReport;
  profileReport: WorkbookProfileReport;
  reconciliationReport: ReconciliationReport;
  schemaDrift: SchemaDriftReport;
  lineageHistory: UploadLineageRecord[];
  exceptionAssignments: Record<string, ExceptionAssignment>;
  onAssignException: (signature: string, assignment: ExceptionAssignment) => void;
  onRemediateStructure: (table: string, column?: string) => void;
  onApplyColumnMapping: (
    table: string,
    sourceColumn: string,
    targetCanonicalColumn: string
  ) => void;
  gate: ReleaseGateState;
  formulaTests: FormulaTestCase[];
  approvedCorrections: ApprovedCorrection[];
  warningSignOff: WarningSignOff | null;
  workbookSource: string;
  activeSheet: string;
  onSelectSheet: (name: string) => void;
  onReviewException: (err: ValidationException) => void;
  onRevertCorrection: (corrId: string) => void;
  onRunSafeTechnicalFixes: () => void;
  onReloadSeeded: () => void;
  onProceedStep2: () => void;
  onOpenWarningSignOff: () => void;
  onFormulaVerifiedAudit: () => void;
}

const STATUS_BADGE: Record<
  ValidationExecutionStatus,
  { label: string; badgeClass: string; textClass: string }
> = {
  PASSED: {
    label: 'PASSED',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    textClass: 'text-emerald-700',
  },
  FAILED: {
    label: 'FAILED',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
    textClass: 'text-rose-700',
  },
  NOT_RUN: {
    label: 'NOT RUN',
    badgeClass: 'bg-slate-200 text-slate-800 border-slate-400',
    textClass: 'text-slate-700',
  },
  PARTIAL: {
    label: 'PARTIAL',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
    textClass: 'text-amber-700',
  },
};

const toDateInputValue = (value?: string): string => {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
};

const STEWARD_OWNERS = [
  'Unassigned',
  'Demand Planning Lead',
  'Master Data Steward',
  'Supply & MEIO Lead',
  'Commercial S&OP Lead',
  'Finance Governance',
];

export const Step1DataAssurance: React.FC<Step1DataAssuranceProps> = ({
  industry,
  domain,
  onDomainChange,
  onLoadDomainDataset,
  ruleConfig,
  onUpdateRuleConfig,
  onResetRuleConfig,
  sourceSheets,
  governedSheets,
  report,
  profileReport,
  reconciliationReport,
  schemaDrift,
  lineageHistory,
  exceptionAssignments,
  onAssignException,
  onRemediateStructure,
  onApplyColumnMapping,
  gate,
  formulaTests,
  approvedCorrections,
  warningSignOff,
  workbookSource,
  activeSheet,
  onSelectSheet,
  onReviewException,
  onRevertCorrection,
  onRunSafeTechnicalFixes,
  onReloadSeeded,
  onProceedStep2,
  onOpenWarningSignOff,
  onFormulaVerifiedAudit,
}) => {
  const [step1Tab, setStep1Tab] = useState<Step1Tab>('errors');
  const [stockoutApprovalOwnerDraft, setStockoutApprovalOwnerDraft] = useState(
    ruleConfig.stockoutRunRateMethodApprovedBy ?? ''
  );
  const [stockoutApprovalDateDraft, setStockoutApprovalDateDraft] = useState(
    toDateInputValue(ruleConfig.stockoutRunRateMethodApprovedAt)
  );
  const [stockoutApprovalDraftError, setStockoutApprovalDraftError] = useState('');
  useEffect(() => {
    setStockoutApprovalOwnerDraft(ruleConfig.stockoutRunRateMethodApprovedBy ?? '');
    setStockoutApprovalDateDraft(toDateInputValue(ruleConfig.stockoutRunRateMethodApprovedAt));
    setStockoutApprovalDraftError('');
  }, [ruleConfig.stockoutRunRateMethodApprovedBy, ruleConfig.stockoutRunRateMethodApprovedAt]);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setClockNowMs(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [tableFilter, setTableFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hubView, setHubView] = useState<'preview' | 'schema' | 'coverage' | 'lineage'>('preview');
  const [dataLayerView, setDataLayerView] = useState<'governed' | 'source'>('governed');
  const [profileTableTarget, setProfileTableTarget] = useState<string>(
    '01_Orders_Shipments_History'
  );

  const passedFormulaCount = formulaTests.filter((t) => t.passed).length;

  const activeSheets = dataLayerView === 'governed' ? governedSheets : sourceSheets;
  const sheetNames = Object.keys(activeSheets);
  const errors = report.exceptions;

  const filteredErrors = useMemo(() => {
    return errors.filter((e) => {
      if (severityFilter !== 'ALL' && e.severity !== severityFilter) return false;
      if (tableFilter !== 'ALL' && e.table !== tableFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${e.id} ${e.table} ${e.intersection} ${e.issue} ${e.badVal}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [errors, severityFilter, tableFilter, searchQuery]);

  const safeTechnicalCount = errors.filter(
    (e) => !e.requiresBusinessJudgement && e.fixType !== 'SCHEMA_REMEDIATION'
  ).length;

  const safeActiveSheet = activeSheets[activeSheet] ? activeSheet : sheetNames[0];
  const activeMeta = activeSheets[safeActiveSheet];
  const activeRecs = useMemo(
    () => (activeMeta?.records || []).filter((r) => !r._removed),
    [activeMeta]
  );

  const previewCols = useMemo(() => {
    if (activeRecs.length > 0) {
      const keySet = new Set<string>();
      activeRecs.forEach((r) => {
        Object.keys(r).forEach((k) => {
          if (!k.startsWith('_')) keySet.add(k);
        });
      });
      return Array.from(keySet);
    }
    return activeMeta?.cols.map((c) => c.col) || [];
  }, [activeRecs, activeMeta]);

  const selectedTableProfile = useMemo(() => {
    return (
      profileReport.tables.find((t) => t.table === profileTableTarget) ??
      profileReport.tables[0] ??
      null
    );
  }, [profileReport.tables, profileTableTarget]);

  const bannerColors = gate.step2Unlocked
    ? 'border-emerald-500 bg-slate-900'
    : gate.status === 'AWAITING_WARNING_SIGNOFF'
      ? 'border-amber-500 bg-amber-950'
      : 'border-rose-500 bg-rose-950';

  const domainContract = DOMAIN_CONTRACTS[domain] ?? DOMAIN_CONTRACTS.ALL;

  return (
    <section className="space-y-5" aria-label="Step 1 Data Assurance Hub">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
              Step 1 Foundation
            </span>
            <h1 className="text-lg font-extrabold text-slate-900">
              Enterprise Planning Data Assurance &amp; Governance Workbench
            </h1>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-bold">
              {INDUSTRY_LABELS[industry]}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5 mono-num">
            Source: {workbookSource} (Immutable Source) • {report.health.cleanRows}/
            {report.health.totalRows} Clean Rows (
            {report.health.rowPassRatePct !== null
              ? `${report.health.rowPassRatePct}% Row Pass`
              : 'N/A'}
            ) •{' '}
            <strong className="text-slate-900">
              Composite Quality Score:{' '}
              {report.health.overallQualityScorePct !== null
                ? `${report.health.overallQualityScorePct}%`
                : 'N/A'}
            </strong>
            {report.health.structuralPenaltyPct > 0
              ? ` (-${report.health.structuralPenaltyPct}% structural/table penalty)`
              : ''}{' '}
            • {report.health.executedCategories}/{report.health.totalCategories} Validation
            Pillars Executed
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs">
            <label
              htmlFor="planningDomainSelect"
              className="text-[10px] font-extrabold uppercase text-slate-500"
            >
              Domain Contract:
            </label>
            <select
              id="planningDomainSelect"
              aria-label="Planning Domain Contract"
              value={domain}
              onChange={(e) => onDomainChange(e.target.value as PlanningDomainKey)}
              className="font-bold text-slate-900 bg-transparent focus:outline-none text-xs"
            >
              {(Object.keys(PLANNING_DOMAIN_LABELS) as PlanningDomainKey[]).map((dk) => (
                <option key={dk} value={dk}>
                  {PLANNING_DOMAIN_LABELS[dk]}
                </option>
              ))}
            </select>
          </div>

          {onLoadDomainDataset && domain !== 'ALL' && (
            <button
              type="button"
              onClick={() => onLoadDomainDataset(domain)}
              className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
            >
              Load {domain} Test Dataset
            </button>
          )}

          <button
            type="button"
            onClick={onReloadSeeded}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition"
          >
            ↺ Reload Seeded Dataset
          </button>
          {safeTechnicalCount > 0 && (
            <button
              type="button"
              onClick={onRunSafeTechnicalFixes}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-sm transition"
            >
              Run Safe Technical Fixes ({safeTechnicalCount})
            </button>
          )}
          <button
            type="button"
            onClick={onProceedStep2}
            className={`text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition ${
              gate.step2Unlocked
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : gate.status === 'AWAITING_WARNING_SIGNOFF'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-rose-700 hover:bg-rose-800'
            }`}
          >
            {gate.step2Unlocked
              ? '✓ Proceed to Step 2: Demand Core →'
              : gate.status === 'AWAITING_WARNING_SIGNOFF'
                ? `⚠ Sign Off ${gate.warningCount} Warning(s) to Unlock`
                : `🔒 Gate Locked (${gate.blockingReasons.length} Gate Failure)`}
          </button>
        </div>
      </div>

      {/* 6-Pillar Explicit Execution Status Scorecard (PASSED / FAILED / NOT RUN / PARTIAL) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
        {report.categories.map((cat) => {
          const style = STATUS_BADGE[cat.status];
          return (
            <div key={cat.key} className="card p-3 flex flex-col justify-between gap-1.5">
              <div className="flex items-start justify-between gap-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-500 leading-tight">
                  {cat.label}
                </span>
                <span
                  data-testid={`cat-status-${cat.key}`}
                  className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${style.badgeClass}`}
                >
                  {style.label}
                </span>
              </div>
              <div className={`text-sm font-extrabold mono-num ${style.textClass}`}>
                {cat.status === 'NOT_RUN'
                  ? 'Not Validated'
                  : cat.status === 'PARTIAL'
                    ? `${cat.checksExecuted}/${cat.checksAttempted} Checked`
                    : cat.issueCount === 0
                      ? '0 Issues'
                      : `${cat.issueCount} Issue(s)`}
              </div>
              <div className="text-[10px] text-slate-500 leading-snug">{cat.detail}</div>
            </div>
          );
        })}
      </div>

      {/* STRICT 5-CONDITION RELEASE GATE BANNER */}
      <div
        data-testid="release-gate-banner"
        data-gate-status={gate.status}
        className={`card p-4 border-2 text-white space-y-3 ${bannerColors}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-extrabold text-lg shrink-0 ${
                gate.step2Unlocked
                  ? 'bg-emerald-600'
                  : gate.status === 'AWAITING_WARNING_SIGNOFF'
                    ? 'bg-amber-600'
                    : 'bg-rose-600'
              }`}
            >
              {gate.step2Unlocked ? '🔓' : gate.status === 'AWAITING_WARNING_SIGNOFF' ? '⚠' : '🔒'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                    gate.step2Unlocked
                      ? 'bg-emerald-500 text-slate-950'
                      : gate.status === 'AWAITING_WARNING_SIGNOFF'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-rose-600 text-white'
                  }`}
                >
                  {gate.step2Unlocked
                    ? 'Release Gate Passed ✓'
                    : gate.status === 'AWAITING_WARNING_SIGNOFF'
                      ? 'Mandatory Warning Sign-Off Required'
                      : 'Forecasting Gate Blocked'}
                </span>
                <h2 className="text-sm font-extrabold text-white">
                  {gate.step2Unlocked
                    ? 'All 5 Release Gate Conditions Passed — Step 2 Demand Core Unlocked'
                    : gate.status === 'AWAITING_WARNING_SIGNOFF'
                      ? `0 Critical Blockers — Acknowledge ${gate.warningCount} Remaining Warning(s) to Unlock Step 2`
                      : 'Step 2 Blocked Until Schema, Required Checks, Critical Exceptions & Formula Tests Pass'}
                </h2>
              </div>
              <p className="text-xs text-slate-200 mt-0.5">
                {gate.step2Unlocked
                  ? gate.warningPolicySatisfied && warningSignOff
                    ? `Warnings acknowledged by ${warningSignOff.approver} (${warningSignOff.expiry}). Source data remains untouched.`
                    : '100% of schema, validation, and formula regression checks passed cleanly.'
                  : `Active Contract: ${domainContract.label} (${domainContract.mandatoryTables.length} mandatory tables). Business-judgement corrections require explicit human review and approval in 1A.`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {gate.criticalCount === 0 &&
              gate.schemaPassed &&
              gate.allRequiredValidationsExecuted &&
              gate.formulaTestsPassed &&
              gate.warningCount > 0 &&
              !gate.warningPolicySatisfied && (
                <button
                  type="button"
                  onClick={onOpenWarningSignOff}
                  className="bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                >
                  Log Mandatory Warning Sign-Off
                </button>
              )}
            <button
              type="button"
              onClick={() => {
                setStep1Tab('calctest');
                onFormulaVerifiedAudit();
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
            >
              Verify {passedFormulaCount}/{formulaTests.length} Formula Tests
            </button>
          </div>
        </div>

        {/* 5-Condition Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-2 border-t border-white/15 text-[11px]">
          {gate.conditions.map((cond) => (
            <div
              key={cond.label}
              className={`p-2 rounded-lg border ${
                cond.passed
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-100'
                  : 'bg-black/30 border-rose-400/50 text-rose-100'
              }`}
            >
              <div className="font-bold flex items-start gap-1 leading-tight">
                <span className="shrink-0">{cond.passed ? '✓' : '✕'}</span>
                <span>{cond.label}</span>
              </div>
              <div className="text-[10px] opacity-85 mt-0.5">{cond.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-200 p-1.5 rounded-xl">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Step 1 Sub-views">
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'errors'}
            onClick={() => setStep1Tab('errors')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              step1Tab === 'errors'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1A. Exception Review &amp; Approval ({errors.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'profiling'}
            onClick={() => setStep1Tab('profiling')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              step1Tab === 'profiling'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1B. Data Profiling &amp; 7-Dimension Quality (
            {report.health.overallQualityScorePct ?? 0}%)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'reconciliation'}
            onClick={() => setStep1Tab('reconciliation')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              step1Tab === 'reconciliation'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1C. Cross-Table Reconciliation &amp; Rules ({reconciliationReport.reconciledCount}/
            {reconciliationReport.checks.length} Reconciled)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'calctest'}
            onClick={() => setStep1Tab('calctest')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              step1Tab === 'calctest'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1D. Calculation &amp; Formula Testing ({formulaTests.length} Checks)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'schema12'}
            onClick={() => setStep1Tab('schema12')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
              step1Tab === 'schema12'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1E. Enterprise Schema, Lineage &amp; Preview ({sheetNames.length} Tables)
          </button>
        </div>

        {step1Tab === 'errors' && (
          <div className="flex flex-wrap items-center gap-2 pr-2 text-xs">
            <input
              type="search"
              placeholder="Search SKU, depot, issue..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-slate-300 rounded-md px-2.5 py-1 text-xs bg-white font-medium w-44"
            />
            <select
              aria-label="Table Filter"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white font-semibold"
            >
              <option value="ALL">All Tables</option>
              {sheetNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label htmlFor="errorSeverityFilter" className="text-[11px] font-semibold text-slate-600">
              Severity:
            </label>
            <select
              id="errorSeverityFilter"
              value={severityFilter}
              onChange={(e) =>
                setSeverityFilter(e.target.value as 'ALL' | 'CRITICAL' | 'WARNING')
              }
              className="border border-slate-300 rounded-md px-2.5 py-1 text-xs bg-white font-semibold"
            >
              <option value="ALL">All Detected Exceptions</option>
              <option value="CRITICAL">Critical Blockers Only</option>
              <option value="WARNING">Warnings Only</option>
            </select>
          </div>
        )}
      </div>

      {/* 1A: EXCEPTION REVIEW & GOVERNED APPROVAL WORKBENCH */}
      {step1Tab === 'errors' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  1A. Row-Level Data Quality &amp; Exception Workbench
                </h2>
                <p className="text-xs text-slate-500">
                  Original source values remain untouched. Review each exception to confirm or
                  supply a verified business value—nothing is invented silently.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {report.health.tableLevelFailureCount > 0 && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 mono-num">
                    {report.health.tableLevelFailureCount} Table/Series Structural Issue(s)
                  </span>
                )}
                <span className="text-[11px] font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-700 mono-num">
                  {approvedCorrections.length} Governed Correction(s) Applied
                </span>
              </div>
            </div>

            <div
              data-testid="date-convention-banner"
              className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <span className="font-extrabold text-slate-900">
                  Accepted Date Formats &amp; Normalization Policy:
                </span>{' '}
                Use <code className="font-mono font-bold text-blue-800">YYYY-MM-DD</code> (e.g.{' '}
                <code className="font-mono">2025-02-01</code>),{' '}
                <code className="font-mono font-bold text-blue-800">DD-MMM-YYYY</code> (e.g.{' '}
                <code className="font-mono">01-Feb-2025</code>), unambiguous{' '}
                <code className="font-mono font-bold text-blue-800">DD/MM/YYYY</code> (where day &gt;
                12), or native Excel Date cells.
              </div>
              <div className="text-slate-600">
                Ambiguous dates where both day &amp; month ≤ 12 (e.g.{' '}
                <code className="font-mono font-bold text-rose-700">01/02/2025</code>) are rejected—normalize to{' '}
                <code className="font-mono font-bold">YYYY-MM-DD</code> in Excel or click{' '}
                <strong>Review &amp; Approve</strong>.
              </div>
            </div>

            <div className="overflow-x-auto max-h-[440px]">
              <table className="w-full text-[11px] text-left mono-num table-auto">
                <thead className="bg-slate-900 text-white sticky top-0">
                  <tr>
                    <th className="py-2 px-2">ID</th>
                    <th className="py-2 px-2 font-sans">Severity</th>
                    <th className="py-2 px-2">Table &amp; Row</th>
                    <th className="py-2 px-2">SKU / Intersection</th>
                    <th className="py-2 px-2 font-sans">Issue Description</th>
                    <th className="py-2 px-2">Original Value</th>
                    <th className="py-2 px-2 font-sans">Owner / Steward</th>
                    <th className="py-2 px-2 font-sans">Governance Action</th>
                    <th className="py-2 px-2 text-right font-sans">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredErrors.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-6 text-center text-emerald-700 font-bold font-sans"
                      >
                        ✓ Zero exceptions match the current filter. Governed working dataset is
                        clean!
                      </td>
                    </tr>
                  ) : (
                    filteredErrors.map((err) => {
                      const assigned = exceptionAssignments[err.signature];
                      const isStructuralMissingTableOrCol =
                        err.rowIndex === -1 &&
                        err.fixType === 'SCHEMA_REMEDIATION' &&
                        (err.signature.startsWith('SCHEMA|MISSING_TABLE|') ||
                          err.signature.startsWith('SCHEMA|EMPTY_TABLE|') ||
                          err.signature.startsWith('SCHEMA|MISSING_COL|'));
                      const missingColName = err.signature.startsWith('SCHEMA|MISSING_COL|')
                        ? err.signature.split('|')[3]
                        : undefined;

                      return (
                        <tr
                          key={err.id}
                          className={
                            err.severity === 'CRITICAL'
                              ? 'bg-rose-50/40 hover:bg-rose-50/80 transition'
                              : 'hover:bg-amber-50/50 transition'
                          }
                        >
                          <td className="py-2 px-2 font-bold text-slate-900 whitespace-nowrap">
                            {err.id}
                          </td>
                          <td className="py-2 px-2 font-sans whitespace-nowrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                err.severity === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {err.severity}
                            </span>
                          </td>
                          <td className="py-2 px-2 max-w-[160px] break-words">
                            <div className="font-bold text-blue-800">{err.table}</div>
                            <div className="text-[10px] text-slate-500">
                              {err.rowNum > 0 ? `Row #${err.rowNum}` : 'Series / Schema'}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-slate-800 font-semibold max-w-[155px] break-words">
                            {err.intersection}
                          </td>
                          <td className="py-2 px-2 font-sans text-slate-700 max-w-[220px] break-words">
                            {err.issue}
                          </td>
                          <td className="py-2 px-2 text-rose-700 font-bold max-w-[120px] break-words">
                            {err.badVal}
                          </td>
                          <td className="py-2 px-2 font-sans whitespace-nowrap">
                            <div className="space-y-1 min-w-[150px]">
                              <select
                                aria-label={`Assign owner for ${err.id}`}
                                value={assigned?.owner ?? 'Unassigned'}
                                onChange={(e) =>
                                  onAssignException(err.signature, {
                                    owner: e.target.value,
                                    slaHours: assigned?.slaHours ?? (err.severity === 'CRITICAL' ? 4 : 24),
                                    status: e.target.value === 'Unassigned' ? 'OPEN' : 'IN_REVIEW',
                                  })
                                }
                                className="border border-slate-300 rounded px-1.5 py-0.5 text-[10px] bg-white font-semibold text-slate-700 max-w-[150px]"
                              >
                                {assigned?.owner && !STEWARD_OWNERS.includes(assigned.owner) && (
                                  <option value={assigned.owner}>Legacy: {assigned.owner}</option>
                                )}
                                {STEWARD_OWNERS.map((owner) => (
                                  <option key={owner} value={owner}>
                                    {owner}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`Set assignment status for ${err.id}`}
                                value={assigned?.status ?? 'OPEN'}
                                onChange={(e) =>
                                  onAssignException(err.signature, {
                                    owner: assigned?.owner ?? 'Unassigned',
                                    slaHours: assigned?.slaHours ?? (err.severity === 'CRITICAL' ? 4 : 24),
                                    status: e.target.value as ExceptionAssignment['status'],
                                  })
                                }
                                className="border border-slate-300 rounded px-1 py-0.5 text-[10px] bg-white text-slate-700 max-w-[150px]"
                              >
                                <option value="OPEN">Open</option>
                                <option value="IN_REVIEW">In Review</option>
                                <option value="ESCALATED">Escalated</option>
                                <option value="RESOLVED">Assignment Resolved</option>
                              </select>
                              {assigned?.dueAt && (
                                <div className="text-[9px] leading-tight">
                                  <span className={`font-semibold ${assigned.status !== 'RESOLVED' && Date.parse(assigned.dueAt) < clockNowMs ? 'text-rose-700' : 'text-slate-500'}`}>
                                    {assigned.status !== 'RESOLVED' && Date.parse(assigned.dueAt) < clockNowMs ? 'OVERDUE • ' : 'Due • '}
                                    {new Date(assigned.dueAt).toLocaleString()} ({assigned.slaHours}h SLA)
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 font-sans text-slate-700 max-w-[165px] break-words">
                            {err.suggestedValText}
                          </td>
                          <td className="py-2 px-2 text-right font-sans whitespace-nowrap space-x-1">
                            {isStructuralMissingTableOrCol && (
                              <button
                                type="button"
                                onClick={() => onRemediateStructure(err.table, missingColName)}
                                className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap"
                              >
                                + Initialize Structure
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onReviewException(err)}
                              aria-label={`Review ${err.id} in ${err.table}`}
                              className="px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition whitespace-nowrap"
                            >
                              Review &amp; Approve
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Approved Corrections Ledger (Before / After + Lifecycle Status + Revert) */}
          {approvedCorrections.length > 0 && (
            <div className="card p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  Approved Corrections Ledger (Non-Destructive Overlay — Source Kept Untouched)
                </h3>
                {approvedCorrections.some((c) => c.status === 'INVALIDATED_BY_REMEDIATION') && (
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-extrabold">
                    ⚠ {approvedCorrections.filter((c) => c.status === 'INVALIDATED_BY_REMEDIATION').length} Correction(s) Invalidated by Remediation — Revert or Re-Approve
                  </span>
                )}
              </div>
              <div className="overflow-x-auto max-h-[240px]">
                <table className="w-full text-[11px] text-left mono-num">
                  <thead className="bg-slate-100 text-slate-700 border-b">
                    <tr>
                      <th className="py-1.5 px-2">Table</th>
                      <th className="py-1.5 px-2 font-sans">Status &amp; Version Lineage</th>
                      <th className="py-1.5 px-2">Before (Source)</th>
                      <th className="py-1.5 px-2">After (Approved)</th>
                      <th className="py-1.5 px-2 font-sans">Approver &amp; Justification</th>
                      <th className="py-1.5 px-2 text-right font-sans">Revert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {approvedCorrections.map((c) => {
                      const isInvalidated = c.status === 'INVALIDATED_BY_REMEDIATION';
                      const isRevalidated =
                        !isInvalidated &&
                        c.originalDatasetVersion !== undefined &&
                        c.originalDatasetVersion !== c.datasetVersion;
                      return (
                        <tr key={c.id} className={isInvalidated ? 'bg-rose-50/60' : ''}>
                          <td className="py-1.5 px-2 font-bold text-blue-800">{c.table}</td>
                          <td className="py-1.5 px-2 font-sans">
                            {isInvalidated ? (
                              <div className="space-y-0.5">
                                <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[9px] font-extrabold uppercase">
                                  INVALIDATED_BY_REMEDIATION
                                </span>
                                <div className="text-[10px] text-rose-800">
                                  {c.invalidationReason || 'Dependency modified; requires fresh approval'} (Orig v{c.datasetVersion ?? 1})
                                </div>
                              </div>
                            ) : isRevalidated ? (
                              <div className="space-y-0.5">
                                <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-300 text-[9px] font-extrabold uppercase">
                                  REVALIDATED v{c.originalDatasetVersion}→v{c.datasetVersion}
                                </span>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  Orig: {(c.originalSourceWorkbookHash ?? '').slice(0, 14)}…
                                </div>
                              </div>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-extrabold uppercase">
                                ACTIVE (v{c.datasetVersion ?? 1})
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-rose-700">{c.beforeSummary}</td>
                          <td className="py-1.5 px-2 text-emerald-700 font-bold">
                            {c.afterSummary}
                          </td>
                          <td className="py-1.5 px-2 font-sans text-slate-600">
                            <strong>{c.approver}</strong>: {c.reason}
                          </td>
                          <td className="py-1.5 px-2 text-right font-sans">
                            <button
                              type="button"
                              onClick={() => onRevertCorrection(c.id)}
                              className="px-2 py-0.5 rounded border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                            >
                              Revert
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1B: UNIVERSAL DATA PROFILING & 7-DIMENSION QUALITY SCORECARD */}
      {step1Tab === 'profiling' && (
        <div className="space-y-4">
          {/* 7-Dimension Quality Scorecard */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  1B. 7-Dimension Data Quality Scorecard &amp; Structural Penalty Breakdown
                </h2>
                <p className="text-xs text-slate-500">
                  Combines row-level pass rate ({report.health.rowPassRatePct ?? 0}%) with
                  table/series structural penalties (-{report.health.structuralPenaltyPct}%) so
                  missing tables or unexecuted pillars never hide behind clean rows.
                </p>
              </div>
              <div className="flex items-center gap-3 mono-num text-xs">
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-800 font-bold">
                  Row Pass Rate: {report.health.rowPassRatePct ?? 0}%
                </span>
                <span className="px-2.5 py-1 rounded bg-slate-900 text-white font-extrabold">
                  Overall Quality Score: {report.health.overallQualityScorePct ?? 0}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 text-xs">
              {(report.health.dimensions ?? []).map((dim) => (
                <div
                  key={dim.dimension}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-600 leading-tight">
                      {dim.dimension}
                    </span>
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                        dim.status === 'HEALTHY'
                          ? 'bg-emerald-100 text-emerald-800'
                          : dim.status === 'DEGRADED'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {dim.status}
                    </span>
                  </div>
                  <div className="text-base font-extrabold text-slate-900 mono-num">
                    {dim.scorePct}%
                  </div>
                  <div className="text-[10px] text-slate-500">{dim.summary}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Entity Hotspots (Top Problematic SKUs, Depots, Tables) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-3.5 space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                Top Problematic SKUs (Exception Hotspots)
              </h3>
              {profileReport.topProblematicSkus.length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold py-2">
                  ✓ Zero SKU exceptions active
                </p>
              ) : (
                <div className="space-y-1.5 text-xs mono-num">
                  {profileReport.topProblematicSkus.map((h) => (
                    <div
                      key={h.entityKey}
                      className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200"
                    >
                      <span className="font-bold text-slate-900">{h.entityKey}</span>
                      <span className="text-[11px]">
                        <strong className="text-rose-700">{h.criticalCount} Crit</strong> •{' '}
                        <strong className="text-amber-800">{h.warningCount} Warn</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-3.5 space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                Top Problematic Depots / Locations
              </h3>
              {profileReport.topProblematicDepots.length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold py-2">
                  ✓ Zero Depot exceptions active
                </p>
              ) : (
                <div className="space-y-1.5 text-xs mono-num">
                  {profileReport.topProblematicDepots.map((h) => (
                    <div
                      key={h.entityKey}
                      className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200"
                    >
                      <span className="font-bold text-slate-900">{h.entityKey}</span>
                      <span className="text-[11px]">
                        <strong className="text-rose-700">{h.criticalCount} Crit</strong> •{' '}
                        <strong className="text-amber-800">{h.warningCount} Warn</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-3.5 space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                Top Problematic Planning Tables
              </h3>
              {profileReport.topProblematicTables.length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold py-2">
                  ✓ Zero Table exceptions active
                </p>
              ) : (
                <div className="space-y-1.5 text-xs mono-num">
                  {profileReport.topProblematicTables.map((h) => (
                    <div
                      key={h.entityKey}
                      className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200"
                    >
                      <span className="font-bold text-blue-800 truncate max-w-[180px]">
                        {h.entityKey}
                      </span>
                      <span className="text-[11px] shrink-0">
                        <strong className="text-rose-700">{h.criticalCount} Crit</strong> •{' '}
                        <strong className="text-amber-800">{h.warningCount} Warn</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Table-Level Profiling Matrix */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
              Table-Level Statistical &amp; Continuity Profile ({profileReport.tables.length} Tables)
            </h3>
            <div className="overflow-x-auto max-h-[260px]">
              <table className="w-full text-[11px] text-left mono-num">
                <thead className="bg-slate-900 text-white sticky top-0">
                  <tr>
                    <th className="py-2 px-2.5">Table Name</th>
                    <th className="py-2 px-2.5 font-sans">Business Grain</th>
                    <th className="py-2 px-2.5">Rows</th>
                    <th className="py-2 px-2.5">Cols</th>
                    <th className="py-2 px-2.5">Completeness</th>
                    <th className="py-2 px-2.5">Granularity</th>
                    <th className="py-2 px-2.5">Horizon Range</th>
                    <th className="py-2 px-2.5">Dup Keys</th>
                    <th className="py-2 px-2.5">Orphan FKs</th>
                    <th className="py-2 px-2.5">Period Gaps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {profileReport.tables.map((tp) => (
                    <tr
                      key={tp.table}
                      onClick={() => setProfileTableTarget(tp.table)}
                      className={`cursor-pointer transition ${
                        selectedTableProfile?.table === tp.table
                          ? 'bg-blue-50/80 font-semibold'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-1.5 px-2.5 font-bold text-blue-800">{tp.table}</td>
                      <td className="py-1.5 px-2.5 font-sans text-slate-600">{tp.grain}</td>
                      <td className="py-1.5 px-2.5">{tp.rowCount}</td>
                      <td className="py-1.5 px-2.5">{tp.columnCount}</td>
                      <td
                        className={`py-1.5 px-2.5 font-bold ${
                          tp.completenessPct === 100 ? 'text-emerald-700' : 'text-amber-800'
                        }`}
                      >
                        {tp.completenessPct}%
                      </td>
                      <td className="py-1.5 px-2.5">{tp.timeGranularity}</td>
                      <td className="py-1.5 px-2.5">
                        {tp.minPeriod ? `${tp.minPeriod} → ${tp.maxPeriod}` : 'Master / Static'}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 font-bold ${
                          tp.duplicateKeyCount > 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {tp.duplicateKeyCount}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 font-bold ${
                          tp.orphanFkCount > 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {tp.orphanFkCount}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 font-bold ${
                          tp.timeSeriesGapCount > 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {tp.timeSeriesGapCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 18-Metric Column-Level Distribution Profile */}
          {selectedTableProfile && (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Column-Level Distribution &amp; Quantile Profile — {selectedTableProfile.table}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Full 18-metric statistical distribution (Null %, Distinct %, Min, Max, Mean,
                    Median, StdDev, IQR, P5, P95, Z-Outliers).
                  </p>
                </div>
                <select
                  aria-label="Select Table for Column Profiling"
                  value={selectedTableProfile.table}
                  onChange={(e) => setProfileTableTarget(e.target.value)}
                  className="border border-slate-300 rounded-md px-2.5 py-1 text-xs bg-white font-bold text-slate-800"
                >
                  {profileReport.tables.map((t) => (
                    <option key={t.table} value={t.table}>
                      {t.table}
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-x-auto max-h-[340px]">
                <table className="w-full text-[11px] text-left mono-num">
                  <thead className="bg-slate-100 text-slate-700 border-b sticky top-0">
                    <tr>
                      <th className="py-2 px-2">Column</th>
                      <th className="py-2 px-2">Expected → Inferred</th>
                      <th className="py-2 px-2">Non-Null</th>
                      <th className="py-2 px-2">Null %</th>
                      <th className="py-2 px-2">Distinct</th>
                      <th className="py-2 px-2">Invalid</th>
                      <th className="py-2 px-2">Zero / Neg</th>
                      <th className="py-2 px-2">Min</th>
                      <th className="py-2 px-2">Max</th>
                      <th className="py-2 px-2">Mean</th>
                      <th className="py-2 px-2">Median</th>
                      <th className="py-2 px-2">StdDev</th>
                      <th className="py-2 px-2">IQR</th>
                      <th className="py-2 px-2">P5 / P95</th>
                      <th className="py-2 px-2">Z / IQR Outliers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedTableProfile.columns.map((cp) => (
                      <tr key={cp.column} className="hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-bold text-slate-900">{cp.column}</td>
                        <td className="py-1.5 px-2 text-[10px]">
                          <span className="text-slate-600">{cp.expectedType}</span>
                          {' → '}
                          <span
                            className={`font-bold ${
                              cp.typeMismatch ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {cp.inferredType}
                          </span>
                        </td>
                        <td className="py-1.5 px-2">
                          {cp.nonNullCount}/{cp.totalCount}
                        </td>
                        <td
                          className={`py-1.5 px-2 font-bold ${
                            cp.nullPct > 0 ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {cp.nullPct}%
                        </td>
                        <td className="py-1.5 px-2">
                          {cp.distinctCount} ({cp.distinctPct}%)
                        </td>
                        <td
                          className={`py-1.5 px-2 font-bold ${
                            cp.invalidTypeCount > 0 ? 'text-rose-700' : 'text-slate-500'
                          }`}
                          title={
                            cp.invalidSampleValues && cp.invalidSampleValues.length > 0
                              ? `Invalid samples: ${cp.invalidSampleValues.join(', ')}`
                              : undefined
                          }
                        >
                          {cp.invalidTypeCount}
                        </td>
                        <td className="py-1.5 px-2">
                          {cp.zeroCount}z / {cp.negativeCount}n
                        </td>
                        <td className="py-1.5 px-2">{cp.min !== null ? cp.min : '—'}</td>
                        <td className="py-1.5 px-2">{cp.max !== null ? cp.max : '—'}</td>
                        <td className="py-1.5 px-2">{cp.mean !== null ? cp.mean : '—'}</td>
                        <td className="py-1.5 px-2">{cp.median !== null ? cp.median : '—'}</td>
                        <td className="py-1.5 px-2">{cp.stdDev !== null ? cp.stdDev : '—'}</td>
                        <td className="py-1.5 px-2">{cp.iqr !== null ? cp.iqr : '—'}</td>
                        <td className="py-1.5 px-2">
                          {cp.p5 !== null ? `${cp.p5} / ${cp.p95}` : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-2 font-bold ${
                            cp.outlierCount > 0 || (cp.iqrOutlierCount ?? 0) > 0
                              ? 'text-rose-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {cp.outlierCount}z / {cp.iqrOutlierCount ?? 0}iqr
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1C: CROSS-TABLE RECONCILIATION & CONFIGURABLE VALIDATION RULES */}
      {step1Tab === 'reconciliation' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  1C. Certified Cross-Table Physical &amp; Financial Data Assurance Reconciliations
                </h2>
                <p className="text-xs text-slate-500">
                  Verifies exact mathematical identities across Order-to-Shipment flow, Channel/Date
                  Effective Price × Billed Volume vs. Booked Revenue, Stockout-Uncensored Demand
                  restoration formula, Master FK referential coverage, and Lead-Time policy ceilings.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs mono-num">
                <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-bold">
                  {reconciliationReport.reconciledCount} Reconciled
                </span>
                <span className="px-2.5 py-1 rounded bg-amber-100 text-amber-900 font-bold">
                  {reconciliationReport.warningCount} Variance Warnings
                </span>
                <span className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 font-bold">
                  {reconciliationReport.criticalCount} Critical Mismatches
                </span>
                {(reconciliationReport.notRunCount ?? 0) > 0 && (
                  <span className="px-2.5 py-1 rounded bg-slate-200 text-slate-800 font-bold">
                    {reconciliationReport.notRunCount} Not Run
                  </span>
                )}
                {(reconciliationReport.notApplicableCount ?? 0) > 0 && (
                  <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-600 font-bold">
                    {reconciliationReport.notApplicableCount} Out of Domain
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {reconciliationReport.checks.map((chk) => (
                <div
                  key={chk.id}
                  className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-2 flex flex-col justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-500 text-[10px]">
                        {chk.id} • Grain: {chk.grain}
                      </span>
                      <span
                        className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                          chk.status === 'RECONCILED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : chk.status === 'VARIANCE_WARNING' ||
                                chk.status === 'METHODOLOGY_UNAPPROVED'
                              ? 'bg-amber-100 text-amber-900'
                              : chk.status === 'CRITICAL_MISMATCH'
                                ? 'bg-rose-100 text-rose-800'
                                : chk.status === 'NOT_RUN'
                                  ? 'bg-slate-200 text-slate-800'
                                  : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {chk.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 className="font-extrabold text-slate-900">{chk.name}</h3>
                    <p className="text-[10px] font-mono text-indigo-800 bg-indigo-50/70 px-1.5 py-0.5 rounded">
                      {chk.equation}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {chk.leftSource} ↔ {chk.rightSource}
                    </p>
                    {chk.ruleVersion && (
                      <div className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 space-y-0.5">
                        <div className="flex flex-wrap justify-between gap-1">
                          <span><strong>Contract:</strong> v{chk.ruleVersion} ({chk.units})</span>
                          <span><strong>Owner:</strong> {chk.owner}</span>
                        </div>
                        <div className="text-[9px] text-slate-500">
                          <strong>Zero/Partial Policy:</strong> {chk.nullDenominatorBehavior}
                        </div>
                        <div className="text-[9px] text-slate-500">
                          <strong>Sign-Off:</strong> {chk.certifiedBy ? `${chk.certifiedBy} (${chk.certifiedAt})` : 'Pending Owner Certification'}
                        </div>
                      </div>
                    )}
                    {chk.methodologyStatus && chk.methodologyStatus !== 'N/A' && (
                      <div className="pt-0.5">
                        <span
                          className={`inline-block text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${
                            chk.methodologyStatus === 'APPROVED_BENCHMARK'
                              ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                              : 'bg-amber-50 text-amber-900 border-amber-300'
                          }`}
                        >
                          {chk.methodologyStatus === 'APPROVED_BENCHMARK'
                            ? 'Method: Approved Run-Rate Benchmark + Physical Bound'
                            : 'Method: Physical Source Bound Only (Benchmark Unapproved)'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-2 rounded bg-slate-50 border border-slate-200 mono-num space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Left Aggregate:</span>
                      <strong className="text-slate-900">{chk.leftTotal.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Right Aggregate:</span>
                      <strong className="text-slate-900">{chk.rightTotal.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Eligible / Excluded Rows:</span>
                      <span className="text-slate-700 font-semibold">
                        {chk.eligibleRecordsCount} / {chk.excludedRecordsCount}
                      </span>
                    </div>
                    {chk.flowBreakdown && chk.id === 'REC-01' && (
                      <div className="border-t border-slate-200 pt-1 text-[10px] space-y-0.5 text-slate-600">
                        <div className="flex justify-between">
                          <span>Gross Ordered / Cancelled:</span>
                          <strong>
                            {Number(chk.flowBreakdown.grossOrderedUnits ?? 0).toLocaleString()} /{' '}
                            {Number(chk.flowBreakdown.cancelledUnits ?? 0).toLocaleString()} u
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Billed Shipped / Open Backorder:</span>
                          <strong>
                            {Number(chk.flowBreakdown.grossBilledShippedUnits ?? 0).toLocaleString()}{' '}
                            / {Number(chk.flowBreakdown.openBackorderUnits ?? 0).toLocaleString()} u
                          </strong>
                        </div>
                        <div className="flex justify-between text-indigo-800">
                          <span>Reverse-Flow Returns (Net Delivered):</span>
                          <strong>
                            {Number(chk.flowBreakdown.returnsReverseFlowUnits ?? 0).toLocaleString()}{' '}
                            u ({Number(chk.flowBreakdown.netDeliveredUnits ?? 0).toLocaleString()} u)
                          </strong>
                        </div>
                      </div>
                    )}
                    {chk.flowBreakdown && chk.id === 'REC-02' && (
                      <div className="border-t border-slate-200 pt-1 text-[10px] space-y-0.5 text-slate-600">
                        <div className="flex justify-between">
                          <span>Matched Effective-Date Lines:</span>
                          <strong>{String(chk.flowBreakdown.matchedInvoiceLines ?? 0)}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Rejected Future-Dated Lines:</span>
                          <strong
                            className={
                              Number(chk.flowBreakdown.futureDatedUnmatchedLines ?? 0) > 0
                                ? 'text-rose-700'
                                : 'text-slate-700'
                            }
                          >
                            {String(chk.flowBreakdown.futureDatedUnmatchedLines ?? 0)}
                          </strong>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1">
                      <span className="text-slate-500">Variance (Tol ≤ {chk.tolerancePct}%):</span>
                      <strong
                        className={
                          chk.status === 'RECONCILED'
                            ? 'text-emerald-700'
                            : chk.status === 'VARIANCE_WARNING' ||
                                chk.status === 'METHODOLOGY_UNAPPROVED'
                              ? 'text-amber-800'
                              : chk.status === 'CRITICAL_MISMATCH'
                                ? 'text-rose-700'
                                : 'text-slate-600'
                        }
                      >
                        {chk.varianceAbs.toLocaleString()} (
                        {chk.variancePct !== null ? `${chk.variancePct}%` : 'N/A'})
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-600">{chk.detail}</div>
                    <div className="text-[10px] text-slate-400 italic">
                      Filter: {chk.exclusionRule}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Configurable Domain & Industry Rule Thresholds */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Configurable Validation &amp; Reconciliation Policy Thresholds (
                  {INDUSTRY_LABELS[industry]})
                </h3>
                <p className="text-xs text-slate-500">
                  Adjusting these governance parameters immediately re-evaluates all 12 tables,
                  reconciliation variances, and release-gate conditions.
                </p>
              </div>
              <button
                type="button"
                onClick={onResetRuleConfig}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                Reset to {industry.toUpperCase()} Default Policy
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <label
                  htmlFor="cfgCasePackMin"
                  className="font-bold text-slate-700 block text-[11px]"
                >
                  Min Standard CASE Pack (EA/CASE)
                </label>
                <input
                  id="cfgCasePackMin"
                  type="number"
                  min={2}
                  max={144}
                  value={ruleConfig.standardCasePackMin}
                  onChange={(e) =>
                    onUpdateRuleConfig({
                      standardCasePackMin: Math.max(2, Number(e.target.value) || 12),
                    })
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white mono-num font-bold"
                />
              </div>



              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <label
                  htmlFor="cfgSalesOverrideMax"
                  className="font-bold text-slate-700 block text-[11px]"
                >
                  Max Unjustified Sales Override (+%)
                </label>
                <input
                  id="cfgSalesOverrideMax"
                  type="number"
                  min={5}
                  max={100}
                  value={ruleConfig.salesOverrideMaxPct}
                  onChange={(e) =>
                    onUpdateRuleConfig({
                      salesOverrideMaxPct: Math.max(5, Number(e.target.value) || 25),
                    })
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white mono-num font-bold"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <label
                  htmlFor="cfgMinSlaPct"
                  className="font-bold text-slate-700 block text-[11px]"
                >
                  Min Channel Target SLA (%)
                </label>
                <input
                  id="cfgMinSlaPct"
                  type="number"
                  step="0.5"
                  min={50}
                  max={99.9}
                  value={ruleConfig.minServiceLevelPct}
                  onChange={(e) =>
                    onUpdateRuleConfig({
                      minServiceLevelPct: Math.max(50, Number(e.target.value) || 90),
                    })
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white mono-num font-bold"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <label
                  htmlFor="cfgMaxReturnRatePct"
                  className="font-bold text-slate-700 block text-[11px]"
                >
                  Max Reverse-Flow Return Rate (%)
                </label>
                <input
                  id="cfgMaxReturnRatePct"
                  type="number"
                  step="1"
                  min={0}
                  max={100}
                  value={ruleConfig.maxReturnRatePct ?? 15}
                  onChange={(e) =>
                    onUpdateRuleConfig({
                      maxReturnRatePct: Math.max(0, Math.min(100, Number(e.target.value) || 15)),
                    })
                  }
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white mono-num font-bold"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-2">
                <label
                  htmlFor="cfgStockoutMethodApproved"
                  className="font-bold text-slate-700 flex items-center gap-2 text-[11px] cursor-pointer"
                >
                  <input
                    id="cfgStockoutMethodApproved"
                    type="checkbox"
                    checked={ruleConfig.stockoutRunRateMethodApproved === true}
                    onChange={(e) => {
                      setStockoutApprovalDraftError('');
                      if (!e.target.checked) {
                        onUpdateRuleConfig({ stockoutRunRateMethodApproved: false });
                        return;
                      }
                      const approver = stockoutApprovalOwnerDraft.trim();
                      if (!approver) {
                        setStockoutApprovalDraftError('Enter the accountable business owner before approving REC-03.');
                        return;
                      }
                      if (!stockoutApprovalDateDraft) {
                        setStockoutApprovalDraftError('Enter the approval date before approving REC-03.');
                        return;
                      }
                      const approvalAt = new Date(`${stockoutApprovalDateDraft}T12:00:00.000Z`);
                      if (!Number.isFinite(approvalAt.getTime()) || approvalAt.getTime() > Date.now()) {
                        setStockoutApprovalDraftError('Approval date must be valid and cannot be in the future.');
                        return;
                      }
                      onUpdateRuleConfig({
                        stockoutRunRateMethodApproved: true,
                        stockoutRunRateMethodApprovedBy: approver,
                        stockoutRunRateMethodApprovedAt: approvalAt.toISOString(),
                      });
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Approve Stockout Run-Rate Benchmark Formula (REC-03)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="cfgStockoutMethodApprover" className="block text-[10px] font-bold text-slate-600 mb-1">
                      Accountable business owner
                    </label>
                    <input
                      id="cfgStockoutMethodApprover"
                      type="text"
                      value={stockoutApprovalOwnerDraft}
                      onChange={(e) => {
                        setStockoutApprovalOwnerDraft(e.target.value);
                        setStockoutApprovalDraftError('');
                      }}
                      placeholder="Enter owner name / role"
                      maxLength={120}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="cfgStockoutMethodApprovalDate" className="block text-[10px] font-bold text-slate-600 mb-1">
                      Approval date
                    </label>
                    <input
                      id="cfgStockoutMethodApprovalDate"
                      type="date"
                      value={stockoutApprovalDateDraft}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => {
                        setStockoutApprovalDateDraft(e.target.value);
                        setStockoutApprovalDraftError('');
                      }}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-xs"
                    />
                  </div>
                </div>
                {stockoutApprovalDraftError && (
                  <p role="alert" className="text-[10px] font-semibold text-rose-700">
                    {stockoutApprovalDraftError}
                  </p>
                )}
                {ruleConfig.stockoutRunRateMethodApproved === true ? (
                  <p className="text-[10px] text-amber-800">
                    Attestation recorded for {ruleConfig.stockoutRunRateMethodApprovedBy} on {toDateInputValue(ruleConfig.stockoutRunRateMethodApprovedAt)}.
                    This is a client-side named attestation; identity is not authenticated by the current application.
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    Not approved by default. Until a named owner and past approval date are recorded, REC-03 enforces the physical source bound (Uncensored ≥ Billed) and does not penalize source data against the unapproved run-rate estimate.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1D: INDEPENDENT CALCULATION & FORMULA TESTING */}
      {step1Tab === 'calctest' && (
        <div className="space-y-4">
          <div className="card p-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-extrabold uppercase">
                  Argon 2.0 • Phase 1 Gate
                </span>
                <h2 className="text-sm font-extrabold">
                  Independent Calculation Validation &amp; Edge-Case Regression Suite
                </h2>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Enforced as a mandatory Release Gate condition. These independent engine tests run
                separately from uploaded workbook data and do not score forecast performance.
              </p>
            </div>
            <span
              className={`text-xs font-extrabold px-3 py-1.5 rounded-lg border mono-num ${
                passedFormulaCount === formulaTests.length
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                  : 'bg-rose-500/20 text-rose-200 border-rose-400/40'
              }`}
            >
              {passedFormulaCount} / {formulaTests.length} Tests PASSED
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="card p-4 lg:col-span-8 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Automated Formula Verification Report (Expected vs. Real Calculation Engine Output)
              </h3>
              <div className="overflow-x-auto max-h-[460px]">
                <table className="w-full text-xs text-left mono-num">
                  <thead className="bg-slate-100 text-slate-700 border-b sticky top-0">
                    <tr>
                      <th className="py-2 px-2.5">Test ID &amp; Formula</th>
                      <th className="py-2 px-2.5 font-sans">Scenario / Edge Case</th>
                      <th className="py-2 px-2.5">Independent Expected</th>
                      <th className="py-2 px-2.5">Argon Engine Output</th>
                      <th className="py-2 px-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {formulaTests.map((tc) => (
                      <tr key={tc.id} className="hover:bg-slate-50">
                        <td className="py-2 px-2.5 font-bold text-slate-900">
                          {tc.id}
                          <div className="text-[10px] text-indigo-700 font-sans">{tc.name}</div>
                        </td>
                        <td className="py-2 px-2.5 font-sans text-slate-600">{tc.scenario}</td>
                        <td className="py-2 px-2.5 font-bold text-slate-800">{tc.expected}</td>
                        <td className="py-2 px-2.5 font-bold text-emerald-700">{tc.actual}</td>
                        <td className="py-2 px-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                              tc.passed
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {tc.passed ? '✓ PASS' : '✕ FAIL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-4 lg:col-span-4 space-y-3 bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Phase 1 Scope Boundary</h3>
                <p className="text-[11px] text-slate-600 mt-1">
                  Forecast inputs are checked for schema, completeness, data types, dates, keys,
                  and cross-table integrity only. Uploaded forecasts are not scored for accuracy,
                  bias, reasonableness, or model performance, and no demand estimate is generated.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-700">
                The calculation tests shown here are isolated software regression checks. They do
                not run against, alter, or assess the workbook being assured.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1E: ENTERPRISE SCHEMA, LINEAGE & SOURCE VS GOVERNED DATA PREVIEW */}
      {step1Tab === 'schema12' && activeMeta && (
        <div className="space-y-4">
          {/* Schema Drift & Column Mapping Banner (when drift is detected) */}
          {(schemaDrift.missingMandatoryTables.length > 0 ||
            schemaDrift.missingColumns.length > 0 ||
            schemaDrift.suggestedColumnMappings.length > 0) && (
            <div className="card p-3.5 border-amber-300 bg-amber-50/70 space-y-2 text-xs">
              <div className="font-extrabold text-amber-950">
                Schema Drift &amp; Column Mapping Assistant
              </div>
              {schemaDrift.missingMandatoryTables.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-rose-800 font-semibold">
                    Missing Mandatory Table(s): {schemaDrift.missingMandatoryTables.join(', ')}
                  </span>
                  {schemaDrift.missingMandatoryTables.map((mt) => (
                    <button
                      key={mt}
                      type="button"
                      onClick={() => onRemediateStructure(mt)}
                      className="px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700"
                    >
                      + Initialize {mt} (0 Synthetic Rows)
                    </button>
                  ))}
                </div>
              )}
              {schemaDrift.suggestedColumnMappings.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-700 font-semibold">
                    Suggested Column Alias Mappings:
                  </span>
                  {schemaDrift.suggestedColumnMappings.map((m) => (
                    <button
                      key={`${m.table}-${m.sourceColumn}`}
                      type="button"
                      disabled={Boolean(m.collisionWarning)}
                      title={m.collisionWarning || `Confidence: ${m.confidencePct ?? 85}%`}
                      onClick={() =>
                        onApplyColumnMapping(m.table, m.sourceColumn, m.targetCanonicalColumn)
                      }
                      className={`px-2 py-0.5 rounded text-white text-[10px] font-bold ${
                        m.collisionWarning
                          ? 'bg-rose-600 cursor-not-allowed opacity-90'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {m.collisionWarning
                        ? `⚠ Collision: ${m.table}.${m.sourceColumn} → ${m.targetCanonicalColumn}`
                        : `Map ${m.table}.{${m.sourceColumn}} → ${m.targetCanonicalColumn} (${m.confidencePct ?? 85}%)`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="card p-3.5 lg:col-span-4 space-y-2 max-h-[540px] overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  {sheetNames.length} Enterprise DP Tables
                </h2>
                <span className="text-[10px] font-semibold text-blue-600">Select table</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {sheetNames.map((name) => {
                  const meta = activeSheets[name];
                  const isAct = safeActiveSheet === name;
                  const rowCnt = (meta.records || []).filter((r) => !r._removed).length;
                  const tblErrCnt = errors.filter((e) => e.table === name).length;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onSelectSheet(name)}
                      className={`w-full text-left p-2.5 rounded-lg border transition ${
                        isAct
                          ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-sm'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold truncate">{name}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            tblErrCnt > 0
                              ? 'bg-rose-100 text-rose-800 font-bold'
                              : meta.awaitingDataPopulation
                                ? 'bg-amber-100 text-amber-900 font-bold'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {tblErrCnt > 0
                            ? `${tblErrCnt} err`
                            : meta.awaitingDataPopulation
                              ? 'Awaiting Data'
                              : '✓ OK'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                        <span>{meta.pillar}</span>
                        <span className="font-mono">
                          {rowCnt} rows • {meta.cols.length} cols
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card p-4 lg:col-span-8 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    {safeActiveSheet} ({activeRecs.length} Rows • {activeMeta.cols.length} Columns)
                  </h2>
                  <p className="text-[11px] text-slate-500">{activeMeta.desc}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setDataLayerView('governed')}
                      className={`font-semibold px-2 py-1 rounded-md transition ${
                        dataLayerView === 'governed'
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Governed View
                    </button>
                    <button
                      type="button"
                      onClick={() => setDataLayerView('source')}
                      className={`font-semibold px-2 py-1 rounded-md transition ${
                        dataLayerView === 'source'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Original Source (Untouched)
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setHubView('preview')}
                      className={`font-semibold px-2.5 py-1 rounded-md transition ${
                        hubView === 'preview'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Live Data Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setHubView('schema')}
                      className={`font-semibold px-2.5 py-1 rounded-md transition ${
                        hubView === 'schema'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Field Schema &amp; Completeness %
                    </button>
                    <button
                      type="button"
                      onClick={() => setHubView('coverage')}
                      className={`font-semibold px-2.5 py-1 rounded-md transition ${
                        hubView === 'coverage'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Domain Coverage Matrix ({(report.coverageMatrix || []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHubView('lineage')}
                      className={`font-semibold px-2.5 py-1 rounded-md transition ${
                        hubView === 'lineage'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Upload Lineage &amp; SHA-256 ({lineageHistory.length})
                    </button>
                  </div>
                </div>
              </div>

              {hubView === 'preview' ? (
                <div className="overflow-x-auto max-h-[440px]">
                  <table className="w-full text-xs text-left mono-num">
                    <thead className="bg-slate-900 text-white sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">Row #</th>
                        {previewCols.map((c) => (
                          <th key={c} className="py-2 px-2.5 whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeRecs.slice(0, 60).map((rec, rIdx) => {
                        const sourceIdx =
                          typeof rec._sourceIndex === 'number' ? rec._sourceIndex : rIdx;
                        const excelRow = sourceIdx + 2;
                        const rowErr = errors.find(
                          (e) => e.table === safeActiveSheet && e.rowNum === excelRow
                        );
                        const rowClass = rowErr
                          ? rowErr.severity === 'CRITICAL'
                            ? 'bg-rose-50/80'
                            : 'bg-amber-50/80'
                          : 'hover:bg-slate-50';
                        return (
                          <tr key={rIdx} className={rowClass}>
                            <td
                              className={`py-2 px-2.5 font-bold ${
                                rowErr ? 'text-rose-700' : 'text-slate-400'
                              }`}
                            >
                              {excelRow}
                              {rowErr ? ' ⚠' : ''}
                            </td>
                            {previewCols.map((c) => {
                              const val = rec[c];
                              const isNull =
                                val === '' ||
                                val === null ||
                                val === undefined ||
                                String(val).toUpperCase() === 'NULL';
                              const isBadNum = typeof val === 'number' && val < 0;
                              const isUnsafe = typeof val === 'string' && hasUnsafePayload(val);
                              const cellStyle =
                                isNull || isBadNum || isUnsafe
                                  ? 'bg-rose-200/70 text-rose-900 font-extrabold'
                                  : '';
                              return (
                                <td key={c} className={`py-2 px-2.5 whitespace-nowrap ${cellStyle}`}>
                                  {isNull ? 'NULL' : String(val)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : hubView === 'schema' ? (
                <div className="overflow-x-auto max-h-[440px]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">Column Name</th>
                        <th className="py-2 px-2.5">Data Type</th>
                        <th className="py-2 px-2.5">Key</th>
                        <th className="py-2 px-2.5">Measured Completeness %</th>
                        <th className="py-2 px-2.5">Standard Business Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeMeta.cols.map((f) => {
                        const nonNull = activeRecs.filter(
                          (r) =>
                            r[f.col] !== '' &&
                            r[f.col] !== null &&
                            r[f.col] !== undefined &&
                            String(r[f.col]).toUpperCase() !== 'NULL'
                        ).length;
                        const compPct =
                          activeRecs.length > 0
                            ? `${((nonNull / activeRecs.length) * 100).toFixed(1)}%`
                            : 'N/A (0 Rows)';
                        return (
                          <tr key={f.col} className="hover:bg-slate-50">
                            <td className="py-2 px-2.5 font-mono font-bold text-slate-900">
                              {f.col}
                            </td>
                            <td className="py-2 px-2.5 font-mono text-[11px] text-slate-500">
                              {f.type}
                            </td>
                            <td className="py-2 px-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                                {f.key}
                              </span>
                            </td>
                            <td
                              className={`py-2 px-2.5 font-mono font-bold ${
                                compPct === '100.0%' ? 'text-emerald-700' : 'text-rose-600'
                              }`}
                            >
                              {compPct}
                            </td>
                            <td className="py-2 px-2.5 text-slate-700 font-medium">
                              {f.col.replace(/_/g, ' ')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : hubView === 'coverage' ? (
                <div className="overflow-x-auto max-h-[440px]">
                  <table className="w-full text-xs text-left mono-num">
                    <thead className="bg-slate-100 text-slate-700 border-b sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">Table Contract</th>
                        <th className="py-2 px-2.5 font-sans">Domain Role ({domain})</th>
                        <th className="py-2 px-2.5">Execution Status</th>
                        <th className="py-2 px-2.5">Rows</th>
                        <th className="py-2 px-2.5">Checks Run</th>
                        <th className="py-2 px-2.5">Issues</th>
                        <th className="py-2 px-2.5 font-sans">Coverage Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(report.coverageMatrix || []).map((cov) => (
                        <tr key={cov.table} className="hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-bold text-slate-900">{cov.table}</td>
                          <td className="py-2 px-2.5 font-sans">
                            {cov.requiredByDomain ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-indigo-100 text-indigo-800">
                                MANDATORY
                              </span>
                            ) : cov.relevantToDomain ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                                IN-DOMAIN
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">
                                OUT OF DOMAIN
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                cov.status === 'EXECUTED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : cov.status === 'SKIPPED_OUT_OF_DOMAIN'
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {cov.status}
                            </span>
                          </td>
                          <td className="py-2 px-2.5">{cov.rowCount}</td>
                          <td className="py-2 px-2.5">{cov.checksExecuted}</td>
                          <td
                            className={`py-2 px-2.5 font-bold ${
                              cov.issueCount > 0 ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {cov.issueCount}
                          </td>
                          <td className="py-2 px-2.5 font-sans text-slate-600">{cov.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[440px]">
                  <table className="w-full text-xs text-left mono-num">
                    <thead className="bg-slate-100 text-slate-700 border-b sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">Lineage ID</th>
                        <th className="py-2 px-2.5 font-sans">Source File / Snapshot</th>
                        <th className="py-2 px-2.5">SHA-256 Content Fingerprint</th>
                        <th className="py-2 px-2.5">Version &amp; Status</th>
                        <th className="py-2 px-2.5">Sheets / Rows</th>
                        <th className="py-2 px-2.5">Domain / Vertical</th>
                        <th className="py-2 px-2.5">Ingested At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lineageHistory.map((lin) => (
                        <tr key={lin.id} className="hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-bold text-slate-900">{lin.id}</td>
                          <td className="py-2 px-2.5 font-sans font-semibold text-blue-800">
                            {lin.fileName}
                          </td>
                          <td
                            className="py-2 px-2.5 font-mono text-emerald-700 font-bold text-[10px]"
                            title={lin.fileHash}
                          >
                            {lin.fileHash}
                          </td>
                          <td className="py-2 px-2.5">
                            v{lin.sourceVersion ?? 1} •{' '}
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              {lin.uploadStatus ?? 'SUCCESS'}
                            </span>
                          </td>
                          <td className="py-2 px-2.5">
                            {lin.sheetCount} sheets • {lin.totalRows} rows
                          </td>
                          <td className="py-2 px-2.5 uppercase">
                            {lin.domain} / {lin.industry}
                          </td>
                          <td className="py-2 px-2.5 text-slate-500">{lin.uploadedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
