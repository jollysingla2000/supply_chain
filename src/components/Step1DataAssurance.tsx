import React, { useMemo, useState } from 'react';
import { evaluateDemandMetrics } from '../engine/calculations';
import { hasUnsafePayload } from '../engine/security';
import {
  ApprovedCorrection,
  EnterpriseSheets,
  FormulaTestCase,
  ReleaseGateState,
  Step1Tab,
  ValidationException,
  ValidationExecutionStatus,
  ValidationReport,
  WarningSignOff,
} from '../engine/types';

interface Step1DataAssuranceProps {
  sourceSheets: EnterpriseSheets;
  governedSheets: EnterpriseSheets;
  report: ValidationReport;
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

export const Step1DataAssurance: React.FC<Step1DataAssuranceProps> = ({
  sourceSheets,
  governedSheets,
  report,
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
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [hubView, setHubView] = useState<'preview' | 'schema'>('preview');
  const [dataLayerView, setDataLayerView] = useState<'governed' | 'source'>('governed');

  // Sandbox inputs (kept as strings to gracefully reject invalid/NaN numeric entries)
  const [sbActualStr, setSbActualStr] = useState<string>('5435');
  const [sbForecastStr, setSbForecastStr] = useState<string>('2363');
  const [sbStockoutStr, setSbStockoutStr] = useState<string>('0');
  const [sbStdDevStr, setSbStdDevStr] = useState<string>('464.49');

  const passedFormulaCount = formulaTests.filter((t) => t.passed).length;

  const sandboxResult = useMemo(() => {
    const act = sbActualStr.trim() === '' ? Number.NaN : Number(sbActualStr);
    const fcst = sbForecastStr.trim() === '' ? Number.NaN : Number(sbForecastStr);
    const stk = sbStockoutStr.trim() === '' ? Number.NaN : Number(sbStockoutStr);
    const std = sbStdDevStr.trim() === '' ? Number.NaN : Number(sbStdDevStr);
    try {
      return { ok: true as const, data: evaluateDemandMetrics(act, fcst, stk, std) };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Invalid numeric input',
      };
    }
  }, [sbActualStr, sbForecastStr, sbStockoutStr, sbStdDevStr]);

  const activeSheets = dataLayerView === 'governed' ? governedSheets : sourceSheets;
  const sheetNames = Object.keys(activeSheets);
  const errors = report.exceptions;
  const filteredErrors = errors.filter((e) =>
    severityFilter === 'ALL' ? true : e.severity === severityFilter
  );

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

  const bannerColors = gate.step2Unlocked
    ? 'border-emerald-500 bg-slate-900'
    : gate.status === 'AWAITING_WARNING_SIGNOFF'
      ? 'border-amber-500 bg-amber-950'
      : 'border-rose-500 bg-rose-950';

  return (
    <section className="space-y-5" aria-label="Step 1 Data Assurance Hub">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
              Step 1 Foundation
            </span>
            <h1 className="text-lg font-extrabold text-slate-900">
              Intelligent Data Quality &amp; Validation Engine
            </h1>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Source: {workbookSource} (Original records preserved untouched) •{' '}
            {report.health.cleanRows}/{report.health.totalRows} Clean Rows (
            {report.health.rowPassRatePct !== null
              ? `${report.health.rowPassRatePct}%`
              : 'N/A'}
            ) • {report.health.executedCategories}/{report.health.totalCategories} Validation
            Pillars Executed
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
                  : 'Business-judgement corrections require explicit human review and approval in 1A. Missing tables/columns or unexecuted checks strictly lock forecasting.'}
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
            className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition ${
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
            aria-selected={step1Tab === 'calctest'}
            onClick={() => setStep1Tab('calctest')}
            className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition ${
              step1Tab === 'calctest'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1B. Independent Calculation &amp; Formula Testing ({formulaTests.length} Checks)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step1Tab === 'schema12'}
            onClick={() => setStep1Tab('schema12')}
            className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition ${
              step1Tab === 'schema12'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-700 hover:bg-white/60'
            }`}
          >
            1C. Enterprise Schema &amp; Source/Governed Preview ({sheetNames.length} Tables)
          </button>
        </div>

        {step1Tab === 'errors' && (
          <div className="flex items-center gap-2 pr-2 text-xs">
            <label htmlFor="errorSeverityFilter" className="text-[11px] font-semibold text-slate-600">
              Severity Filter:
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
              <span className="text-[11px] font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-700 mono-num">
                {approvedCorrections.length} Governed Correction(s) Applied
              </span>
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
                    <th className="py-2 px-2 font-sans">Governance Action</th>
                    <th className="py-2 px-2 text-right font-sans">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredErrors.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-6 text-center text-emerald-700 font-bold font-sans"
                      >
                        ✓ Zero exceptions match the current filter. Governed working dataset is
                        clean!
                      </td>
                    </tr>
                  ) : (
                    filteredErrors.map((err) => (
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
                        <td className="py-2 px-2 max-w-[165px] break-words">
                          <div className="font-bold text-blue-800">{err.table}</div>
                          <div className="text-[10px] text-slate-500">
                            {err.rowNum > 0 ? `Row #${err.rowNum}` : 'Series / Schema'}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-slate-800 font-semibold max-w-[165px] break-words">
                          {err.intersection}
                        </td>
                        <td className="py-2 px-2 font-sans text-slate-700 max-w-[230px] break-words">
                          {err.issue}
                        </td>
                        <td className="py-2 px-2 text-rose-700 font-bold max-w-[125px] break-words">
                          {err.badVal}
                        </td>
                        <td className="py-2 px-2 font-sans text-slate-700 max-w-[175px] break-words">
                          {err.suggestedValText}
                        </td>
                        <td className="py-2 px-2 text-right font-sans whitespace-nowrap">
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Approved Corrections Ledger (Before / After + Revert) */}
          {approvedCorrections.length > 0 && (
            <div className="card p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                Approved Corrections Ledger (Non-Destructive Overlay — Source Kept Untouched)
              </h3>
              <div className="overflow-x-auto max-h-[240px]">
                <table className="w-full text-[11px] text-left mono-num">
                  <thead className="bg-slate-100 text-slate-700 border-b">
                    <tr>
                      <th className="py-1.5 px-2">Table</th>
                      <th className="py-1.5 px-2">Before (Source)</th>
                      <th className="py-1.5 px-2">After (Approved)</th>
                      <th className="py-1.5 px-2 font-sans">Approver &amp; Justification</th>
                      <th className="py-1.5 px-2 text-right font-sans">Revert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {approvedCorrections.map((c) => (
                      <tr key={c.id}>
                        <td className="py-1.5 px-2 font-bold text-blue-800">{c.table}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1B: INDEPENDENT CALCULATION & FORMULA TESTING */}
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
                Enforced as a mandatory Release Gate condition. Covers zero-sales N/A accuracy
                (0/0 and 0/100), mismatched series errors, NaN rejection, zero-variance outlier
                detection, zero-forecast bias, and negative weekly order rejection.
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
                <h3 className="text-sm font-bold text-slate-900">
                  Interactive Formula Verifier Sandbox
                </h3>
                <p className="text-[11px] text-slate-500">
                  Test zero-sales (0/0 → N/A), zero-actual (0/100 → N/A), negative credit returns,
                  and constant-baseline (σ = 0) outlier detection.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label htmlFor="sbActualInput" className="font-semibold text-slate-700 block mb-1">
                    Billed Actual (Units)
                  </label>
                  <input
                    id="sbActualInput"
                    type="number"
                    value={sbActualStr}
                    onChange={(e) => setSbActualStr(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
                <div>
                  <label htmlFor="sbFcstInput" className="font-semibold text-slate-700 block mb-1">
                    System Forecast (Units)
                  </label>
                  <input
                    id="sbFcstInput"
                    type="number"
                    value={sbForecastStr}
                    onChange={(e) => setSbForecastStr(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sbStockoutInput"
                    className="font-semibold text-slate-700 block mb-1"
                  >
                    Stockout Days (0–29)
                  </label>
                  <input
                    id="sbStockoutInput"
                    type="number"
                    min={0}
                    max={29}
                    value={sbStockoutStr}
                    onChange={(e) => setSbStockoutStr(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
                <div>
                  <label htmlFor="sbStdInput" className="font-semibold text-slate-700 block mb-1">
                    Baseline Std Dev (σ)
                  </label>
                  <input
                    id="sbStdInput"
                    type="number"
                    step="0.01"
                    value={sbStdDevStr}
                    onChange={(e) => setSbStdDevStr(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSbActualStr('5435');
                    setSbForecastStr('2363');
                    setSbStockoutStr('0');
                    setSbStdDevStr('464.49');
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200"
                >
                  Preset: P401 Spike
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSbActualStr('0');
                    setSbForecastStr('0');
                    setSbStockoutStr('0');
                    setSbStdDevStr('150');
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300"
                >
                  Preset: Zero Sales (0/0)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSbActualStr('-410');
                    setSbForecastStr('1740');
                    setSbStockoutStr('4');
                    setSbStdDevStr('210');
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-rose-100 text-rose-800 hover:bg-rose-200"
                >
                  Preset: Negative Return
                </button>
              </div>

              {sandboxResult.ok ? (
                <div
                  data-testid="sandbox-results"
                  className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5 text-xs mono-num"
                >
                  <div className="flex justify-between">
                    <span>1. Negative Guard:</span>
                    <strong
                      className={
                        sandboxResult.data.wasNegativeClamped
                          ? 'text-rose-600'
                          : 'text-emerald-700'
                      }
                    >
                      {sandboxResult.data.wasNegativeClamped
                        ? `Clamped ${sandboxResult.data.rawActual} → 0 u (${sandboxResult.data.returnQty} u Return)`
                        : 'Valid (≥ 0)'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>2. Uncensored Demand:</span>
                    <strong className="text-blue-700">
                      {sandboxResult.data.uncensoredDemand.toLocaleString()} u (+
                      {sandboxResult.data.stockoutRecoveredUnits.toLocaleString()} stockout)
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>3. Signed Unit Error:</span>
                    <strong
                      className={
                        sandboxResult.data.unitError < 0 ? 'text-rose-600' : 'text-amber-700'
                      }
                    >
                      {sandboxResult.data.unitError >= 0 ? '+' : ''}
                      {sandboxResult.data.unitError.toLocaleString()} u
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>4. WMAPE Accuracy:</span>
                    <strong
                      data-testid="sandbox-accuracy"
                      className={
                        sandboxResult.data.accuracyPct === null
                          ? 'text-slate-700'
                          : 'text-emerald-700'
                      }
                    >
                      {sandboxResult.data.accuracyLabel}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>5. Outlier Sigma (σ):</span>
                    <strong
                      className={
                        sandboxResult.data.isOutlier ? 'text-rose-600' : 'text-slate-800'
                      }
                    >
                      {sandboxResult.data.zScore === null
                        ? 'Inf (Zero-Variance)'
                        : `${sandboxResult.data.zScore.toFixed(2)}σ`}{' '}
                      {sandboxResult.data.isOutlier ? '(Outlier Flagged)' : '(Normal)'}
                    </strong>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-semibold">
                  {sandboxResult.error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 1C: ENTERPRISE SCHEMA & SOURCE VS GOVERNED DATA PREVIEW */}
      {step1Tab === 'schema12' && activeMeta && (
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
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {tblErrCnt > 0 ? `${tblErrCnt} err` : '✓ OK'}
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
            ) : (
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
            )}
          </div>
        </div>
      )}
    </section>
  );
};
