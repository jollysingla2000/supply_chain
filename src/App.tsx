import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { SidebarNav } from './components/SidebarNav';
import { runIndependentFormulaTests } from './engine/formulaTests';
import {
  applyColumnMapping,
  clearPersistedGovernanceState,
  computeWorkbookHash,
  detectSchemaDrift,
  hasPersistedGovernanceState,
  loadPersistedGovernanceState,
  profileWorkbook,
  remediateMissingStructure,
  runCrossTableReconciliation,
  savePersistedGovernanceState,
} from './engine/profilingAndReconciliation';
import {
  createDomainTestWorkbook,
  createSeededEnterpriseSheets,
  DEFAULT_RULE_CONFIG,
  INDUSTRY_DEFAULT_RULE_CONFIGS,
  INDUSTRY_LABELS,
  PLANNING_DOMAIN_LABELS,
} from './engine/schema';
import {
  ApprovedCorrection,
  AuditEntry,
  EnterpriseSheets,
  ExceptionAssignment,
  IndustryKey,
  ModuleId,
  PlanningDomainKey,
  UploadLineageRecord,
  UserRole,
  ValidationException,
  ValidationRuleConfig,
  WarningSignOff,
} from './engine/types';
import {
  applyApprovedCorrections,
  applySafeTechnicalFixes,
  computeSignOffExpiryIso,
  evaluateReleaseGate,
  validateRuleConfig,
  validateWorkbook,
} from './engine/validation';

const Step1DataAssurance = lazy(() =>
  import('./components/Step1DataAssurance').then((module) => ({
    default: module.Step1DataAssurance,
  }))
);
const OtherModules = lazy(() =>
  import('./components/OtherModules').then((module) => ({
    default: module.OtherModules,
  }))
);
const CorrectionApprovalModal = lazy(() =>
  import('./components/CorrectionApprovalModal').then((module) => ({
    default: module.CorrectionApprovalModal,
  }))
);
const WarningSignOffModal = lazy(() =>
  import('./components/WarningSignOffModal').then((module) => ({
    default: module.WarningSignOffModal,
  }))
);
const CopilotDrawer = lazy(() =>
  import('./components/CopilotDrawer').then((module) => ({
    default: module.CopilotDrawer,
  }))
);

