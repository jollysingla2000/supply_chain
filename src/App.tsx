import { useCallback, useMemo, useRef, useState } from 'react';
import { CopilotDrawer } from './components/CopilotDrawer';
import { HeaderBar } from './components/HeaderBar';
import { OtherModules } from './components/OtherModules';
import { SidebarNav } from './components/SidebarNav';
import { Step1DataAssurance } from './components/Step1DataAssurance';
import { WarningSignOffModal } from './components/WarningSignOffModal';
import { createSeededEnterpriseSheets, INDUSTRY_LABELS } from './engine/schema';
import {
  AuditEntry,
  EnterpriseSheets,
  IndustryKey,
  ModuleId,
  UserRole,
  ValidationException,
  WarningSignOff,
} from './engine/types';
import {
  applyFixToSheets,
  evaluateReleaseGate,
  validateWorkbookRecords,
} from './engine/validation';
import { buildWorkbookBinary, ingestWorkbookBuffer } from './engine/workbook';

function formatNow(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export default function App() {
  const [industry, setIndustry] = useState<IndustryKey>('cpg');
  const [role, setRole] = useState<UserRole>('all');
  const [activeModule, setActiveModule] = useState<ModuleId>('m01');
  const [sheets, setSheets] = useState<EnterpriseSheets>(() => createSeededEnterpriseSheets());
  const [activeSheet, setActiveSheet] = useState<string>('01_Orders_Shipments_History');
  const [workbookSource, setWorkbookSource] = useState<string>(
    'Built-in Enterprise 12-Table Dataset'
  );
  const [warningSignOff, setWarningSignOff] = useState<WarningSignOff | null>(null);
  const [signOffModalOpen, setSignOffModalOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([
    {
      ts: '2026-11-18 09:50',
      evt: 'Step 1 Record-Level Data Assurance Initialized',
      scope: '12 Enterprise Tables',
      user: 'Jolly Singla',
      out: 'Live Scan Active',
    },
  ]);

  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 3400);
  }, []);

  const addAudit = useCallback((evt: string, scope: string, out: string) => {
    setAuditLogs((prev) => [
      { ts: formatNow(), evt, scope, user: 'Jolly Singla', out },
      ...prev,
    ]);
  }, []);

  const errors = useMemo(() => validateWorkbookRecords(sheets), [sheets]);
  const gate = useMemo(
    () => evaluateReleaseGate(errors, warningSignOff),
    [errors, warningSignOff]
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

  const handleSelectModule = (mod: ModuleId) => {
    if (mod === 'm02' && !gate.step2Unlocked) {
      showToast(
        `🔒 Step 2 Locked: Resolve all ${gate.criticalCount} critical blocker(s) in Step 1 first. Critical exceptions cannot be bypassed.`
      );
      return;
    }
    setActiveModule(mod);
  };

  const handleIndustryChange = (val: IndustryKey) => {
    setIndustry(val);
    addAudit('Industry Vertical Switched', INDUSTRY_LABELS[val], 'Schema Synced');
    showToast(`Switched industry context to ${INDUSTRY_LABELS[val]}`);
  };

  const handleRoleChange = (val: UserRole) => {
    setRole(val);
    showToast(`Role lens updated`);
  };

  const handleFixRow = (errObj: ValidationException) => {
    setSheets((prev) => applyFixToSheets(prev, errObj));
    addAudit(
      'Record Mutated & Re-Validated',
      `${errObj.table} ${errObj.rowNum > 0 ? `Row #${errObj.rowNum}` : 'Missing Period'}`,
      `${errObj.badVal} → ${errObj.fixValText}`
    );
    showToast(`Fixed actual record in ${errObj.table} and re-validated`);
  };

  const handleAutoHealCritical = () => {
    let working = sheets;
    let fixed = 0;
    let guard = 0;
    while (guard < 100) {
      const currentErrs = validateWorkbookRecords(working);
      const nextCrit = currentErrs.find((e) => e.severity === 'CRITICAL');
      if (!nextCrit) break;
      working = applyFixToSheets(working, nextCrit);
      fixed++;
      guard++;
    }
    setSheets(working);
    addAudit(
      'Auto-Heal Mutated Critical Records',
      `${fixed} Critical Record(s) Repaired`,
      '0 Critical Blockers Remaining'
    );
    showToast(`Auto-Healed ${fixed} critical blocker(s). Step 2 Demand Core is now unlocked.`);
  };

  const handleResolveWarnings = () => {
    let working = sheets;
    let fixed = 0;
    let guard = 0;
    while (guard < 100) {
      const currentErrs = validateWorkbookRecords(working);
      if (currentErrs.length === 0) break;
      working = applyFixToSheets(working, currentErrs[0]);
      fixed++;
      guard++;
    }
    setSheets(working);
    addAudit(
      'Remaining Warnings Resolved',
      `${fixed} Warning Record(s) Repaired`,
      '100% Clean Workbook'
    );
    showToast(`Resolved ${fixed} warning record(s).`);
  };

  const handleReloadSeeded = () => {
    setSheets(createSeededEnterpriseSheets());
    setActiveSheet('01_Orders_Shipments_History');
    setWorkbookSource('Built-in Enterprise 12-Table Dataset');
    setWarningSignOff(null);
    setActiveModule('m01');
    addAudit('Seeded Anomalies Reloaded', '12 Enterprise Tables', 'Reset Complete');
    showToast('Reloaded default records with seeded anomalies');
  };

  const handleDownloadWorkbook = () => {
    const bytes = buildWorkbookBinary(sheets);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Argon_Data_Assurance_Test_Workbook.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addAudit(
      'Exported Multi-Sheet Test Workbook',
      'Argon_Data_Assurance_Test_Workbook.xlsx',
      `${sheetNames.length} Tables`
    );
    showToast('Downloaded Argon_Data_Assurance_Test_Workbook.xlsx');
  };

  const handleUploadFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const result = ingestWorkbookBuffer(buf, file.name);
      const nextErrs = validateWorkbookRecords(result.sheets);
      setSheets(result.sheets);
      setActiveSheet(result.activeSheet);
      setWorkbookSource(`${file.name} (${result.totalRows} rows across ${result.sheetCount} sheets)`);
      setWarningSignOff(null);
      setActiveModule('m01');
      addAudit(
        'Client Workbook Ingested',
        file.name,
        `${result.totalRows} rows across ${result.sheetCount} sheets (${nextErrs.length} exceptions)`
      );
      showToast(
        `Ingested ${result.totalRows} rows across ${result.sheetCount} worksheet(s) from ${file.name}`
      );
    } catch {
      showToast('Could not parse uploaded .XLSX or .CSV file');
    }
  };

  const handleConfirmWarningSignOff = (
    approver: string,
    reason: string,
    expiry: string
  ) => {
    setWarningSignOff({
      approver,
      reason,
      expiry,
      signedAt: formatNow(),
    });
    setSignOffModalOpen(false);
    addAudit('Warning Acknowledgement Logged', `${approver} (${expiry})`, reason);
    showToast(`Logged warning acknowledgement by ${approver}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <HeaderBar
        industry={industry}
        onIndustryChange={handleIndustryChange}
        role={role}
        onRoleChange={handleRoleChange}
        onDownloadWorkbook={handleDownloadWorkbook}
        onUploadFile={handleUploadFile}
        onOpenCopilot={() => setCopilotOpen(true)}
      />

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <SidebarNav
          activeModule={activeModule}
          onSelectModule={handleSelectModule}
          gate={gate}
          industry={industry}
          role={role}
          sheetCount={sheetNames.length}
          totalRows={totalRows}
          healthPct={healthPct}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {toastMsg && (
            <div
              role="status"
              className="fixed bottom-5 right-5 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2 border border-slate-700"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{toastMsg}</span>
            </div>
          )}

          {activeModule === 'm01' ? (
            <Step1DataAssurance
              sheets={sheets}
              errors={errors}
              gate={gate}
              warningSignOff={warningSignOff}
              workbookSource={workbookSource}
              activeSheet={activeSheet}
              onSelectSheet={setActiveSheet}
              onFixRow={handleFixRow}
              onAutoHealCritical={handleAutoHealCritical}
              onResolveWarnings={handleResolveWarnings}
              onReloadSeeded={handleReloadSeeded}
              onProceedStep2={() => handleSelectModule('m02')}
              onOpenWarningSignOff={() => setSignOffModalOpen(true)}
              onFormulaVerifiedAudit={() =>
                addAudit(
                  'Phase 1 Formula Suite Verified',
                  '12 Independent Calculation Tests',
                  '12 / 12 PASS'
                )
              }
            />
          ) : (
            <OtherModules
              activeModule={activeModule}
              onBackToStep1={() => setActiveModule('m01')}
              auditLogs={auditLogs}
            />
          )}
        </main>
      </div>

      <WarningSignOffModal
        open={signOffModalOpen}
        warningCount={gate.warningCount}
        onClose={() => setSignOffModalOpen(false)}
        onConfirm={handleConfirmWarningSignOff}
      />

      <CopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        errors={errors}
      />
    </div>
  );
}
