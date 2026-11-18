import { useCallback, useMemo, useRef, useState } from 'react';
import { CopilotDrawer } from './components/CopilotDrawer';
import { CorrectionApprovalModal } from './components/CorrectionApprovalModal';
import { HeaderBar } from './components/HeaderBar';
import { OtherModules } from './components/OtherModules';
import { SidebarNav } from './components/SidebarNav';
import { Step1DataAssurance } from './components/Step1DataAssurance';
import { WarningSignOffModal } from './components/WarningSignOffModal';
import { runIndependentFormulaTests } from './engine/formulaTests';
import { createSeededEnterpriseSheets, INDUSTRY_LABELS } from './engine/schema';
import {
  ApprovedCorrection,
  AuditEntry,
  EnterpriseSheets,
  IndustryKey,
  ModuleId,
  UserRole,
  ValidationException,
  WarningSignOff,
} from './engine/types';
import {
  applyApprovedCorrections,
  applySafeTechnicalFixes,
  computeSignOffExpiryIso,
  evaluateReleaseGate,
  validateWorkbook,
} from './engine/validation';
import { buildWorkbookBinary, ingestWorkbookBuffer } from './engine/workbook';

function formatNow(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export default function App() {
  const [industry, setIndustry] = useState<IndustryKey>('cpg');
  const [role, setRole] = useState<UserRole>('all');
  const [activeModule, setActiveModule] = useState<ModuleId>('m01');
  const [sourceSheets, setSourceSheets] = useState<EnterpriseSheets>(() =>
    createSeededEnterpriseSheets()
  );
  const [approvedCorrections, setApprovedCorrections] = useState<ApprovedCorrection[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('01_Orders_Shipments_History');
  const [workbookSource, setWorkbookSource] = useState<string>(
    'Built-in Enterprise 12-Table Dataset'
  );
  const [reviewingException, setReviewingException] =
    useState<ValidationException | null>(null);
  const [warningSignOff, setWarningSignOff] = useState<WarningSignOff | null>(null);
  const [signOffModalOpen, setSignOffModalOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([
    {
      ts: '2026-11-18 09:50',
      evt: 'Step 1 Schema & Record Assurance Initialized',
      scope: '12 Enterprise Tables',
      user: 'Jolly Singla',
      beforeVal: '—',
      afterVal: 'Source Locked Immutable',
      out: 'Live Scan Active',
    },
  ]);

  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 3600);
  }, []);

  const addAudit = useCallback(
    (evt: string, scope: string, out: string, beforeVal?: string, afterVal?: string) => {
      setAuditLogs((prev) => [
        { ts: formatNow(), evt, scope, user: 'Jolly Singla', beforeVal, afterVal, out },
        ...prev,
      ]);
    },
    []
  );

  const governedSheets = useMemo(
    () => applyApprovedCorrections(sourceSheets, approvedCorrections),
    [sourceSheets, approvedCorrections]
  );

  const report = useMemo(() => validateWorkbook(governedSheets), [governedSheets]);
  const formulaTests = useMemo(() => runIndependentFormulaTests(), []);
  const formulaTestsPassed = useMemo(
    () => formulaTests.every((t) => t.passed),
    [formulaTests]
  );

  const gate = useMemo(
    () => evaluateReleaseGate(report, warningSignOff, formulaTestsPassed),
    [report, warningSignOff, formulaTestsPassed]
  );

  const sheetNames = Object.keys(governedSheets);
  const totalRows = report.health.totalRows;
  const healthPct =
    report.health.rowPassRatePct !== null ? String(report.health.rowPassRatePct) : '0.0';

  const handleSelectModule = (mod: ModuleId) => {
    const liveGate =
      mod === 'm02'
        ? evaluateReleaseGate(report, warningSignOff, formulaTestsPassed, Date.now())
        : gate;
    if (mod === 'm02' && !liveGate.step2Unlocked) {
      if (liveGate.status === 'AWAITING_WARNING_SIGNOFF') {
        showToast(
          `⚠ Step 2 Locked: Log mandatory Warning Sign-Off for the ${liveGate.warningCount} remaining warning(s) first.`
        );
      } else {
        showToast(
          `🔒 Step 2 Locked: ${liveGate.blockingReasons[0] || 'Resolve all gate blockers in Step 1 first.'}`
        );
      }
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

  const handleApproveCorrection = (
    draft: Omit<ApprovedCorrection, 'id' | 'approvedAt'>
  ) => {
    const corr: ApprovedCorrection = {
      ...draft,
      id: `COR-${Date.now()}`,
      approvedAt: formatNow(),
    };
    const nextCorrections = [...approvedCorrections, corr];
    const nextWorking = applyApprovedCorrections(sourceSheets, nextCorrections);
    const nextReport = validateWorkbook(nextWorking);
    const stillExists = nextReport.exceptions.some(
      (e) => e.signature === draft.exceptionSignature
    );

    setApprovedCorrections(nextCorrections);
    setReviewingException(null);

    addAudit(
      'Governed Correction Approved',
      `${draft.table} (${draft.fixType})`,
      stillExists ? 'Re-validated (Follow-up exception remains)' : 'Exception Resolved',
      draft.beforeSummary,
      draft.afterSummary
    );
    showToast(
      stillExists
        ? `Correction logged, but follow-up validation exception remains (${nextReport.exceptions.length} open).`
        : `Approved correction in ${draft.table}. Exception resolved (${nextReport.exceptions.length} open).`
    );
  };

  const handleRevertCorrection = (corrId: string) => {
    const target = approvedCorrections.find((c) => c.id === corrId);
    const nextCorrections = approvedCorrections.filter((c) => c.id !== corrId);
    setApprovedCorrections(nextCorrections);
    setWarningSignOff(null);
    if (target) {
      addAudit(
        'Approved Correction Reverted',
        `${target.table} (${target.fixType})`,
        'Restored to Source State',
        target.afterSummary,
        target.beforeSummary
      );
      showToast(`Reverted correction in ${target.table}. Source value active again.`);
    }
  };

  const handleRunSafeTechnicalFixes = () => {
    const res = applySafeTechnicalFixes(
      sourceSheets,
      approvedCorrections,
      'Jolly Singla (Tech Auto-Rule)'
    );
    setApprovedCorrections(res.nextCorrections);
    addAudit(
      'Safe Technical Fixes Executed',
      `${res.appliedCount} deterministic rule(s)`,
      `${res.beforeCount} → ${res.afterCount} exceptions`,
      `${res.beforeCount} Open`,
      `${res.afterCount} Remaining (${res.appliedCount} Fixed)`
    );
    if (res.appliedCount === 0) {
      showToast(
        `No safe deterministic fixes applied (${res.remainingCount} business-judgement exceptions require review).`
      );
    } else {
      showToast(
        `Applied ${res.appliedCount} safe technical fix(es): ${res.beforeCount} → ${res.afterCount} exceptions (${res.remainingCount} require human review).`
      );
    }
  };

  const handleReloadSeeded = () => {
    setSourceSheets(createSeededEnterpriseSheets());
    setApprovedCorrections([]);
    setActiveSheet('01_Orders_Shipments_History');
    setWorkbookSource('Built-in Enterprise 12-Table Dataset');
    setWarningSignOff(null);
    setActiveModule('m01');
    addAudit('Seeded Dataset Reloaded', '12 Enterprise Tables', 'Reset Complete');
    showToast('Reloaded default source records cleanly');
  };

  const handleDownloadWorkbook = () => {
    const bytes = buildWorkbookBinary(governedSheets);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
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
      const nextReport = validateWorkbook(result.sheets);
      setSourceSheets(result.sheets);
      setApprovedCorrections([]);
      setActiveSheet(result.activeSheet);
      setWorkbookSource(
        `${file.name} (${result.totalRows} rows across ${result.sheetCount} sheets)`
      );
      setWarningSignOff(null);
      setActiveModule('m01');
      addAudit(
        'Client Workbook Ingested',
        file.name,
        `${result.totalRows} rows across ${result.sheetCount} sheets (${nextReport.exceptions.length} exceptions)`
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
    const signedAtMs = Date.now();
    setWarningSignOff({
      approver,
      reason,
      expiry,
      signedAt: formatNow(),
      expiresAt: computeSignOffExpiryIso(expiry, signedAtMs),
    });
    setSignOffModalOpen(false);
    addAudit(
      'Mandatory Warning Sign-Off Logged',
      `${approver} (${expiry})`,
      'Gate Warning Policy Satisfied',
      `${gate.warningCount} Unacknowledged Warning(s)`,
      reason
    );
    showToast(`Logged mandatory warning sign-off by ${approver}`);
  };

  const handleFormulaAudit = () => {
    const passedCount = formulaTests.filter((t) => t.passed).length;
    const totalCount = formulaTests.length;
    const statusLabel = passedCount === totalCount ? 'PASS' : 'FAIL';
    addAudit(
      'Formula Regression Suite Checked',
      `${totalCount} Independent Tests`,
      `${passedCount} / ${totalCount} ${statusLabel}`
    );
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
              sourceSheets={sourceSheets}
              governedSheets={governedSheets}
              report={report}
              gate={gate}
              formulaTests={formulaTests}
              approvedCorrections={approvedCorrections}
              warningSignOff={warningSignOff}
              workbookSource={workbookSource}
              activeSheet={activeSheet}
              onSelectSheet={setActiveSheet}
              onReviewException={setReviewingException}
              onRevertCorrection={handleRevertCorrection}
              onRunSafeTechnicalFixes={handleRunSafeTechnicalFixes}
              onReloadSeeded={handleReloadSeeded}
              onProceedStep2={() => handleSelectModule('m02')}
              onOpenWarningSignOff={() => setSignOffModalOpen(true)}
              onFormulaVerifiedAudit={handleFormulaAudit}
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

      <CorrectionApprovalModal
        exception={reviewingException}
        onClose={() => setReviewingException(null)}
        onApprove={handleApproveCorrection}
      />

      <WarningSignOffModal
        open={signOffModalOpen}
        warningCount={gate.warningCount}
        onClose={() => setSignOffModalOpen(false)}
        onConfirm={handleConfirmWarningSignOff}
      />

      <CopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        errors={report.exceptions}
      />
    </div>
  );
}
