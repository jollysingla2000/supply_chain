import React, { useRef } from 'react';
import { INDUSTRY_LABELS } from '../engine/schema';
import { IndustryKey, UserRole } from '../engine/types';

interface HeaderBarProps {
  industry: IndustryKey;
  onIndustryChange: (val: IndustryKey) => void;
  role: UserRole;
  onRoleChange: (val: UserRole) => void;
  onDownloadWorkbook: () => void;
  onUploadFile: (file: File) => void;
  uploadInProgress: boolean;
  onOpenCopilot: () => void;
}

const ROLES: { key: UserRole; label: string }[] = [
  { key: 'all', label: 'All Roles' },
  { key: 'exec', label: 'CEO / Finance' },
  { key: 'planner', label: 'Demand Planner' },
  { key: 'supply', label: 'Supply & Depot' },
];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  industry,
  onIndustryChange,
  role,
  onRoleChange,
  onDownloadWorkbook,
  onUploadFile,
  uploadInProgress,
  onOpenCopilot,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-sm shadow">
          AR
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold tracking-tight text-sm sm:text-base">
              Argon End-to-End Supply Chain &amp; Demand Planning Suite
            </span>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              Argon 2.0 • Step 1: Data Assurance
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Record-Driven Data Governance → Demand Core → Control Tower → S&amp;OP &amp; MEIO → Supply Netting &amp; Value KPIs
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 text-xs">
          <label htmlFor="industrySelect" className="text-[10px] font-bold uppercase text-slate-400">
            Industry:
          </label>
          <select
            id="industrySelect"
            value={industry}
            onChange={(e) => onIndustryChange(e.target.value as IndustryKey)}
            className="bg-slate-800 text-white font-bold focus:outline-none cursor-pointer"
          >
            {(Object.keys(INDUSTRY_LABELS) as IndustryKey[]).map((key) => (
              <option key={key} value={key}>
                {INDUSTRY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-[11px]">
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRoleChange(r.key)}
              className={`font-semibold px-2 py-1 rounded transition ${
                role === r.key
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          id="dpFileInput"
          accept=".xlsx,.xls,.csv"
          disabled={uploadInProgress}
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUploadFile(file);
              e.target.value = '';
            }
          }}
        />
        <button
          type="button"
          onClick={onDownloadWorkbook}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
        >
          ↓ Download Test .XLSX
        </button>
        <button
          type="button"
          disabled={uploadInProgress}
          onClick={() => fileInputRef.current?.click()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
        >
          {uploadInProgress ? 'Processing Workbook…' : 'Upload .XLSX / .CSV File'}
        </button>
        <button
          type="button"
          onClick={onOpenCopilot}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-indigo-400/40 shadow-sm flex items-center gap-1.5 transition"
        >
          <span>Argon AI Copilot</span>
        </button>
      </div>
    </header>
  );
};
