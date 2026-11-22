# Phase 1 Defect Register

**Repository:** `jollysingla2000/supply_chain`  
**Working target:** `main`  
**Triage state:** **INITIAL FOUR AUDIT FINDINGS CI-VERIFIED; FOLLOW-UP DA-005 CI-VERIFIED; CAPABILITY 1 INTEGRATED CI #764 GREEN; REMAINING CRC/COMBINED-BOUNDARY/SERVER-ARCHITECTURE/PERFORMANCE-REPEATABILITY TRIAGE IN PROGRESS**.  
The initial Requirement A–D audit findings (`DA-001` through `DA-004`) passed their dedicated regression/repository checks in CI runs #633 and #636. A follow-up correction-reapproval guard (`DA-005`) passed in CI #659. The latest integrated verification is [run #764](https://github.com/jollysingla2000/supply_chain/actions/runs/45026087817) on commit `7b0f438f83e097973e232306c06ddb69e67ac53b` (89/89 engine tests, 13/13 browser E2E, TypeScript, production build, ingestion benchmarks and evidence artifact all passed). The Markdown link checker validates local file targets; it does not validate anchors. This is not a full 26-capability defect-free audit; fine-grained rule inventory, domain, maximum-upload/round-trip, authenticated server evidence and architecture triage remain in progress.

## Capability severity summary

| # | Capability | Open Critical | Open High | Open Medium | Open Low | Verified findings (see individual records) | Last defect fixed (UTC date) | Triage status |
|---:|---|---:|---:|---:|---:|---:|---|---|
| 1 | Workbook upload and ingestion | 0 | 0 | 0 | 0 | 0 | Not recorded | #764 verifies path-traversal/duplicate ZIP rejection, malformed XLSX state preservation, interrupted browser-local persistence recovery, exact 100 MiB/+1 byte boundaries and 100K/1M/5M-cell performance. Remaining: actual decompressed-payload CRC validation/parser-exception behaviour, combined 100 MiB + maximum-cell workload, maximum-scale browser persistence, durable server persistence, controlled-runner repeatability. |
| 2 | Multi-sheet detection and ingestion | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; hidden/wide-sheet matrix pending |
| 3 | Source identity and fingerprint | 0 | 0 | 0 | 0 | 2 (`DA-001`, `DA-002`) | 2026-11-20 | Mutation & export identity triaged; regression-tested |
| 4 | Source workbook persistence and recovery | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | #764 verifies ordinary reload, corrupt-state recovery, visible quota failure and interrupted-write recovery to prior browser-local state; max-scale and server-side durable persistence remain open. |
| 5 | Dataset versioning and upload lineage | 0 | 0 | 0 | 0 | 3 (`DA-001`, `DA-002`, `DA-005`) | 2026-11-21 | Mutation version increment, export lineage and correction reapproval guard CI-verified |
| 6 | Column-level profiling | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; large-data matrix pending |
| 7 | Actual data-type inference | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; locale ambiguity matrix pending |
| 8 | Missing values and null analysis | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; sentinel/formula-empty matrix pending |
| 9 | Schema and mandatory-column validation | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; exhaustive domain matrix pending |
| 10 | Schema drift detection | 0 | 0 | 0 | 0 | 1 (`DA-001`) | 2026-11-20 | Drift remediation mutation boundary triaged |
| 11 | Column mapping and collision prevention | 0 | 0 | 0 | 0 | 1 (`DA-001`) | 2026-11-20 | Mapping mutation boundary & correction invalidation triaged |
| 12 | Missing-table/column remediation | 0 | 0 | 0 | 0 | 1 (`DA-001`) | 2026-11-20 | Structural remediation mutation boundary triaged |
| 13 | Data type, format and value validation | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; boundary/locale matrix pending |
| 14 | Duplicate and business-key validation | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; cross-table duplicate matrix pending |
| 15 | Date, period and time-series integrity | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; fiscal/timezone matrix pending |
| 16 | Master-data and referential integrity | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; full FK orphan matrix pending |
| 17 | Cross-table reconciliation | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Rule contracts (`REC-01`..`REC-05`) codified; owner sign-off pending |
| 18 | UOM, currency and quantity consistency | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; multi-hop conversion matrix pending |
| 19 | Business constraints and domain rules | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Initial audit done; policy provenance matrix pending |
| 20 | Demand Planning Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 21 | Supply Planning Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 22 | S&OP Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 23 | MEIO Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 24 | Procurement Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 25 | Manufacturing Data Assurance | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 (Initial) | 0 | Not recorded | Onboarding gate verification in progress |
| 26A | Certification engine: release gate, evidence matrix and audit linkage | 0 | 0 | 0 | 0 | 5 (`DA-001`..`DA-005`) | 2026-11-21 | Release gate, mutation audit, reapproval guard & CI evidence triaged; fine-grained B matrix remains open |
| 26B | Governance UI and workflow coverage | 0 | 0 | 0 | 0 | 2 (`DA-001`, `DA-002`) | 2026-11-20 | Ledger status badges, rule contract cards & audit export triaged |

