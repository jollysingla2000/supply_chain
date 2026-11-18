import React from 'react';
import { INDUSTRY_LABELS } from '../engine/schema';
import { IndustryKey, ModuleId, ReleaseGateState, UserRole } from '../engine/types';

interface SidebarNavProps {
  activeModule: ModuleId;
  onSelectModule: (mod: ModuleId) => void;
  gate: ReleaseGateState;
  industry: IndustryKey;
  role: UserRole;
  sheetCount: number;
  totalRows: number;
  healthPct: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  all: 'All Roles',
  exec: 'CEO / Finance',
  planner: 'Demand Planner',
  supply: 'Supply & Depot',
};

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeModule,
  onSelectModule,
  gate,
  industry,
  role,
  sheetCount,
  totalRows,
  healthPct,
}) => {
  const navItems: {
    id: ModuleId;
    step: string;
    label: string;
    badge: string;
    badgeClass: string;
  }[] = [
    {
      id: 'm01',
      step: 'Step 1',
      label: 'Data Assurance Hub',
      badge:
        gate.criticalCount === 0
          ? '0 Blockers'
          : `${gate.criticalCount} Blockers`,
      badgeClass:
        gate.criticalCount === 0
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-rose-100 text-rose-800',
    },
    {
      id: 'm02',
      step: 'Step 2',
      label: 'Demand Core & RCA',
      badge: gate.step2Unlocked ? 'Unlocked' : 'Locked',
      badgeClass: gate.step2Unlocked
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-rose-50 text-rose-700',
    },
    {
      id: 'm03',
      step: 'Step 3',
      label: 'Control Tower & 9-Box',
      badge: 'Portfolio',
      badgeClass: 'bg-blue-50 text-blue-700',
    },
    {
      id: 'm04',
      step: 'Step 4',
      label: 'S&OP, MEIO & Supply Netting',
      badge: 'W1–W3',
      badgeClass: 'bg-amber-50 text-amber-800',
    },
    {
      id: 'm05',
      step: 'Step 5',
      label: 'Planning Rules & Setup',
      badge: 'Guardrails',
      badgeClass: 'bg-purple-50 text-purple-700',
    },
    {
      id: 'm06',
      step: 'Step 6',
      label: 'Value KPIs & Audit Trail',
      badge: 'Log',
      badgeClass: 'bg-teal-50 text-teal-800',
    },
  ];

  const dotClass =
    gate.criticalCount === 0
      ? gate.warningCount > 0
        ? 'bg-amber-400'
        : 'bg-emerald-400'
      : 'bg-rose-400';

  return (
    <>
      {/* Mobile step switcher */}
      <div className="md:hidden bg-white border-b border-slate-200 px-3 py-2 flex gap-1.5 overflow-x-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectModule(item.id)}
            className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
              activeModule === item.id
                ? 'bg-blue-50 text-blue-700 border-blue-300'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            {item.step}: {item.label}
          </button>
        ))}
      </div>

      {/* Desktop sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col justify-between shrink-0">
        <nav className="py-3 space-y-0.5" aria-label="Primary IBP Roadmap">
          <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Step-by-Step IBP Roadmap
          </div>
          {navItems.map((item) => {
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectModule(item.id)}
                className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-slate-50 transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-r-[3px] border-blue-600 font-bold'
                    : 'text-slate-600'
                }`}
              >
                <span>
                  <span className="font-mono text-[11px] text-slate-400 mr-1.5">
                    {item.step}
                  </span>{' '}
                  {item.label}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${item.badgeClass}`}>
                  {item.badge}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 m-3 rounded-xl bg-slate-900 text-white space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-blue-400">
              Active Workbook State
            </span>
            <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          </div>
          <div className="text-xs font-bold truncate">{INDUSTRY_LABELS[industry]}</div>
          <div className="text-[11px] text-slate-400">
            {sheetCount} Tables • {totalRows} Live Records
          </div>
          <div className="pt-1.5 border-t border-slate-800 grid grid-cols-2 gap-1 text-[10px] text-slate-300">
            <div>
              Role: <strong className="text-emerald-400">{ROLE_LABELS[role]}</strong>
            </div>
            <div>
              Health: <strong className="text-amber-300">{healthPct}%</strong>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
