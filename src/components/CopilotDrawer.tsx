import React, { useState } from 'react';
import { ValidationException } from '../engine/types';

interface CopilotDrawerProps {
  open: boolean;
  onClose: () => void;
  errors: ValidationException[];
}

type CopilotTopic = 'blockers' | 'overfcst' | 'wc';

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  open,
  onClose,
  errors,
}) => {
  const [topic, setTopic] = useState<CopilotTopic>('blockers');
  const [queryInput, setQueryInput] = useState('');
  const [customLabel, setCustomLabel] = useState<string | null>(null);

  if (!open) return null;

  const crit = errors.filter((e) => e.severity === 'CRITICAL').length;
  const warn = errors.filter((e) => e.severity === 'WARNING').length;

  const defaultLabels: Record<CopilotTopic, string> = {
    blockers: 'Summarize current data blockers across the enterprise tables',
    overfcst: 'Why is Kolkata / Delhi overforecasting for the last six months?',
    wc: 'How much working capital can we release without compromising service?',
  };

  const activeQuestion = customLabel || defaultLabels[topic];

  const handleAsk = () => {
    const q = queryInput.trim();
    if (!q) {
      setCustomLabel(null);
      setTopic('blockers');
      return;
    }
    setCustomLabel(q);
    const low = q.toLowerCase();
    if (
      low.includes('over') ||
      low.includes('kolkata') ||
      low.includes('delhi') ||
      low.includes('p401')
    ) {
      setTopic('overfcst');
    } else if (low.includes('cash') || low.includes('capital') || low.includes('release')) {
      setTopic('wc');
    } else {
      setTopic('blockers');
    }
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 w-full sm:w-[460px] bg-white shadow-2xl border-l border-slate-300 z-50 flex flex-col"
      aria-label="Argon AI Copilot"
    >
      <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-extrabold text-sm">
            AI
          </div>
          <div>
            <div className="text-sm font-extrabold">Argon AI Copilot — Planning Analyst</div>
            <div className="text-[11px] text-slate-400">
              Live data-driven diagnostics, calculations &amp; 1-click fixes
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs font-bold px-2.5 py-1 rounded border border-slate-700"
        >
          ✕ Close
        </button>
      </div>

      <div className="p-3 bg-slate-100 border-b border-slate-200 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Ask an Executive or Planner Question:
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCustomLabel(null);
              setTopic('blockers');
            }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-indigo-500"
          >
            1. Summarize current data blockers
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomLabel(null);
              setTopic('overfcst');
            }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-indigo-500"
          >
            2. Why is Kolkata / Delhi overforecasting?
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomLabel(null);
              setTopic('wc');
            }}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-indigo-500"
          >
            3. How much working capital can we release?
          </button>
        </div>
        <div className="flex gap-1.5 pt-1">
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAsk();
            }}
            placeholder="Ask about data health, P401, or working capital..."
            className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white"
          />
          <button
            type="button"
            onClick={handleAsk}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg"
          >
            Ask
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs bg-slate-50">
        <div className="p-3 rounded-lg bg-indigo-950 text-white">
          <div className="text-[10px] font-bold uppercase text-indigo-300">Question</div>
          <div className="font-bold mt-0.5">&quot;{activeQuestion}&quot;</div>
        </div>

        {topic === 'blockers' && (
          <div className="card p-3 space-y-2">
            <div className="font-bold text-slate-900">
              Live Record-Level Data Assurance Summary
            </div>
            <p className="text-slate-700">
              Scanning all active tables found <strong>{crit} Critical Blockers</strong> and{' '}
              <strong>{warn} Non-Blocking Warnings</strong>.
            </p>
            <ul className="list-disc pl-4 text-slate-600 space-y-1">
              <li>
                Critical blockers include business-key duplicates, missing monthly/weekly demand
                periods, null July actuals, negative credit-note actuals (-410 u), orphan SKU/Depot/Channel
                mappings, CASE UOM factor = 1, and unflagged spikes on P401.
              </li>
              <li>
                Critical blockers strictly lock Step 2 forecasting without bypass. Fix individual
                records or click <strong>Auto-Heal All Critical Anomalies</strong> in Step 1.
              </li>
            </ul>
          </div>
        )}

        {topic === 'overfcst' && (
          <div className="card p-3 space-y-2">
            <div className="font-bold text-slate-900">
              Root-Cause Proof: Kolkata &amp; Delhi Over-Forecasting
            </div>
            <p className="text-slate-700">
              1. <strong>P401 / Kolkata / GT</strong>: An unflagged distributor bulk spike in{' '}
              <strong>Sep 2025 (5,435 u vs 2,363 u base)</strong> inflated Q4 forecasts by{' '}
              <strong>+1,571 u</strong> and Q1 2026 forecasts by <strong>+3,840 u</strong> (Feb
              submitted at 5,350 u vs 2,199 u clean baseline).
            </p>
            <p className="text-slate-700">
              2. <strong>SKU_BEV_01 / Delhi</strong>: Unapproved +32.5% Field Sales override above
              AOP without a reason code.
            </p>
          </div>
        )}

        {topic === 'wc' && (
          <div className="card p-3 space-y-2">
            <div className="font-bold text-slate-900">Working Capital Release Calculation</div>
            <p className="text-slate-700">
              Removing one-off bulk spike noise from forecast error variance reduces MEIO safety
              buffers by <strong>-24.8%</strong> while preserving <strong>98.2% OTIF</strong>,
              releasing <strong>₹18.4 Lakhs</strong> in trapped working capital.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};
