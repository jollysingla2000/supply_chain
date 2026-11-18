import React, { useMemo } from 'react';
import { calcWeeklyOrderConsumption } from '../engine/calculations';
import { AuditEntry, ModuleId } from '../engine/types';

interface OtherModulesProps {
  activeModule: Exclude<ModuleId, 'm01'>;
  onBackToStep1: () => void;
  auditLogs: AuditEntry[];
}

export const OtherModules: React.FC<OtherModulesProps> = ({
  activeModule,
  onBackToStep1,
  auditLogs,
}) => {
  const netting = useMemo(
    () =>
      calcWeeklyOrderConsumption([
        { week: 'Week 1 (Frozen)', forecast: 800, orders: 920 },
        { week: 'Week 2 (Slushy)', forecast: 850, orders: 610 },
        { week: 'Week 3 (Slushy)', forecast: 900, orders: 340 },
      ]),
    []
  );

  if (activeModule === 'm02') {
    return (
      <section className="space-y-4" aria-label="Step 2 Demand Core">
        <div className="card p-4 bg-gradient-to-r from-blue-950 to-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold uppercase">
              Step 2 Unlocked
            </span>
            <h1 className="text-base font-extrabold mt-1">
              Demand Core (7 Planning Engines) &amp; Root Cause Workbench
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Covers Segmentation, Outlier &amp; Stockout Correction, Statistical Forecasting, CML/ML
              Causal Drivers, NPI, Cannibalization, and Bullwhip Effect.
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToStep1}
            className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/20"
          >
            ← Back to Step 1 Data Assurance
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="card p-4 space-y-2">
            <div className="font-extrabold text-slate-900">
              1. Outlier Spike &amp; Stockout Restoration
            </div>
            <p className="text-slate-600">
              Anchor SKU <strong>P401 / Kolkata / GT</strong>: Sep 2025 spike (5,435 u vs 2,363 u
              normal base) capped, recovering 1,571 u of Q4 overhang and cutting -3,840 u of
              phantom Q1 2026 forecast.
            </p>
            <div className="p-2 rounded bg-emerald-50 text-emerald-900 font-bold mono-num">
              Clean Accuracy: 92.9% → 96.8% (+3.9 pp)
            </div>
          </div>
          <div className="card p-4 space-y-2">
            <div className="font-extrabold text-slate-900">
              2. NPI &amp; Cross-SKU Cannibalization
            </div>
            <p className="text-slate-600">
              <strong>SKU_CARE_04_NEW</strong> modeled via Look-Alike Analog{' '}
              <strong>SKU_CARE_04</strong> (125% scale) + 1,800 u trade pipeline fill, deducting
              -12% (-583 u) cannibalization from sister SKU.
            </p>
            <div className="p-2 rounded bg-blue-50 text-blue-900 font-bold mono-num">
              Net Portfolio Gain: +1,915 u in Q1
            </div>
          </div>
          <div className="card p-4 space-y-2">
            <div className="font-extrabold text-slate-900">
              3. Bullwhip &amp; Channel Stuffing Filter
            </div>
            <p className="text-slate-600">
              End-consumer POS volatility is ±8.4%, while Distributor Primary Billing swings ±44.6%
              (5.3x Bullwhip). Anchoring baseline to sell-out eliminates factory overtime.
            </p>
            <div className="p-2 rounded bg-indigo-50 text-indigo-900 font-bold mono-num">
              Factory Overtime Saved: ₹4.85 Lakhs / Qtr
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (activeModule === 'm03') {
    return (
      <section className="space-y-4" aria-label="Step 3 Control Tower">
        <div className="card p-4">
          <h1 className="text-lg font-extrabold text-slate-900">
            Step 3: Control Tower &amp; 9-Box ABC × XYZ Portfolio Health
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Executive &amp; Planner visibility into high-value volatile SKUs (AZ/BZ), depot service
            risks, and working capital savings.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="card p-4 border-l-4 border-rose-500">
            <div className="text-slate-500 font-bold uppercase text-[10px]">
              AZ Box (High Rev • Spiky)
            </div>
            <div className="text-lg font-extrabold text-slate-900 mt-1">6 Intersections</div>
            <p className="text-slate-600 mt-1">
              Requires monthly S&amp;OP review &amp; outlier spike guardrails.
            </p>
          </div>
          <div className="card p-4 border-l-4 border-emerald-500">
            <div className="text-slate-500 font-bold uppercase text-[10px]">
              AX Box (High Rev • Steady)
            </div>
            <div className="text-lg font-extrabold text-slate-900 mt-1">14 Intersections</div>
            <p className="text-slate-600 mt-1">
              98.4% OTIF • Running on touchless statistical autopilot.
            </p>
          </div>
          <div className="card p-4 border-l-4 border-amber-500">
            <div className="text-slate-500 font-bold uppercase text-[10px]">
              Working Capital Protected
            </div>
            <div className="text-lg font-extrabold text-emerald-700 mt-1 mono-num">
              ₹18.4 Lakhs
            </div>
            <p className="text-slate-600 mt-1">
              Freed by trimming phantom Q1 over-forecasts &amp; safety stock.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (activeModule === 'm04') {
    return (
      <section className="space-y-4" aria-label="Step 4 S&OP and Supply Netting">
        <div className="card p-4">
          <h1 className="text-lg font-extrabold text-slate-900">
            Step 4: S&amp;OP Consensus, MEIO Buffers &amp; W1–W3 Order Consumption Netting
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Confirmed customer orders consume current bucket forecast first, then forward-consume
            to generate feasible net supply requirements (Total RTF: {netting.totalRtf.toLocaleString()} u).
          </p>
        </div>
        <div className="card p-4 overflow-x-auto">
          <table className="w-full text-xs text-left mono-num">
            <thead className="bg-slate-100 text-slate-700 border-b">
              <tr>
                <th className="py-2 px-3">Bucket</th>
                <th className="py-2 px-3">Approved Forecast</th>
                <th className="py-2 px-3">Confirmed Orders</th>
                <th className="py-2 px-3">Consumed Forecast</th>
                <th className="py-2 px-3">Remaining Forecast</th>
                <th className="py-2 px-3">Net Supply Requirement (RTF)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {netting.rows.map((r) => (
                <tr key={r.week}>
                  <td className="py-2 px-3 font-bold">{r.week}</td>
                  <td className="py-2 px-3">{r.forecast} u</td>
                  <td className="py-2 px-3 font-bold text-blue-700">{r.orders} u</td>
                  <td className="py-2 px-3">
                    {r.consumedForecast} u
                    {r.spilloverOut > 0 ? ` (+${r.spilloverOut}→Next)` : ''}
                  </td>
                  <td
                    className={`py-2 px-3 font-bold ${
                      r.remainingForecast === 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {r.remainingForecast} u
                  </td>
                  <td className="py-2 px-3 font-extrabold">{r.netSupplyRequirement} u</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (activeModule === 'm05') {
    return (
      <section className="space-y-4" aria-label="Step 5 Planning Rules">
        <div className="card p-4">
          <h1 className="text-lg font-extrabold text-slate-900">
            Step 5: Planning Rules, Guardrails &amp; Service Policy Setup
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Configure spike capping thresholds, stockout recovery windows, and Tier A/B/C service
            fill rate targets.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="card p-4 space-y-1">
            <div className="font-bold text-slate-900">Outlier Sigma Guardrail</div>
            <div className="text-base font-extrabold text-blue-700 mono-num">3.0σ LOO Cap</div>
            <p className="text-slate-500">Auto-tags bulk spikes above 3.0σ Leave-One-Out residual.</p>
          </div>
          <div className="card p-4 space-y-1">
            <div className="font-bold text-slate-900">Zero-Sales Accuracy Rule</div>
            <div className="text-base font-extrabold text-emerald-700 mono-num">
              Actual = 0 → N/A
            </div>
            <p className="text-slate-500">
              Percentage accuracy is always N/A when Actual = 0 (even when Forecast = 0).
            </p>
          </div>
          <div className="card p-4 space-y-1">
            <div className="font-bold text-slate-900">Release Gate Policy</div>
            <div className="text-base font-extrabold text-rose-700 mono-num">
              Strict 0 Critical Blockers
            </div>
            <p className="text-slate-500">
              Unresolved critical exceptions cannot be bypassed by manager override.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="Step 6 Audit Trail">
      <div className="card p-4">
        <h1 className="text-lg font-extrabold text-slate-900">
          Step 6: Value Measurement KPIs &amp; Complete Governance Audit Trail
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Timestamped record of every data remediation, formula verification run, and warning
          sign-off.
        </p>
      </div>
      <div className="card p-4 overflow-x-auto">
        <table className="w-full text-xs text-left mono-num">
          <thead className="bg-slate-100 text-slate-600 border-b">
            <tr>
              <th className="py-2 px-3">Timestamp</th>
              <th className="py-2 px-3">Governance Action</th>
              <th className="py-2 px-3">Target Scope</th>
              <th className="py-2 px-3">Before</th>
              <th className="py-2 px-3">After</th>
              <th className="py-2 px-3">User / Approver</th>
              <th className="py-2 px-3">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {auditLogs.map((a, idx) => (
              <tr key={idx}>
                <td className="py-2 px-3 text-slate-500">{a.ts}</td>
                <td className="py-2 px-3 font-semibold">{a.evt}</td>
                <td className="py-2 px-3">{a.scope}</td>
                <td className="py-2 px-3 text-rose-700">{a.beforeVal || '—'}</td>
                <td className="py-2 px-3 text-emerald-700 font-semibold">{a.afterVal || '—'}</td>
                <td className="py-2 px-3">{a.user}</td>
                <td className="py-2 px-3 text-emerald-700 font-bold">{a.out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