## Defect records

### DA-001 — In-app structural remediation and column mapping mutate dataset hash without advancing dataset version or re-evaluating correction dependencies
| Field | Content |
|---|---|
| Defect ID | `DA-001` |
| Capability / requirement | Capabilities #3, #5, #10, #11, #12, #26A, #26B — **Requirement A (Dataset identity and lineage)** |
| Severity | **Critical** |
| Description | `handleRemediateStructure` and `handleApplyColumnMapping` in `src/App.tsx` mutated `sourceSheets` in place, changing `sourceWorkbookHash`, while leaving `datasetVersion` unchanged, keeping `warningSignOff` active, and leaving existing `ApprovedCorrection` records bound to the pre-remediation hash. Under `strictHashBinding: true`, all prior corrections silently ceased applying without invalidation status or release-gate blocking. |
| Reproduction | Approve corrections on v1 dataset (`computeCanonicalWorkbookHash(sheets)`), invoke structural remediation or column mapping that alters `sourceSheets`, and inspect `datasetVersion`, `warningSignOff`, `approvedCorrections`, and `evaluateReleaseGate`. Expected: version increments, sign-off clears, unaffected corrections re-bind with immutable original provenance, affected/unprovable corrections become `INVALIDATED_BY_REMEDIATION` and block release. Actual before fix: version stayed `1`, sign-off persisted, and corrections silently orphaned. |
| Owner / target date | Data Assurance Engineering / 2026-11-20 |
| Status | **CI-verified (run #636)** |
| Fix evidence | Implemented `executeGovernedDatasetMutation` and `evaluateCorrectionDependencyOnMutation` in `src/engine/profilingAndReconciliation.ts`; blocked release on `INVALIDATED_BY_REMEDIATION` in `src/engine/validation.ts`; wired `src/App.tsx` and `src/components/Step1DataAssurance.tsx`. Regression tests: `Requirement A mutation boundary: structural remediation and column mapping increment datasetVersion, clear warningSignOff, re-bind demonstrably unaffected corrections with immutable provenance, invalidate affected or unprovable corrections, and block release gate` (`src/engine/engine.test.ts`) and `structural remediation advances datasetVersion and records DATASET_MUTATED_BY_REMEDIATION in audit export` (`e2e/data-assurance-upload.spec.ts`). |
| Verification | Passed in GitHub Actions [run #636](https://github.com/jollysingla2000/supply_chain/actions/runs/44797571269) on commit `9dba612a22da9f92d79cb1f6c78679f4077f5287` (66/66 engine tests; mutation-boundary regression passed). The mutation audit record now preserves complete previous/new hashes and versions. |

### DA-002 — Audit Log JSON export envelope omits `activeDatasetVersion` and `exportSchemaVersion`
| Field | Content |
|---|---|
| Defect ID | `DA-002` |
| Capability / requirement | Capabilities #3, #5, #26A, #26B — **Requirement A (Dataset identity and lineage)** |
| Severity | **High** |
| Description | `handleExportAudit` in `src/components/OtherModules.tsx` exported `exportedAt`, `activeDatasetHash`, and `logs`, but did not receive `datasetVersion` from `src/App.tsx` and omitted `activeDatasetVersion` and `exportSchemaVersion` from the top-level JSON envelope. |
| Reproduction | Navigate to Step 6 (`Value & Audit Trail`) and click `Export Audit Log (JSON)`. Expected: top-level JSON envelope contains `exportSchemaVersion: '1.0'`, `activeDatasetHash`, and `activeDatasetVersion`. Actual before fix: `activeDatasetVersion` and `exportSchemaVersion` were missing from the envelope. |
| Owner / target date | Data Assurance Engineering / 2026-11-20 |
| Status | **CI-verified (run #633)** |
| Fix evidence | Added `buildAuditLogExportEnvelope` in `src/engine/profilingAndReconciliation.ts`, passed `datasetVersion` from `src/App.tsx` to `src/components/OtherModules.tsx`, and displayed `v{datasetVersion}` in Step 6. Regression tests: `Audit Log JSON export envelope includes exportSchemaVersion, activeDatasetHash, and activeDatasetVersion` (`src/engine/engine.test.ts`) and `uploads an unmapped multi-sheet workbook, applies canonical column mapping, persists across reload, and exports audit JSON` (`e2e/data-assurance-upload.spec.ts`). |
| Verification | Passed in GitHub Actions [run #633](https://github.com/jollysingla2000/supply_chain/actions/runs/44796735161) on commit `2820171f23f38dde876dba484fc433a8cddeb309` (audit export unit and browser E2E regressions passed). |

### DA-003 — GitHub Actions dependency audit step exits before generating JSON report and uploading diagnostic artifact
| Field | Content |
|---|---|
| Defect ID | `DA-003` |
| Capability / requirement | Capability #26A — **CI verification evidence integrity** |
| Severity | **Medium** |
| Description | In `.github/workflows/phase1-validation.yml`, the `Report dependency audit findings` step executed `npm audit --audit-level=low` prior to `npm audit --json > npm-audit.json`. Under `set -e`, any low/moderate vulnerability caused the step to exit immediately before generating `npm-audit.json` or printing the diagnostic table, and `npm-audit.json` was not included in the `if: always()` artifact upload step. |
| Reproduction | Run the `Report dependency audit findings` shell block when any package reports a vulnerability at `low` or above. Expected: `npm-audit.json` is written, summary counts are printed to job logs, `npm-audit.json` is uploaded as a workflow artifact, and the step then exits non-zero. Actual before fix: step aborted on the first command before creating `npm-audit.json`. |
| Owner / target date | Data Assurance Engineering / 2026-11-20 |
| Status | **CI-verified (run #633)** |
| Fix evidence | Updated `.github/workflows/phase1-validation.yml` to capture `audit_exit` from `npm audit --audit-level=low --json > npm-audit.json || audit_exit=$?`, print the summary via Node, exit with `$audit_exit`, and upload `npm-audit.json` in `Upload verification and coverage evidence` (`if: always()`). |
| Verification | Passed in GitHub Actions [run #633](https://github.com/jollysingla2000/supply_chain/actions/runs/44796735161): normal audit reported zero vulnerabilities; injected high-severity failure fixture retained the JSON report, printed diagnostics and propagated non-zero exit status. |

### DA-004 — Tracker source-of-truth duplication and broken relative markdown links
| Field | Content |
|---|---|
| Defect ID | `DA-004` |
| Capability / requirement | Capability #26A — **Documentation and traceability integrity** |
| Severity | **Low** |
| Description | The root and docs tracker previously carried duplicate status content, and links within `/docs/PHASE1_DATA_ASSURANCE_TRACKER.md` were relative to `docs/`, yielding invalid `/docs/docs/...` paths. The stale root tracker has been deleted so `/docs/PHASE1_DATA_ASSURANCE_TRACKER.md` is the single source of truth, and docs-local links use the correct same-directory paths. |
| Reproduction | Follow links to the defect register or domain support matrix from `/docs/PHASE1_DATA_ASSURANCE_TRACKER.md`. Expected: relative links resolve to `/docs/PHASE1_DEFECT_REGISTER.md` and `/docs/PHASE1_DOMAIN_SUPPORT_MATRIX.md`, with a single canonical tracker in `/docs/`. Actual before fix: duplicate root file and broken `/docs/docs/...` links. |
| Owner / target date | Data Assurance Engineering / 2026-11-20 |
| Status | **CI-verified (run #636)** |
| Fix evidence | Deleted root `/PHASE1_DATA_ASSURANCE_TRACKER.md`, retained `/docs/PHASE1_DATA_ASSURANCE_TRACKER.md` as the sole status source, and corrected relative links within `/docs/`. |
| Verification | Passed local Markdown link validation (`npm run lint:links` / `node scripts/check-doc-links.mjs`) and GitHub Actions [run #636](https://github.com/jollysingla2000/supply_chain/actions/runs/44797571269): all Markdown files scanned and all local file targets resolved. Anchor existence is not checked. |

### DA-005 — Changed-signature correction reapproval while an earlier correction remains invalidated
| Field | Content |
|---|---|
| Defect ID | `DA-005` |
| Capability / requirement | Capabilities #5 and #26A — **Requirement A (Dataset identity, correction lifecycle and release governance)** |
| Severity | **Low** |
| Description | After a governed dataset mutation invalidated an approved correction, the UI allowed a new approval with a different exception signature while retaining the earlier invalidated correction. The invalidated record continued to block the release gate, so this did not bypass release safety, but it could leave users with a misleading active approval while a previous remediation dependency still required explicit resolution. |
| Reproduction | Create an approved correction, run structural remediation that marks it `INVALIDATED_BY_REMEDIATION`, then attempt to approve a different exception signature. Expected: block the new approval until the prior invalidated correction is reviewed/reverted. Reapproval of the exact same exception signature may replace that invalidated record. |
| Owner / target date | Data Assurance Engineering / 2026-11-21 |
| Status | **CI-verified (run #659)** |
| Fix evidence | Added `getApprovalBlockingInvalidatedCorrectionIds` in `src/engine/profilingAndReconciliation.ts` and a guard in `src/App.tsx` `handleApproveCorrection`. Different-signature approvals are blocked while invalidated corrections remain; exact same-signature reapproval remains supported. Added unit test `Requirement A: changed-signature reapproval cannot bypass unresolved invalidated corrections` in `src/engine/engine.test.ts`, mapped to capabilities #5 and #26A in `scripts/capability-test-map.json`. |
| Verification | The new regression passed as part of 72/72 engine unit tests in [GitHub Actions #659](https://github.com/jollysingla2000/supply_chain/actions/runs/44869734392), exact commit `ce4eecc3c3fcfcc30e6d138b688c8120c3acb705`. |

## Known governance decisions requiring owner disposition

| ID | Area | Decision / risk | Severity | Owner | Due date | Status |
|---|---|---|---|---|---|---|
| DEC-RULEMATRIX-001 | Requirement B | Implemented a version-bound Rule × Domain × Dataset Version execution matrix for the six registered top-level validation groups, with `NOT_RUN`, `PASSED`, `FAILED`, `PARTIAL` and `SKIPPED(reason)`, rule version, domain, source hash/version, governed-output hash, required flag, reason and dependency counts. The release gate rejects stale/mismatched matrices and missing mandatory sources; browser-local audit snapshots are recorded. Six-domain tests (mandatory/optional gaps, optional skips and stale versions) passed in CI #646/#652. Still open: inventory and map every fine-grained enabled check instead of only six category-level groups, and replace browser-local snapshots with authenticated tamper-evident server evidence. | Medium | Data Assurance Engineering / Platform | Not set | PARTIALLY IMPLEMENTED — OPEN |
| DEC-CI-001 | Repository governance | `main` remains unprotected and has no required Phase 1 status checks; the available GitHub integration exposes branch-protection reads but no write operation. Enable required checks in GitHub repository settings before relying on CI as a merge/push control. | High | Repository Admin | Not set | OPEN |
| DEC-REC03-001 | REC-03 methodology | Technical safeguard implemented: default is now unapproved; a legacy boolean-only flag cannot approve the run-rate benchmark. Approval now requires `stockoutRunRateMethodApproved=true`, a named `stockoutRunRateMethodApprovedBy` and valid non-future `stockoutRunRateMethodApprovedAt`. The business owner must still review the formula, sign the methodology and confirm that the named approver is accountable. | Triage required | Demand & Inventory Assurance Business Owner | Not set | OPEN — business sign-off pending |
| DEC-SCOPE-001 | Domain support | Confirm Inventory/Replenishment as shared Supply/MEIO scope and IBP as cross-domain orchestration, or formally onboard either as a separate domain. | Triage required | Unassigned | Not set | OPEN |
| DEC-RECCERT-001 | REC-01..REC-05 certification | Contracts now expose version, purpose, owner, equation, grain, units, explicit tolerance threshold/application, source-field inventory, exclusions, effective-date policy, null-denominator and partial-source behavior. Independent positive/negative/zero-denominator/partial-source fixtures exist for all five rules. REC-01/02/04/05 are v1.2.0; REC-03 is v1.2.1. `certifiedBy: null` and `certifiedAt: null` remain until accountable human owners review and sign off each rule. | Triage required | Commercial / Finance / Supply / Manufacturing Owners | Not set | OPEN — human certification pending |

## Rules

- Do not record an empty backlog as “0 defects” until all 26 capabilities have been reviewed against requirements, tests, current main code and domain fixtures.
- A defect is closed only after a regression test reproduces the original failure and passes on the fix commit in CI.
- A Risk Accepted issue remains visible and must have an approver, reason, compensating control and expiry date.
- The summary counts must be reconciled against the individual defect records after every triage.