async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Secure SHA-256 is unavailable in this browser context; upload was not accepted.');
  }
  const digest = await subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function formatNow(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export default function App() {
  const persistenceLoad = useMemo(() => {
    const hadSavedState = hasPersistedGovernanceState();
    const state = loadPersistedGovernanceState();
    return {
      state,
      warning:
        hadSavedState && !state
          ? 'A saved workbook could not be safely restored. The app is showing the built-in dataset and has preserved the unreadable saved state. Upload a valid workbook or explicitly reload the built-in dataset to start a new saved session.'
          : null,
    };
  }, []);
  const persisted = persistenceLoad.state;

  const [industry, setIndustry] = useState<IndustryKey>(() => persisted?.industry ?? 'cpg');
  const [domain, setDomain] = useState<PlanningDomainKey>(() => persisted?.domain ?? 'ALL');
  const [ruleConfig, setRuleConfig] = useState<ValidationRuleConfig>(
    () =>
      persisted?.ruleConfig ??
      INDUSTRY_DEFAULT_RULE_CONFIGS[persisted?.industry ?? 'cpg'] ??
      DEFAULT_RULE_CONFIG
  );
  const [role, setRole] = useState<UserRole>('all');
  const [activeModule, setActiveModule] = useState<ModuleId>('m01');
  const [sourceSheets, setSourceSheets] = useState<EnterpriseSheets>(() =>
    persisted?.sourceSheets && Object.keys(persisted.sourceSheets).length > 0
      ? persisted.sourceSheets
      : createSeededEnterpriseSheets()
  );
  const [approvedCorrections, setApprovedCorrections] = useState<ApprovedCorrection[]>(
    () => persisted?.approvedCorrections ?? []
  );
  const [activeSheet, setActiveSheet] = useState<string>('01_Orders_Shipments_History');
  const [workbookSource, setWorkbookSource] = useState<string>(
    () => persisted?.workbookSource || 'Built-in Enterprise 12-Table Dataset'
  );
  const [reviewingException, setReviewingException] =
    useState<ValidationException | null>(null);
  const [warningSignOff, setWarningSignOff] = useState<WarningSignOff | null>(
    () => persisted?.warningSignOff ?? null
  );
  const [signOffModalOpen, setSignOffModalOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [persistenceLoadWarning, setPersistenceLoadWarning] = useState<string | null>(
    () => persistenceLoad.warning
  );
  const [exceptionAssignments, setExceptionAssignments] = useState<
    Record<string, ExceptionAssignment>
  >(() => persisted?.exceptionAssignments ?? {});

  const sourceWorkbookHash = useMemo(
    () => computeWorkbookHash(sourceSheets),
    [sourceSheets]
  );

  const [lineageHistory, setLineageHistory] = useState<UploadLineageRecord[]>(() => {
    if (persisted?.lineageHistory && persisted.lineageHistory.length > 0) {
      const storedActiveIndex = persisted.lineageHistory.findIndex(
        (record) => record.uploadStatus === 'ACTIVE'
      );
      const activeIndex =
        storedActiveIndex >= 0
          ? storedActiveIndex
          : persisted.lineageHistory.findIndex((record) => record.uploadStatus === 'SUCCESS');
      return persisted.lineageHistory.map((record, index) => ({
        ...record,
        uploadStatus:
          record.uploadStatus === 'REJECTED'
            ? 'REJECTED'
            : index === activeIndex
              ? 'ACTIVE'
              : 'SUPERSEDED',
      }));
    }
    const seeded = createSeededEnterpriseSheets();
    const totalRows = Object.values(seeded).reduce(
      (s, t) => s + (t.records?.length || 0),
      0
    );
    const seedHash = computeWorkbookHash(seeded);
    return [
      {
        id: 'LIN-001',
        fileName: 'Built-in Enterprise 12-Table Dataset',
        fileHash: seedHash,
        governedOutputHash: seedHash,
        sourceVersion: 1,
        uploadStatus: 'ACTIVE',
        uploadedAt: '2026-11-18 09:50',
        sheetCount: Object.keys(seeded).length,
        totalRows,
        domain: 'ALL',
        industry: 'cpg',
      },
    ];
  });

  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>(() => {
    if (persisted?.auditLog && persisted.auditLog.length > 0) {
      return persisted.auditLog;
    }
    return [
      {
        ts: '2026-11-18 09:50',
        evt: 'Step 1 Schema & Record Assurance Initialized',
        scope: '12 Enterprise Tables',
        user: 'Jolly Singla',
        beforeVal: '—',
        afterVal: 'Source Locked Immutable',
        out: 'Live Scan Active',
        datasetHash: computeWorkbookHash(createSeededEnterpriseSheets()),
      },
    ];
  });

  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 3600);
  }, []);

  const persistenceFailureShownRef = useRef(false);

  // Persist source data and governance state. Surface storage failures instead of silently losing work.
  useEffect(() => {
    if (persistenceLoadWarning) return;
    const saved = savePersistedGovernanceState({
      industry,
      domain,
      ruleConfig,
      sourceSheets,
      workbookSource,
      sourceWorkbookHash,
      approvedCorrections,
      warningSignOff,
      auditLog: auditLogs,
      lineageHistory,
      exceptionAssignments,
    });
    if (!saved && !persistenceFailureShownRef.current) {
      persistenceFailureShownRef.current = true;
      showToast('Warning: browser storage failed. Your latest changes may not survive a refresh.');
    } else if (saved) {
      persistenceFailureShownRef.current = false;
    }
  }, [
    industry,
    domain,
    ruleConfig,
    sourceSheets,
    workbookSource,
    sourceWorkbookHash,
    approvedCorrections,
    warningSignOff,
    auditLogs,
    lineageHistory,
    exceptionAssignments,
    showToast,
    persistenceLoadWarning,
  ]);

  const addAudit = useCallback(
    (
      evt: string,
      scope: string,
      out: string,
      beforeVal?: string,
      afterVal?: string,
      datasetHash?: string
    ) => {
      setAuditLogs((prev) => [
        {
          ts: formatNow(),
          evt,
          scope,
          user: 'Jolly Singla',
          beforeVal,
          afterVal,
          out,
          datasetHash: datasetHash ?? sourceWorkbookHash,
        },
        ...prev,
      ]);
    },
    [sourceWorkbookHash]
  );

  const governedSheets = useMemo(
    () => applyApprovedCorrections(sourceSheets, approvedCorrections),
    [sourceSheets, approvedCorrections]
  );

  // Keep the active lineage record's governed hash aligned with approved corrections.
  useEffect(() => {
    const governedOutputHash = computeWorkbookHash(governedSheets);
    setLineageHistory((prev) => {
      if (
        prev.length === 0 ||
        prev[0].uploadStatus !== 'ACTIVE' ||
        prev[0].governedOutputHash === governedOutputHash
      ) {
        return prev;
      }
      return [{ ...prev[0], governedOutputHash }, ...prev.slice(1)];
    });
  }, [governedSheets]);

  const report = useMemo(
    () => validateWorkbook(governedSheets, { industry, domain, ruleConfig }),
    [governedSheets, industry, domain, ruleConfig]
  );

  const profileReport = useMemo(
    () => profileWorkbook(governedSheets, report.exceptions, ruleConfig.outlierZThreshold),
    [governedSheets, report.exceptions, ruleConfig.outlierZThreshold]
  );

  const reconciliationReport = useMemo(
    () => runCrossTableReconciliation(governedSheets, ruleConfig, domain),
    [governedSheets, ruleConfig, domain]
  );

  const schemaDrift = useMemo(
    () => detectSchemaDrift(governedSheets, domain),
    [governedSheets, domain]
  );

  const formulaTests = useMemo(() => runIndependentFormulaTests(), []);
  const formulaTestsPassed = useMemo(
    () => formulaTests.every((t) => t.passed),
    [formulaTests]
  );

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!warningSignOff) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, [warningSignOff]);

  const gate = useMemo(
    () =>
      evaluateReleaseGate(
        report,
        warningSignOff,
        formulaTestsPassed,
        nowMs,
        sourceWorkbookHash
      ),
    [report, warningSignOff, formulaTestsPassed, nowMs, sourceWorkbookHash]
  );

  const sheetNames = Object.keys(governedSheets);
  const totalRows = report.health.totalRows;
  const healthPct =
    report.health.overallQualityScorePct !== null
      ? String(report.health.overallQualityScorePct)
      : '0.0';

  const handleSelectModule = (mod: ModuleId) => {
    const liveGate =
      mod === 'm02'
        ? evaluateReleaseGate(
            report,
            warningSignOff,
            formulaTestsPassed,
            Date.now(),
            sourceWorkbookHash
          )
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
    const nextCfg = INDUSTRY_DEFAULT_RULE_CONFIGS[val] ?? DEFAULT_RULE_CONFIG;
    setIndustry(val);
    setRuleConfig(nextCfg);
    setWarningSignOff(null);
    addAudit(
      'Industry Vertical Switched',
      INDUSTRY_LABELS[val],
      `Policy Updated (Min Pack=${nextCfg.standardCasePackMin} EA, Min SLA=${nextCfg.minServiceLevelPct}%)`
    );
    showToast(`Switched industry context to ${INDUSTRY_LABELS[val]}`);
  };

  const handleDomainChange = (nextDomain: PlanningDomainKey) => {
    setDomain(nextDomain);
    setWarningSignOff(null);
    addAudit(
      'Planning Domain Contract Changed',
      PLANNING_DOMAIN_LABELS[nextDomain],
      'Mandatory Tables & Rules Re-evaluated'
    );
    showToast(`Active domain contract: ${PLANNING_DOMAIN_LABELS[nextDomain]}`);
  };

  const handleLoadDomainDataset = (targetDomain: PlanningDomainKey) => {
    const domainSheets = createDomainTestWorkbook(targetDomain);
    setPersistenceLoadWarning(null);
    const hash = computeWorkbookHash(domainSheets);
    const rowsCount = Object.values(domainSheets).reduce(
      (s, t) => s + (t.records?.length || 0),
      0
    );
    const firstSheet = Object.keys(domainSheets)[0] || '09_Product_Master';
    setDomain(targetDomain);
    setSourceSheets(domainSheets);
    setApprovedCorrections([]);
    setActiveSheet(firstSheet);
    setWorkbookSource(
      `Domain Test Dataset — ${PLANNING_DOMAIN_LABELS[targetDomain]} (${Object.keys(domainSheets).length} tables • ${rowsCount} rows)`
    );
    setWarningSignOff(null);
    setExceptionAssignments({});
    setLineageHistory((prev) => [
      {
        id: `LIN-${String(prev.length + 1).padStart(3, '0')}`,
        fileName: `Domain_Test_${targetDomain}.xlsx`,
        fileHash: hash,
        governedOutputHash: hash,
        sourceVersion: prev.length + 1,
        uploadStatus: 'ACTIVE',
        uploadedAt: formatNow(),
        sheetCount: Object.keys(domainSheets).length,
        totalRows: rowsCount,
        domain: targetDomain,
        industry,
      },
      ...(prev.length > 0 && prev[0].uploadStatus !== 'REJECTED'
        ? [{ ...prev[0], uploadStatus: 'SUPERSEDED' as const }, ...prev.slice(1)]
        : prev),
    ]);
    addAudit(
      'Domain Test Dataset Loaded',
      PLANNING_DOMAIN_LABELS[targetDomain],
      `${Object.keys(domainSheets).length} Domain Tables (${hash.slice(0, 19)}…)`,
      undefined,
      undefined,
      hash
    );
    showToast(
      `Loaded ${PLANNING_DOMAIN_LABELS[targetDomain]} test dataset (${Object.keys(domainSheets).length} tables)`
    );
  };

  const handleUpdateRuleConfig = (patch: Partial<ValidationRuleConfig>) => {
    const validation = validateRuleConfig(patch, ruleConfig);
    if (!validation.valid) {
      showToast(`⚠ Rule Policy Rejected: ${validation.errors[0]}`);
      return;
    }
    setRuleConfig(validation.sanitized);
    setWarningSignOff(null);
    addAudit(
      'Validation Rule Thresholds Updated',
      `Policy v${validation.sanitized.ruleVersion ?? 1}`,
      JSON.stringify(patch)
    );
  };

  const handleResetRuleConfig = () => {
    const def = INDUSTRY_DEFAULT_RULE_CONFIGS[industry] ?? DEFAULT_RULE_CONFIG;
    setRuleConfig(def);
    showToast(`Reset rule thresholds to ${INDUSTRY_LABELS[industry]} defaults`);
  };

  const handleRoleChange = (val: UserRole) => {
    setRole(val);
    showToast(`Role lens updated`);
  };

  const handleAssignException = (signature: string, assignment: ExceptionAssignment) => {
    setExceptionAssignments((prev) => {
      const existing = prev[signature];
      const nowStr = formatNow();
      const historyEntry = {
        owner: assignment.owner,
        updatedAt: nowStr,
        ts: nowStr,
        fromOwner: existing?.owner ?? 'Unassigned',
        toOwner: assignment.owner,
        status: assignment.status,
      };
      return {
        ...prev,
        [signature]: {
          ...assignment,
          updatedAt: nowStr,
          history: [...(existing?.history ?? []), historyEntry],
        },
      };
    });
    addAudit(
      'Exception Steward Assigned',
      signature.slice(0, 32),
      `${assignment.owner} (SLA: ${assignment.slaHours}h)`
    );
  };

  const handleRemediateStructure = (table: string, column?: string) => {
    const nextSheets = remediateMissingStructure(sourceSheets, table, column);
    setSourceSheets(nextSheets);
    addAudit(
      'In-App Structural Remediation',
      column ? `${table}.${column}` : table,
      column
        ? 'Added Empty Column Header (Awaiting Data)'
        : 'Initialized Empty Table Structure (0 Synthetic Rows — Awaiting Data)',
      undefined,
      undefined,
      computeWorkbookHash(nextSheets)
    );
    showToast(
      column
        ? `Added missing column ${column} to ${table} (populate verified values to pass validation)`
        : `Initialized empty canonical structure for ${table} (0 synthetic records created)`
    );
  };

  const handleApplyColumnMapping = (
    table: string,
    sourceColumn: string,
    targetCanonicalColumn: string
  ) => {
    try {
      const nextSheets = applyColumnMapping(sourceSheets, table, sourceColumn, targetCanonicalColumn);
      setSourceSheets(nextSheets);
      addAudit(
        'Column Alias Mapped',
        table,
        `${sourceColumn} → ${targetCanonicalColumn}`,
        sourceColumn,
        targetCanonicalColumn,
        computeWorkbookHash(nextSheets)
      );
      showToast(`Mapped ${table}.${sourceColumn} → ${targetCanonicalColumn}`);
    } catch (err) {
      showToast(
        err instanceof Error ? `⚠ Mapping Blocked: ${err.message}` : 'Column mapping failed'
      );
    }
  };

  const handleApproveCorrection = (
    draft: Omit<ApprovedCorrection, 'id' | 'approvedAt'>
  ) => {
    const corr: ApprovedCorrection = {
      ...draft,
      id: `COR-${Date.now()}`,
      approvedAt: formatNow(),
      sourceWorkbookHash,
    };
    const nextCorrections = [...approvedCorrections, corr];
    const nextWorking = applyApprovedCorrections(sourceSheets, nextCorrections);
    const nextReport = validateWorkbook(nextWorking, { industry, domain, ruleConfig });
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
    setPersistenceLoadWarning(null);
    clearPersistedGovernanceState();
    const fresh = createSeededEnterpriseSheets();
    setSourceSheets(fresh);
    setApprovedCorrections([]);
    setActiveSheet('01_Orders_Shipments_History');
    setWorkbookSource('Built-in Enterprise 12-Table Dataset');
    setWarningSignOff(null);
    setExceptionAssignments({});
    setActiveModule('m01');
    const seedHash = computeWorkbookHash(fresh);
    const seedRows = Object.values(fresh).reduce(
      (sum, table) => sum + (table.records?.filter((row) => !row._removed).length || 0),
      0
    );
    setLineageHistory((prev) => [
      {
        id: `LIN-${String(prev.length + 1).padStart(3, '0')}`,
        fileName: 'Built-in Enterprise 12-Table Dataset',
        fileHash: seedHash,
        governedOutputHash: seedHash,
        sourceVersion: prev.length + 1,
        uploadStatus: 'ACTIVE',
        uploadedAt: formatNow(),
        sheetCount: Object.keys(fresh).length,
        totalRows: seedRows,
        domain: 'ALL',
        industry: 'cpg',
      },
      ...(prev.length > 0 && prev[0].uploadStatus !== 'REJECTED'
        ? [{ ...prev[0], uploadStatus: 'SUPERSEDED' as const }, ...prev.slice(1)]
        : prev),
    ]);
    addAudit('Seeded Dataset Reloaded', '12 Enterprise Tables', 'Reset Complete', undefined, undefined, seedHash);
    showToast('Reloaded default source records cleanly');
  };

  const handleDownloadWorkbook = async () => {
    try {
      const { buildWorkbookBinary } = await import('./engine/workbook');
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
      `${sheetNames.length} Tables (${computeWorkbookHash(governedSheets)})`
    );
      showToast('Downloaded Argon_Data_Assurance_Test_Workbook.xlsx');
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Workbook export failed: ${err.message}`
          : 'Workbook export failed.'
      );
    }
  };

  const handleUploadFile = async (file: File) => {
    try {
      const extension = file.name.toLowerCase().split('.').pop();
      if (!['xlsx', 'xls', 'csv'].includes(extension || '')) {
        throw new Error('Only .XLSX, .XLS, and .CSV files are supported.');
      }
      if (file.size <= 0) throw new Error('The selected file is empty.');
      const maxUploadBytes = 100 * 1024 * 1024;
      if (file.size > maxUploadBytes) {
        throw new Error('The workbook exceeds the 100 MB upload limit.');
      }
      const buf = await file.arrayBuffer();
      const { ingestWorkbookBuffer } = await import('./engine/workbook');
      const result = ingestWorkbookBuffer(buf, file.name);
      const nextReport = validateWorkbook(result.sheets, { industry, domain, ruleConfig });
      const fileHash = await sha256ArrayBuffer(buf);
      const governedOutputHash = computeWorkbookHash(result.sheets);
      setPersistenceLoadWarning(null);
      setSourceSheets(result.sheets);
      setApprovedCorrections([]);
      setActiveSheet(result.activeSheet);
      setWorkbookSource(
        `${file.name} (${result.totalRows} rows across ${result.sheetCount} sheets • Source SHA-256 ${fileHash.slice(0, 19)}…)`
      );
      setWarningSignOff(null);
      setActiveModule('m01');
      setLineageHistory((prev) => [
        {
          id: `LIN-${String(prev.length + 1).padStart(3, '0')}`,
          fileName: file.name,
          fileHash,
          governedOutputHash,
          sourceVersion: prev.length + 1,
          uploadStatus: 'ACTIVE',
          uploadedAt: formatNow(),
          sheetCount: result.sheetCount,
          totalRows: result.totalRows,
          domain,
          industry,
        },
        ...(prev.length > 0 && prev[0].uploadStatus !== 'REJECTED'
          ? [{ ...prev[0], uploadStatus: 'SUPERSEDED' as const }, ...prev.slice(1)]
          : prev),
      ]);
      addAudit(
        'Client Workbook Ingested',
        `${file.name} (Source SHA-256 ${fileHash.slice(0, 19)}…)`,
        `${result.totalRows} rows across ${result.sheetCount} sheets (${nextReport.exceptions.length} exceptions)`,
        undefined,
        undefined,
        governedOutputHash
      );
      showToast(
        `Ingested ${result.totalRows} rows across ${result.sheetCount} worksheet(s) from ${file.name}`
      );
    } catch (err) {
      showToast(err instanceof Error ? `Upload rejected: ${err.message}` : 'Could not parse uploaded .XLSX or .CSV file');
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
      sourceWorkbookHash,
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
          {persistenceLoadWarning && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 space-y-1"
            >
              <div className="font-bold">Saved workbook not restored</div>
              <p>{persistenceLoadWarning}</p>
            </div>
          )}

          {toastMsg && (
            <div
              role="status"
              className="fixed bottom-5 right-5 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2 border border-slate-700"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{toastMsg}</span>
            </div>
          )}

          <Suspense
            fallback={
              <div className="card p-6 text-sm text-slate-500">
                Loading planning assurance module…
              </div>
            }
          >
          {activeModule === 'm01' ? (
            <Step1DataAssurance
              industry={industry}
              domain={domain}
              onDomainChange={handleDomainChange}
              onLoadDomainDataset={handleLoadDomainDataset}
              ruleConfig={ruleConfig}
              onUpdateRuleConfig={handleUpdateRuleConfig}
              onResetRuleConfig={handleResetRuleConfig}
              sourceSheets={sourceSheets}
              governedSheets={governedSheets}
              report={report}
              profileReport={profileReport}
              reconciliationReport={reconciliationReport}
              schemaDrift={schemaDrift}
              lineageHistory={lineageHistory}
              exceptionAssignments={exceptionAssignments}
              onAssignException={handleAssignException}
              onRemediateStructure={handleRemediateStructure}
              onApplyColumnMapping={handleApplyColumnMapping}
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
          </Suspense>
        </main>
      </div>

      {reviewingException && (
        <Suspense fallback={null}>
          <CorrectionApprovalModal
            exception={reviewingException}
            onClose={() => setReviewingException(null)}
            onApprove={handleApproveCorrection}
          />
        </Suspense>
      )}

      {signOffModalOpen && (
        <Suspense fallback={null}>
          <WarningSignOffModal
            open={signOffModalOpen}
            warningCount={gate.warningCount}
            onClose={() => setSignOffModalOpen(false)}
            onConfirm={handleConfirmWarningSignOff}
          />
        </Suspense>
      )}

      {copilotOpen && (
        <Suspense fallback={null}>
          <CopilotDrawer
            open={copilotOpen}
            onClose={() => setCopilotOpen(false)}
            errors={report.exceptions}
          />
        </Suspense>
      )}
    </div>
  );
}
