import React, { useMemo, useState } from 'react';
import { evaluateDemandMetrics } from '../engine/calculations';
import { runIndependentFormulaTests } from '../engine/formulaTests';
import { hasUnsafePayload } from '../engine/security';
import {
  EnterpriseSheets,
  ReleaseGateState,
  Step1Tab,
  ValidationException,
  WarningSignOff,
} from '../engine/types';

interface Step1DataAssuranceProps {
  sheets: EnterpriseSheets;
  errors: ValidationException[];
  gate: ReleaseGateState;
  warningSignOff: WarningSignOff | null;
  workbookSource: string;
  activeSheet: string;
  onSelectSheet: (name: string) => void;
  onFixRow: (err: ValidationException) => void;
  onAutoHealCritical: () => void;
  onResolveWarnings: () => void;
  onReloadSeeded: () => void;
  onProceedStep2: () => void;
  onOpenWarningSignOff: () => void;
  onFormulaVerifiedAudit: () => void;
}

export const Step1DataAssurance: React.FC<Step1DataAssuranceProps> = ({
  sheets,
  errors,
  gate,
  warningSignOff,
  workbookSource,
  activeSheet,
  onSelectSheet,
  onFixRow,
  onAutoHealCritical,
  onResolveWarnings,
  onReloadSeeded,
  onProceedStep2,
  onOpenWarningSignOff,
  onFormulaVerifiedAudit,
}) => {
  const [step1Tab, setStep1Tab] = useState<Step1Tab>('errors');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [hubView, setHubView] = useState<'preview' | 'schema'>('preview');

  // Sandbox inputs
  const [sbActual, setSbActual] = useState<number>(5435);
  const [sbForecast, setSbForecast] = useState<number>(2363);
  const [sbStockoutDays, setSbStockoutDays] = useState<number>(0);
  const [sbStdDev, setSbStdDev] = useState<number>(464.49);

  const formulaTests = useMemo(() => runIndependentFormulaTests(), []);
  const passedFormulaCount = formulaTests.filter((t) => t.passed).length;

  const sandboxEval = useMemo(
    () => evaluateDemandMetrics(sbActual, sbForecast, sbStockoutDays, sbStdDev),
    [sbActual, sbForecast, sbStockoutDays, sbStdDev]
  );

  const sheetNames = Object.keys(sheets);
  const totalRows = useMemo(
    () => sheetNames.reduce((sum, n) => sum + (sheets[n]?.records?.length || 0), 0),
    [sheets, sheetNames]
  );

  const healthPct =
    totalRows > 0
      ? Math.max(0, Math.min(100, ((totalRows - errors.length * 0.55) / totalRows) * 100)).toFixed(1)
      : '100.0';

  const timeIssues = errors.filter((e) => e.category === 'TIME_CONTINUITY' || e.category === 'DUPLICATE_KEY').length;
  const stockoutIssues = errors.filter((e) => e.category === 'STOCKOUT').length;
  const joinIssues = errors.filter((e) => e.category === 'CROSS_TABLE').length;
  const promoPriceIssues = errors.filter((e) => e.category === 'PROMO_PRICE').length;
  const uomSecIssues = errors.filter(
    (e) => e.category === 'UOM_CURRENCY' || e.category === 'SECURITY'
  ).length;

  const filteredErrors = errors.filter((e) =>
    severityFilter === 'ALL' ? true : e.severity === severityFilter
  );

  const safeActiveSheet = sheets[activeSheet] ? activeSheet : sheetNames[0];
  const activeMeta = sheets[safeActiveSheet];
  const activeRecs = activeMeta?.records || [];

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

  return (
    <section className="space-y-5" aria-label="Step 1 Data Assurance Hub">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-extrabold uppercase">
              Step 1 Foundation
            </span>
            <h1 className="text-lg font-extrabold text-slate-900">
              Intelligent Data Quality &amp; Validation Engine
            </h1>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Active Source: {workbookSource} — Scanning 100% of actual in-memory records across{' '}
            {sheetNames.length} table(s) before unlocking forecasting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReloadSeeded}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition"
          >
            ↺ Reload Seeded Anomalies
          </button>
          {gate.criticalCount > 0 && (
            <button
              type="button"
              onClick={onAutoHealCritical}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-sm transition"
            >
              Auto-Heal All Critical Anomalies ({gate.criticalCount})
            </button>
          )}
          {gate.criticalCount === 0 && gate.warningCount > 0 && (
            <button
              type="button"
              onClick={onResolveWarnings}
              className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-3.5 py-2 rounded-lg shadow-sm transition"
            >
              Resolve Remaining Warnings ({gate.warningCount})
            </button>
          )}
          <button
            type="button"
            onClick={onProceedStep2}
            className={`text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition ${
              gate.step2Unlocked
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-rose-700 hover:bg-rose-800'
            }`}
          >
            {gate.step2Unlocked
              ? '✓ Proceed to Step 2: Demand Core →'
              : `🔒 Gate Locked — Fix ${gate.criticalCount} Critical Blocker(s)`}
          </button>
        </div>
      </div>

      {/* 6-Gatekeeper Readiness Scorecard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            1. Overall Data Health
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              errors.length === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {healthPct}%
          </div>
          <div className="text-[10px] text-slate-500">
            {totalRows} Live Rows • {errors.length} Open
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            2. Time &amp; Key Integrity
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              timeIssues === 0 ? 'text-emerald-700' : 'text-rose-600'
            }`}
          >
            {timeIssues === 0 ? '0 Gaps' : `${timeIssues} Issues`}
          </div>
          <div className="text-[10px] text-slate-500">Period Continuity &amp; Keys</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            3. Unlogged Stockouts
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              stockoutIssues === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {stockoutIssues === 0 ? '0 Unflagged' : `${stockoutIssues} Warnings`}
          </div>
          <div className="text-[10px] text-slate-500">Zero Stock + Days Out</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            4. Cross-Table Joins
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              joinIssues === 0 ? 'text-emerald-700' : 'text-rose-600'
            }`}
          >
            {joinIssues === 0 ? '100% Linked' : `${joinIssues} Orphans`}
          </div>
          <div className="text-[10px] text-slate-500">SKU / Depot / Channel / NPI</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            5. Promo &amp; Price Bounds
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              promoPriceIssues === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {promoPriceIssues === 0 ? 'Verified' : `${promoPriceIssues} Alerts`}
          </div>
          <div className="text-[10px] text-slate-500">Dates, Margins &amp; Caps</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            6. UOM &amp; Security Sync
          </div>
          <div
            className={`text-lg font-extrabold mt-0.5 mono-num ${
              uomSecIssues === 0 ? 'text-emerald-700' : 'text-rose-600'
            }`}
          >
            {uomSecIssues === 0 ? '100% Synced' : `${uomSecIssues} Mismatches`}
          </div>
          <div className="text-[10px] text-slate-500">UOM, Returns &amp; Sanitization</div>
        </div>
      </div>

      {/* STRICT HARD FORECASTING GATEKEEPER BANNER */}
      <div
        data-testid="release-gate-banner"
        data-gate-status={gate.status}
        className={`card p-4 border-2 text-white space-y-3 ${
          gate.step2Unlocked
            ? 'border-emerald-500 bg-slate-900'
            : 'border-rose-500 bg-rose-950'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-extrabold text-lg shrink-0 ${
                gate.step2Unlocked ? 'bg-emerald-600' : 'bg-rose-600'
              }`}
            >
              {gate.step2Unlocked ? '🔓' : '🔒'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                    gate.step2Unlocked
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {gate.step2Unlocked ? 'Validation Gate Passed ✓' : 'Forecasting Gate Blocked'}
                </span>
                <h2 className="text-sm font-extrabold text-white">
                  {gate.step2Unlocked
                    ? '0 Critical Blockers — Step 2 Demand Core Unlocked'
                    : `${gate.criticalCount} Critical Row-Level Blockers Preventing Step 2 Execution`}
                </h2>
              </div>
              <p className="text-xs text-slate-200 mt-0.5">
                {gate.step2Unlocked
                  ? gate.warningCount > 0
                    ? warningSignOff
                      ? `All critical blockers resolved. ${gate.warningCount} non-blocking warning(s) acknowledged by ${warningSignOff.approver} (${warningSignOff.expiry}).`
                      : `All critical blockers are resolved (${gate.warningCount} non-blocking warnings remain disclosed below). Ready for Step 2 forecasting.`
                    : '100% of records across all tables passed validation cleanly.'
                  : 'Strict Release Gate active: Unresolved critical exceptions (duplicates, missing periods, negative actuals, UOM mismatches, orphan mappings, or unsafe cells) cannot be bypassed by manager override. Resolve all critical blockers in 1A before forecasting.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {gate.step2Unlocked && gate.warningCount > 0 && !warningSignOff && (
              <button
                type="button"
                onClick={onOpenWarningSignOff}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-lg transition"
              >
                Log Warning Sign-Off
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
              ✓ Verify {passedFormulaCount}/{formulaTests.length} Formula Tests
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-white/15 text-[11px] gap-2">
          <span className="font-bold text-amber-300">
            {errors.length} Live Exceptions Found Across {totalRows} Records ({workbookSource})
          </span>
          <span className="font-mono font-bold text-rose-200">
            {gate.criticalCount} Critical Blockers • {gate.warningCount} Warnings
          </span>
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
            1A. Row-Level Data Error Inspector ({errors.length})
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
            1C. Enterprise Schema &amp; Live Data Preview ({sheetNames.length} Tables)
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
              <option value="CRITICAL">Critical Blockers Only (Locks Gate)</option>
              <option value="WARNING">Warnings Only (Non-Blocking)</option>
            </select>
          </div>
        )}
      </div>

      {/* 1A: ROW-LEVEL DATA ERROR INSPECTOR */}
      {step1Tab === 'errors' && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                1A. Row-Level Data Quality &amp; Exception Workbench
              </h2>
              <p className="text-xs text-slate-500">
                Every exception below is dynamically computed from actual in-memory records,
                checking business-key duplicates, monthly/weekly period continuity, cross-table
                foreign keys, UOM sync, and XSS cell payloads.
              </p>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-700 mono-num">
              1:1 Record Reconciliation Active
            </span>
          </div>

          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-[11px] text-left mono-num table-auto">
              <thead className="bg-slate-900 text-white sticky top-0">
                <tr>
                  <th className="py-2 px-2">ID</th>
                  <th className="py-2 px-2 font-sans">Severity</th>
                  <th className="py-2 px-2">Table &amp; Row</th>
                  <th className="py-2 px-2">SKU / Intersection</th>
                  <th className="py-2 px-2 font-sans">Issue Description</th>
                  <th className="py-2 px-2">Current Bad Value</th>
                  <th className="py-2 px-2">Proposed Fix</th>
                  <th className="py-2 px-2 text-right font-sans">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredErrors.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-6 text-center text-emerald-700 font-bold font-sans"
                    >
                      ✓ Zero exceptions match the current filter. Underlying records are clean!
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
                      <td className="py-2 px-2 font-bold text-slate-900 whitespace-nowrap">{err.id}</td>
                      <td className="py-2 px-2 font-sans whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                            err.severity === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {err.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING'}
                        </span>
                      </td>
                      <td className="py-2 px-2 max-w-[170px] break-words">
                        <div className="font-bold text-blue-800">{err.table}</div>
                        <div className="text-[10px] text-slate-500">
                          {err.rowNum > 0 ? `Row #${err.rowNum}` : 'Series Gap'}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-slate-800 font-semibold max-w-[170px] break-words">
                        {err.intersection}
                      </td>
                      <td className="py-2 px-2 font-sans text-slate-700 max-w-[230px] break-words">{err.issue}</td>
                      <td className="py-2 px-2 text-rose-700 font-bold max-w-[130px] break-words">{err.badVal}</td>
                      <td className="py-2 px-2 text-emerald-800 font-bold max-w-[160px] break-words">
                        {err.fixValText}
                      </td>
                      <td className="py-2 px-2 text-right font-sans whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onFixRow(err)}
                          aria-label={`Fix ${err.id} in ${err.table}`}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition whitespace-nowrap"
                        >
                          ✓ Fix Record
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1B: INDEPENDENT CALCULATION & FORMULA TESTING */}
      {step1Tab === 'calctest' && (
        <div className="space-y-4">
          <div className="card p-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-extrabold uppercase">
                  Argon 2.0 • Phase 1
                </span>
                <h2 className="text-sm font-extrabold">
                  Independent Calculation Validation &amp; Edge-Case Regression Suite
                </h2>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Exercises the real calculation engine across 12 independent formulas including
                strict N/A zero-sales accuracy (even when Actual = 0 and Forecast = 0), negative
                return clamping, LOO sigma clipping, L0 trend, promo decomposition, cannibalization,
                bullwhip, MEIO, and W1–W3 order netting.
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
              <div className="overflow-x-auto max-h-[440px]">
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
                  Test zero-sales (0/0 → N/A), negative credit returns, stockout restoration, and
                  sigma spike clipping live.
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
                    value={sbActual}
                    onChange={(e) => setSbActual(Number(e.target.value))}
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
                    value={sbForecast}
                    onChange={(e) => setSbForecast(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
                <div>
                  <label htmlFor="sbStockoutInput" className="font-semibold text-slate-700 block mb-1">
                    Stockout Days (0–29)
                  </label>
                  <input
                    id="sbStockoutInput"
                    type="number"
                    min={0}
                    max={29}
                    value={sbStockoutDays}
                    onChange={(e) => setSbStockoutDays(Number(e.target.value))}
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
                    value={sbStdDev}
                    onChange={(e) => setSbStdDev(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white mono-num font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSbActual(5435);
                    setSbForecast(2363);
                    setSbStockoutDays(0);
                    setSbStdDev(464.49);
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200"
                >
                  Preset: P401 Spike
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSbActual(0);
                    setSbForecast(0);
                    setSbStockoutDays(0);
                    setSbStdDev(150);
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300"
                >
                  Preset: Zero Sales (0/0)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSbActual(-410);
                    setSbForecast(1740);
                    setSbStockoutDays(4);
                    setSbStdDev(210);
                  }}
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-rose-100 text-rose-800 hover:bg-rose-200"
                >
                  Preset: Negative Return
                </button>
              </div>

              <div
                data-testid="sandbox-results"
                className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5 text-xs mono-num"
              >
                <div className="flex justify-between">
                  <span>1. Negative Guard:</span>
                  <strong
                    className={
                      sandboxEval.wasNegativeClamped ? 'text-rose-600' : 'text-emerald-700'
                    }
                  >
                    {sandboxEval.wasNegativeClamped
                      ? `Clamped ${sandboxEval.rawActual} → 0 u (${sandboxEval.returnQty} u Return)`
                      : 'Valid (≥ 0)'}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>2. Uncensored Demand:</span>
                  <strong className="text-blue-700">
                    {sandboxEval.uncensoredDemand.toLocaleString()} u (+
                    {sandboxEval.stockoutRecoveredUnits.toLocaleString()} stockout)
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>3. Signed Unit Error:</span>
                  <strong
                    className={sandboxEval.unitError < 0 ? 'text-rose-600' : 'text-amber-700'}
                  >
                    {sandboxEval.unitError >= 0 ? '+' : ''}
                    {sandboxEval.unitError.toLocaleString()} u
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>4. WMAPE Accuracy:</span>
                  <strong
                    data-testid="sandbox-accuracy"
                    className={
                      sandboxEval.accuracyPct === null ? 'text-slate-700' : 'text-emerald-700'
                    }
                  >
                    {sandboxEval.accuracyLabel}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>5. Outlier Sigma (σ):</span>
                  <strong
                    className={sandboxEval.isOutlier ? 'text-rose-600' : 'text-slate-800'}
                  >
                    {sandboxEval.zScore.toFixed(2)}σ{' '}
                    {sandboxEval.isOutlier ? '(Outlier Flagged)' : '(Normal)'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1C: ENTERPRISE SCHEMA & LIVE DATA PREVIEW */}
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
                const meta = sheets[name];
                const isAct = safeActiveSheet === name;
                const rowCnt = meta.records ? meta.records.length : 0;
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
                  {safeActiveSheet} ({activeRecs.length} Actual Rows • {activeMeta.cols.length}{' '}
                  Columns)
                </h2>
                <p className="text-[11px] text-slate-500">{activeMeta.desc}</p>
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
                  Live Data Preview (Highlighted)
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
                      const excelRow = rIdx + 2;
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
                          : '100.0%';
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
