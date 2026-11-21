# Phase 1 Certification Standard

## 1. Certification unit

A certification unit is one of the 26 capability groups (#1–#26) within one declared scope. Domain-specific capabilities (#20–#25) require evidence for each of the six primary planning domains, and a group is not certified until all applicable domain scopes pass. Capability #26 is reported as two evidence sub-areas (#26A certification engine and #26B governance UI), but those are rolled up to one #26 certification decision; the 27 measurement rows do not change the 26-group denominator. A green aggregate test suite is necessary but is not sufficient.

A capability may have one of these states:

- **NOT_STARTED** — no implementation evidence.
- **IMPLEMENTED** — code exists; verification may be incomplete.
- **IN_VERIFICATION** — tests and evidence are being collected.
- **BLOCKED** — a defect, architecture dependency or owner decision prevents certification.
- **CERTIFIED** — every mandatory criterion below is met.
- **RISK_ACCEPTED** — an accountable owner has signed a specific, time-bounded exception; this is not equivalent to CERTIFIED.

## 2. Mandatory gate

For each capability, retain:
1. Requirement IDs and implementation file/line references.
2. Positive, negative, boundary and hostile-input test cases as applicable.
3. Test counts and pass/fail/skip results by category.
4. Line, branch and function coverage for the relevant module(s), with uncovered critical paths explicitly reviewed.
5. Cross-domain regression results and exact domain/table fixture IDs.
6. Open Critical/High/Medium/Low defects, with owner and disposition.
7. Performance results for the relevant workload class.
8. Exact commit SHA, CI run URL/ID, UTC timestamp, runtime versions and evidence artifact references.
9. Reviewer/certifier identity, certification timestamp and rule version.
10. A documented limitation and rollback/recovery path.

No unresolved Critical defect is allowed. High defects require an explicit, time-limited risk acceptance and compensating control to proceed; that exception must be visible in the certificate. Test coverage percentage alone never certifies correctness.

## 3. Requirement traceability

### A — Dataset identity and lineage
A dataset has both a cryptographic content identity (`sourceWorkbookHash`, SHA-256 over canonical serialized workbook structure) and a monotonically distinguishable dataset version (`datasetVersion`). Corrections, approval records, warning sign-offs, exports, audit events and re-imports must retain both values. A mismatch, missing binding or version rollback must fail closed. Evidence includes replay, duplicate approval, tampering, export/re-import and rejected-upload rollback scenarios.

- **Governed Dataset Mutation Boundary (`executeGovernedDatasetMutation`):** Whenever an in-app structural remediation (`remediateMissingStructure`) or column mapping (`applyColumnMapping`) mutates `sourceSheets` and changes `sourceWorkbookHash`:
  1. `datasetVersion` increments monotonically (`v` → `v + 1`).
  2. Any existing `warningSignOff` is cleared (`null`) and must be re-executed against the mutated dataset.
  3. Existing `ACTIVE` corrections are evaluated via a fail-closed dependency policy (`evaluateCorrectionDependencyOnMutation`) that inspects target table, row identity (`_rowIndex`), business keys (`sku_id`, `depot_id`, `supplier_id`, `period`, `date`, `parent_sku_id`, `component_sku_id`, `po_id`), precondition values, fix-type catalog dependencies (`FIX_DEPENDENCY_CATALOG`), and cross-table master dependencies:
     - **Demonstrably unaffected corrections** are re-bound to `(nextWorkbookHash, nextDatasetVersion)` while preserving immutable original approval metadata (`originalSourceWorkbookHash`, `originalDatasetVersion`, `originalApprovedAt`, plus `revalidatedAt` and `revalidatedFromVersion`).
     - **Affected or unprovable corrections** transition to `status: 'INVALIDATED_BY_REMEDIATION'` with `invalidationReason`, `invalidatedAtVersion`, and `invalidatedByMutation`, retaining their original `(sourceWorkbookHash, datasetVersion)` binding.
  4. An `AuditEntry` with `action: 'DATASET_MUTATED_BY_REMEDIATION'` is recorded with previous/new hashes, previous/new versions, rebound correction IDs, invalidated correction IDs, and sign-off clearance state.
  5. The release gate (`evaluateReleaseGate`) blocks release (`status: 'BLOCKED'`, `step2Unlocked: false`) whenever any correction has `status === 'INVALIDATED_BY_REMEDIATION'`.
- **Audit Log JSON Export Envelope (`buildAuditLogExportEnvelope`):** Every exported audit artifact must wrap records in a versioned envelope containing `exportSchemaVersion: '1.0'`, `exportedAt`, `activeDatasetHash`, `activeDatasetVersion`, and `logs`.

### B — Rule execution coverage matrix
The matrix key is Rule × Domain × Dataset Version. Every enabled validation rule must resolve to a stable rule ID and expose: rule version, selected domain, source workbook hash, dataset version, governed-output hash, required/optional applicability, outcome, reason, attempted/executed counts and missing dependencies.

Allowed outcomes:
- `NOT_RUN`
- `PASSED`
- `FAILED`
- `PARTIAL`
- `SKIPPED(reason)`

A missing mandatory source is a blocking failure / not-run state and cannot count as a pass. An optional source may be skipped only when the contract explicitly declares it optional; the reason is persisted and visible. Unknown or ambiguous contract mapping must fail closed. The release gate must reject incomplete rule catalogs and any matrix whose dataset hash/version, domain, rule version or governed-output identity differs from the active governed dataset.

**Current implementation qualification:** the application currently registers six top-level validation groups in `VALIDATION_RULE_CATALOG`, creates dataset-bound outcomes for those groups, records snapshots in the browser-local governance audit ledger, and enforces identity/completeness in the release gate. The six-domain matrix regression passed in CI #646 and #649. This is not yet a complete fine-grained rule inventory: individual enabled checks still grouped inside those six categories must be mapped to stable rule IDs before Requirement B can be certified. Browser-local snapshots are not authenticated, immutable enterprise evidence; server-side durable storage remains an architecture requirement.

### C — Reconciliation rule contracts
Each reconciliation rule (`RECONCILIATION_RULE_CONTRACTS` for `REC-01`..`REC-05`) must declare:
- Unique rule ID and version (`ruleVersion`).
- Business purpose (`businessPurpose`) and accountable owner role (`owner`).
- Mathematical equation (`equation`), dimensions/grain (`grain`), explicit tolerance threshold and application (`toleranceThreshold`, `toleranceSpec`) and units (`units`).
- Source tables/columns (`sourceFields`), effective-date policy (`effectiveDatePolicy`) and exclusions (`exclusions`).
- Null/zero denominator (`nullDenominatorBehavior`) and partial-source behavior (`partialSourceBehavior`).
- Independent expected-result fixtures covering positive, negative, zero-denominator and partial-source boundary cases.
- `certifiedBy`, `certifiedAt`, commit SHA and CI run evidence (`certifiedBy` and `certifiedAt` must remain `null` in code until formal human business-owner certification is recorded). A named REC-03 methodology approver/date is a control over that optional benchmark, not a substitute for full REC-03 rule certification.

### D — Domain onboarding
A domain is **SUPPORTED** only after schema contracts, mandatory/optional tables, business keys, foreign keys, dependencies, business rules, positive/negative/boundary fixtures, user workflow and regression evidence all exist and pass. Any missing mandatory contract or required test blocks the support gate.

## 4. Coverage measurement policy

Use the Node.js test-runner line, branch and function coverage report for the engine files loaded by the engine suite. The aggregate currently includes `engine.test.ts` as well as implementation modules under `src/engine/`; unexecuted/unloaded modules must be tracked as unmeasured until included explicitly. Node's coverage flags are experimental in the Node 22 line; pin the CI runtime major version and record the exact Node patch version.

The per-capability report maps V8 execution to manually declared TypeScript source slices and validates named unit/E2E test mappings. Its line and function values are source-slice execution attribution. Its range-derived metric is a **V8 execution-range proxy, not conventional branch coverage**. Source slices may overlap and execution coverage is collected across the full engine suite, not isolated by mapped test. Report these limitations and uncovered critical paths; do not present the proxy as an independent branch-coverage guarantee.

Initial CI anti-regression floors are now enforced for every mapped capability: **70% source-slice line, 60% V8 execution-range proxy and 60% function coverage**. These floors were set just below the measured baseline and are intended only to stop severe regressions; they are not certification thresholds or proof of correctness. The V8 range measure is a proxy, not conventional branch coverage. Capability-specific and critical-path targets should be reviewed and raised as additional tests are added; lowering a floor requires a documented reason and owner review.

## 5. Cross-domain test matrix

For each of Demand, Supply, S&OP, MEIO, Procurement and Manufacturing, exercise:
- All mandatory tables and required columns.
- Optional table absent/present behavior.
- Every declared primary/business key and foreign key.
- Each required validation category.
- Applicable reconciliation rules and explicit NOT_APPLICABLE/NOT_RUN reasons.
- At least one valid fixture and one invalid/orphan/ambiguous fixture per required rule group.
- Remediation → revalidation → approval → export/re-import sequence where supported.

Inventory/Replenishment and IBP remain shared/cross-domain scopes until owners confirm whether they should be separately onboarded domains.

## 6. Defect policy

Defect records require a unique ID, capability and requirement, severity, reproduction fixture, owner, first-seen date, status, fix commit, regression test and verified-closed date. Counts must be generated from the live register. An untriaged item is not a zero-defect result.

## 7. Performance gate

Use the workload classes and provisional SLOs in the main capability tracker. Benchmark at least five repetitions for p95 reporting; record environment, fixture hash, elapsed phase timings and peak RSS. The maximum supported workload must be tested without exceeding memory/row/cell guardrails. A target remains provisional until measured and owner-approved.
