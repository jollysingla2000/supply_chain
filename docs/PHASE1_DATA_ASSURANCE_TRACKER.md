# Phase 1 — Enterprise Planning Data Assurance: Capability Tracker

**Working target:** `main` (direct commits; no feature-branch workflow)  
**Purpose:** Track implementation, measurable verification, open defects and certification evidence for all 26 capabilities.  
**Certification rule:** No capability is complete until requirements are traceable to implementation and tests, positive/negative/boundary/hostile cases are exercised where applicable, cross-domain regressions pass, performance limits are measured, and evidence is tied to a commit and CI run. “Foolproof” is not an absolute guarantee.

## Current evidence status

- **Last known green integrated CI run:** [GitHub Actions #606](https://github.com/jollysingla2000/supply_chain/actions/runs/44453622091), commit `283311bc6c06ba2c073f03704b70aed840b91bf9`, 2026-11-19 03:47 UTC (60/60 engine tests, 9/9 browser E2E tests, TypeScript, production build and dependency audit passed).
- **Current local verification on working tree (2026-11-20 UTC, post-audit remediation):**
  - **64/64 engine unit tests passing** (`npm run test:coverage`)
  - **10 browser E2E test specifications** in `e2e/data-assurance-upload.spec.ts` (9 baseline + 1 new mutation-boundary E2E spec)
  - **Clean TypeScript check** (`npm run lint`) and **clean production build** (`npm run build`)
  - *Note:* Local working-tree verification does not replace an integrated GitHub Actions CI run on `main`. Until these changes are pushed and receive a new CI run ID + commit SHA on `main`, CI #606 remains the last known green integrated CI run.
- **Measured engine coverage baseline (`npm run test:coverage`, 64 engine tests, Node.js test runner experimental coverage):**

| Engine module | Line % | Branch % | Function % | Primary capabilities served |
|---|---:|---:|---:|---|
| `src/engine/schema.ts` | 100.00% | 85.71% | 100.00% | #9, #10, #11, #15, #16, #20–#25 |
| `src/engine/security.ts` | 100.00% | 60.00% | 100.00% | #1, #13, #26A |
| `src/engine/formulaTests.ts` | 99.63% | 41.18% | 100.00% | #17, #19 |
| `src/engine/validation.ts` | 95.70% | 83.14% | 96.12% | #7, #8, #9, #13, #14, #15, #16, #18, #19, #20–#25, #26A |
| `src/engine/calculations.ts` | 93.46% | 77.45% | 100.00% | #17, #18, #19, #20–#25 |
| `src/engine/profilingAndReconciliation.ts` | 90.24% | 73.86% | 71.97% | #3, #4, #5, #6, #7, #8, #10, #11, #12, #17, #26A |
| `src/engine/workbook.ts` | 88.89% | 70.11% | 95.24% | #1, #2, #3 |
| **All loaded engine files (`src/engine/*`)** | **95.64%** | **81.10%** | **90.89%** | Aggregate engine baseline (64/64 unit tests) |

- **Capability-level test mapping:** All 64 engine unit tests in `src/engine/engine.test.ts` and 10 E2E scenarios in `e2e/data-assurance-upload.spec.ts` are mapped in the table below by primary module coverage and test category (`P` = positive, `N` = negative, `B` = boundary, `H` = hostile/tamper).
- **Defect baseline:** Initial repository audit triaged 4 defects (`DA-001` Critical, `DA-002` High, `DA-003` Medium, `DA-004` Low) in [the Phase 1 defect register](PHASE1_DEFECT_REGISTER.md). All 4 are `Fixed Pending CI Verification` with dedicated regression tests. Full scale-benchmark and domain-onboarding defect triage remains in progress.
- **Certified capabilities:** **0/26**. Implementation presence, measured coverage, and passing tests do not by themselves establish certification until CI run evidence, performance benchmarks, and named business-owner sign-offs (`certifiedBy` / `certifiedAt`) are recorded per [the Phase 1 certification standard](PHASE1_CERTIFICATION_STANDARD.md).
- Client-only constraints remain: current persistence is browser-local; user identity is not server-authenticated; audit records are not immutable server records; multi-user concurrency and enterprise SSO are not implemented.

## 26-capability status

Each capability below lists the measured line/branch/function coverage of its primary engine module(s), the mapped automated test counts from `src/engine/engine.test.ts` (`Unit`) and `e2e/data-assurance-upload.spec.ts` (`E2E`) broken down by category (`P/N/B/H`), and the live defect status from [PHASE1_DEFECT_REGISTER.md](PHASE1_DEFECT_REGISTER.md). Module coverage is shared across capabilities implemented in the same file.

| # | Capability | Implementation state | Primary module line / branch / func coverage | Mapped test counts (Unit + E2E; P/N/B/H) | Open / pending-CI defects | Main certification gap |
|---:|---|---|---|---|---|---|
| 1 | Workbook upload and ingestion | Implemented; in verification | `workbook.ts`: 88.89% / 70.11% / 95.24%<br>`security.ts`: 100.00% / 60.00% / 100.00% | 6 Unit + 3 E2E (`3P / 3N / 1B / 2H`) | 0 open (scale triage pending) | Hostile archive expansion, malformed ZIP resilience, representative large-file runtime and memory benchmarks. |
| 2 | Multi-sheet detection and ingestion | Implemented; in verification | `workbook.ts`: 88.89% / 70.11% / 95.24% | 5 Unit + 2 E2E (`2P / 3N / 1B / 1H`) | 0 open (scale triage pending) | Hidden-sheet semantics, very wide sheets, duplicate canonical mappings and export/import scale tests. |
| 3 | Source identity and fingerprint | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 7 Unit + 3 E2E (`3P / 3N / 1B / 3H`) | 0 open; 2 Fixed Pending CI (`DA-001`, `DA-002`) | CI run verification of new mutation-boundary and export-envelope tests; server-side signature attestation. |
| 4 | Source workbook persistence and recovery | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 5 Unit + 2 E2E (`2P / 2N / 2B / 1H`) | 0 open (quota triage pending) | Large-storage failure, interrupted writes and durable server-side persistence. |
| 5 | Dataset versioning and upload lineage | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 5 Unit + 3 E2E (`3P / 2N / 2B / 1H`) | 0 open; 2 Fixed Pending CI (`DA-001`, `DA-002`) | Multi-version comparison diff UI, retention policy, and immutable server-side hash+version storage. |
| 6 | Column-level profiling | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 4 Unit + 1 E2E (`2P / 1N / 2B / 0H`) | 0 open (scale triage pending) | Null/outlier/large-data matrix and profiling-to-validation consistency across all domain fixtures. |
| 7 | Actual data-type inference | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97%<br>`validation.ts`: 95.70% / 83.14% / 96.12% | 4 Unit + 0 E2E (`1P / 1N / 2B / 0H`) | 0 open (locale triage pending) | Field-level locale, precision, mixed/empty and date/number ambiguity matrix. |
| 8 | Missing values and null analysis | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 5 Unit + 1 E2E (`2P / 2N / 1B / 1H`) | 0 open (matrix triage pending) | Explicit NULL vs empty string vs whitespace vs sentinel vs formula-empty matrix. |
| 9 | Schema and mandatory-column validation | Implemented; in verification | `schema.ts`: 100.00% / 85.71% / 100.00%<br>`validation.ts`: 95.70% / 83.14% / 96.12% | 7 Unit + 2 E2E (`3P / 3N / 2B / 1H`) | 0 open (domain triage pending) | Every table/column contract and mandatory-versus-optional rule × domain outcome. |
| 10 | Schema drift detection | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 5 Unit + 2 E2E (`2P / 2N / 2B / 1H`) | 0 open; 1 Fixed Pending CI (`DA-001`) | Alias, rename, conflicting mapping and backwards-compatibility matrix. |
| 11 | Column mapping and collision prevention | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 6 Unit + 1 E2E (`2P / 2N / 1B / 2H`) | 0 open; 1 Fixed Pending CI (`DA-001`) | Unicode normalization, locale and conflicting target-column edge cases. |
| 12 | Missing-table/column remediation | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 5 Unit + 2 E2E (`2P / 2N / 2B / 1H`) | 0 open; 1 Fixed Pending CI (`DA-001`) | Full table/column remediation rollback/undo UI and multi-step re-run regression. |
| 13 | Data type, format and value validation | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`security.ts`: 100.00% / 60.00% / 100.00% | 8 Unit + 1 E2E (`2P / 3N / 2B / 2H`) | 0 open (locale triage pending) | Exhaustive field precision, locale, boundary and malformed-value matrix. |
| 14 | Duplicate and business-key validation | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12% | 6 Unit + 1 E2E (`2P / 2N / 2B / 1H`) | 0 open (matrix triage pending) | Compound/cross-table keys, whitespace/case, deleted rows, duplicate history and idempotent remediation. |
| 15 | Date, period and time-series integrity | Implemented; in verification | `schema.ts`: 100.00% / 85.71% / 100.00%<br>`validation.ts`: 95.70% / 83.14% / 96.12% | 7 Unit + 0 E2E (`2P / 2N / 3B / 0H`) | 0 open (calendar triage pending) | Timezone, fiscal calendar, leap-year, period continuity and date-system round-trip matrix. |
| 16 | Master-data and referential integrity | Implemented; in verification | `schema.ts`: 100.00% / 85.71% / 100.00%<br>`validation.ts`: 95.70% / 83.14% / 96.12% | 7 Unit + 1 E2E (`2P / 4N / 2B / 0H`) | 0 open (FK catalog triage pending) | Complete relationship catalog and positive/orphan tests for every domain FK. |
| 17 | Cross-table reconciliation | Implemented; in verification | `profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97%<br>`formulaTests.ts`: 99.63% / 41.18% / 100.00% | 12 Unit + 1 E2E (`4P / 4N / 5B / 0H`) | 0 open (`DEC-REC03-001`, `DEC-RECCERT-001` open) | Formal rule contracts (`REC-01`..`REC-05`) and fixtures exist; requires human business-owner sign-off (`certifiedBy`/`certifiedAt`). |
| 18 | UOM, currency and quantity consistency | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`calculations.ts`: 93.46% / 77.45% / 100.00% | 5 Unit + 0 E2E (`2P / 2N / 1B / 0H`) | 0 open (conversion triage pending) | Conversion chains, mixed units, precision/rounding, currency/rate validity and missing-rate policies. |
| 19 | Business constraints and domain rules | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`calculations.ts`: 93.46% / 77.45% / 100.00% | 10 Unit + 1 E2E (`3P / 4N / 4B / 0H`) | 0 open (policy triage pending) | Policy provenance, override authorization, effective dates, boundaries and complete rule inventory. |
| 20 | Demand Planning Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 6 Unit + 2 E2E (`3P / 3N / 2B / 0H`) | 0 open (domain gate pending) | End-to-end supported-domain gate: schema, keys, dependencies, rule matrix, fixtures and owner sign-off. |
| 21 | Supply Planning Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 6 Unit + 1 E2E (`2P / 3N / 2B / 0H`) | 0 open (domain gate pending) | Complete table relationships, dependency graph, scenario fixtures and domain regression matrix. |
| 22 | S&OP Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 5 Unit + 1 E2E (`2P / 2N / 2B / 0H`) | 0 open (domain gate pending) | Integrated scenario/master-data coverage and cross-domain end-to-end fixtures. |
| 23 | MEIO Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 6 Unit + 1 E2E (`2P / 3N / 2B / 0H`) | 0 open (domain gate pending) | Network/echelon completeness, master relationships, policy fixtures and regression matrix. |
| 24 | Procurement Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 8 Unit + 2 E2E (`3P / 4N / 3B / 0H`) | 0 open (domain gate pending) | Full contract effective-date, PO, receipt, supplier substitution and unmatched-source scenarios. |
| 25 | Manufacturing Data Assurance | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`schema.ts`: 100.00% / 85.71% / 100.00% | 7 Unit + 1 E2E (`2P / 4N / 2B / 0H`) | 0 open (domain gate pending) | Routing, work-center shifts/calendars, shared capacity, alternate BOM and edge-case fixture coverage. |
| 26A | Certification engine: release gate, evidence matrix and audit linkage | Implemented; in verification | `validation.ts`: 95.70% / 83.14% / 96.12%<br>`profilingAndReconciliation.ts`: 90.24% / 73.86% / 71.97% | 9 Unit + 4 E2E (`4P / 4N / 2B / 3H`) | 0 open; 4 Fixed Pending CI (`DA-001`..`DA-004`) | Authenticated immutable server-side audit/evidence storage and CI run verification of mutation-boundary fixes. |
| 26B | Governance UI and workflow coverage | Implemented; in verification | Covered via Playwright browser E2E (`e2e/data-assurance-upload.spec.ts`) | 2 Unit + 10 E2E (`5P / 4N / 2B / 1H`) | 0 open; 2 Fixed Pending CI (`DA-001`, `DA-002`) | Broader remediation undo/reversal UI paths and accessibility/usability regression. |

**Interpretation:** Module coverage percentages above come directly from `npm run test:coverage` (64 engine unit tests). Because multiple capabilities share core engine modules (`validation.ts`, `profilingAndReconciliation.ts`, `schema.ts`, `workbook.ts`), module-level coverage is an objective baseline for the underlying code rather than an isolated per-capability guarantee. Certified count remains **0/26** until all requirements in [PHASE1_CERTIFICATION_STANDARD.md](PHASE1_CERTIFICATION_STANDARD.md) are met.

## Priority plan

| Priority | Scope | Exit condition |
|---|---|---|
| **P1a — Critical foundation** | #1–#5, #17 and #26A | Dataset ingestion/identity/lineage, mutation-boundary enforcement, reconciliation contracts, validation matrix and release gate are evidenced end-to-end in CI. |
| **P1b — Data integrity** | #8, #12, #14, #15 and #16 | Missingness, remediation, duplicate keys, date integrity and referential integrity have complete negative/boundary tests. |
| **P2 — Validation and business rules** | #6, #7, #9, #10, #11, #13, #18 and #19 | Measured coverage and complete field/locale/rule test matrices exist. |
| **P3 — Planning domain certification** | #20–#25 | Each domain passes the onboarding gate in [the domain support matrix](PHASE1_DOMAIN_SUPPORT_MATRIX.md). |
| **P4 — Remaining governance UI** | #26B | Broader user workflows and UI regression/accessibility evidence pass. |

P1a and P1b are ordered milestones, not claims that lower-priority safeguards can be ignored.

## Mandatory requirement traceability: A–D

| Requirement | Meaning | Capabilities | Mandatory evidence |
|---|---|---|---|
| **A — Dataset identity and lineage** | A source dataset is identified by a stable hash (`sourceWorkbookHash`) and monotonically advancing version (`datasetVersion`). Corrections, approvals, sign-offs, exports (`exportSchemaVersion: '1.0'`), audit events and re-imports retain the same explicit dataset identity/version or are rejected as mismatched. In-app structural remediation and column mapping execute through `executeGovernedDatasetMutation`, incrementing `datasetVersion`, clearing `warningSignOff`, re-binding only demonstrably unaffected corrections with preserved original approval provenance, and marking affected/unprovable corrections `INVALIDATED_BY_REMEDIATION` (which blocks the release gate). | #3, #4, #5, #10, #11, #12, #26A, #26B | Hash + version fields; tamper/mismatch tests; mutation-boundary re-bind vs invalidation tests; correction → approval → remediation → export → re-import lineage sequence; rollback and replay evidence. |
| **B — Validation coverage matrix** | Every configured rule is evaluated against each applicable domain/dataset and reports `NOT_RUN`, `PASSED`, `FAILED`, `PARTIAL` or `SKIPPED(reason)`. Missing mandatory sources block release; optional missing sources are explicitly skipped with a reason and do not masquerade as executed checks. | #9, #16, #20–#26A | Rule × domain × dataset matrix; required/optional source tests; proof no missing mandatory check can become a pass; release-gate integration. |
| **C — Reconciliation rule contracts** | Every REC rule (`REC-01`..`REC-05` in `RECONCILIATION_RULE_CONTRACTS`) has a documented rule version, business purpose, owner role, equation, grain, units, tolerance, effective-date policy, exclusions, source fields, null-denominator behavior, partial-source behavior, certification metadata (`certifiedBy`, `certifiedAt`), and independent expected-result fixtures. | #17, #26A | Independent calculation fixtures; zero-denominator and partial-source cases; `certifiedBy` / `certifiedAt` evidence (null until human owner sign-off); rule-version linkage. |
| **D — Domain onboarding completeness** | A domain is labelled **SUPPORTED** only when its schema, mandatory/optional tables, keys, dependencies, business rules, fixtures and positive/negative/boundary tests are complete. | #20–#25, #26A | Domain-by-domain onboarding matrix and automated gate in [PHASE1_DOMAIN_SUPPORT_MATRIX.md](PHASE1_DOMAIN_SUPPORT_MATRIX.md). An implemented contract alone does not mean a domain is supported. |

## Defect and risk accounting

The live severity counts and individual defect records (`DA-001` through `DA-004`) are maintained in [the Phase 1 defect register](PHASE1_DEFECT_REGISTER.md).

Certification policy:
- No unresolved open Critical defect.
- High defects must be fixed or explicitly risk-accepted by an accountable owner with a due date and compensating control.
- Medium/Low defects require an owner, target date and documented disposition.
- Every defect must have a reproducible scenario, affected requirement/capability, fix commit and regression test when closed.

## Performance and scale targets

Existing hard ingestion bounds are 100 MB per workbook, 100 worksheets, 1,000 columns per sheet, 500,000 total rows and 5,000,000 estimated cells. These are input guardrails, not performance evidence.

The initial engineering SLO proposals below must be benchmarked on a named, repeatable CI runner and reviewed before being treated as certification limits:

| Workload | Test profile | Proposed target |
|---|---|---|
| Small | ≤10 MB and ≤100,000 cells | p95 ingest + profiling + validation ≤10 seconds; peak process RSS ≤1 GiB |
| Medium | ≤50 MB and ≤1,000,000 cells | p95 ≤45 seconds; peak process RSS ≤2 GiB |
| Maximum supported | ≤100 MB and ≤5,000,000 cells, subject to all existing row/sheet/column bounds | p95 ≤180 seconds; peak process RSS ≤3 GiB |

Measure parse/ingest, profiling, validation, reconciliation, export/re-import and browser interaction separately. Record runner image, CPU/memory, Node/browser versions, fixture hash, repetitions, elapsed time and peak RSS. These targets are proposals until benchmark results and an accountable owner sign-off exist. If a limit is not achievable safely, reduce the supported workload rather than silently weakening resource protection.

## Cross-domain regression model

The baseline domain set is the six primary planning domains: Demand, Supply, S&OP, MEIO, Procurement and Manufacturing. Regression evidence must cover each domain's mandatory/relevant/master tables, declared foreign keys, required validation categories and all applicable REC rules. The full matrix is defined in [the domain support matrix](PHASE1_DOMAIN_SUPPORT_MATRIX.md).

Inventory/Replenishment is provisionally treated as a shared data capability within Supply and MEIO, not an additional independent domain. IBP is provisionally treated as cross-domain orchestration, not a seventh independent domain. This classification requires business-owner confirmation before final domain certification.

## Architecture blockers (not solvable by client-only patches)

- Server-authenticated identity and role/permission enforcement.
- Immutable server-side audit with durable retention and tamper evidence.
- Durable server-side dataset/version storage and recovery.
- Multi-user concurrency and conflict resolution.
- Enterprise SSO and access lifecycle.

These must be tracked as architecture work with owners and acceptance tests. Do not mark them complete based on browser-local behavior.

## Change control

1. Work directly against `main`; before each write, fetch the current file SHA and preserve all unrelated changes.
2. Make narrow, test-backed edits. Never replace a newer user commit with an older branch snapshot.
3. Each code change requires current CI evidence tied to the exact resulting commit.
4. Update capability states only from test output, review evidence, defect register and domain matrix—not from estimates.
5. A capability is certified only when all relevant A–D requirements, defect policy, performance requirements and cross-domain regressions are satisfied.
