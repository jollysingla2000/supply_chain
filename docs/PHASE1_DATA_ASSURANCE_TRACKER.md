# Phase 1 — Enterprise Planning Data Assurance: Capability Tracker

**Working target:** `main` (direct commits; no feature-branch workflow)  
**Purpose:** Track implementation, measurable verification, open defects and certification evidence for all 26 capabilities.  
**Certification rule:** No capability is complete until requirements are traceable to implementation and tests, positive/negative/boundary/hostile cases are exercised where applicable, cross-domain regressions pass, performance limits are measured, and evidence is tied to a commit and CI run. “Foolproof” is not an absolute guarantee.

## Current evidence status

- **Unverified post-#664 code changes (2026-11-21):** release-gate Rule × Domain × Dataset matrix validation hardened in commits `c7a7ea9`, `5c2285f`, `45e2269`; regression coverage added in `c81dcf3`, `ff4bc18`, `7d2d3ce`. Checks now reject malformed catalog metadata, invalid status/required/binding fields, impossible counts, stale rule versions, domain mismatches and incomplete bound identities. **These changes are not yet CI-verified.** The available GitHub status-check query returned no checks; do not treat that as a passing result.
- **Latest green integrated code-verification run:** [GitHub Actions #664](https://github.com/jollysingla2000/supply_chain/actions/runs/44871233661), exact tested code commit `03cf59cbbe834e8a56c926053456a5561bfa82ae`, completed 2026-11-21. Dependency-audit failure-path regression, Markdown link validation, dependency audit (**0 vulnerabilities**), **73/73 engine unit tests**, coverage report, TypeScript, production build, Playwright browser setup, **12/12 browser E2E tests** and artifact upload all passed.
- **Evidence artifact:** `phase1-verification-ce4eecc3c3fcfcc30e6d138b688c8120c3acb705`, artifact ID `14693427728`, SHA-256 `sha256:4d16531d93402a2ef7f0beb4e143bdfdcf121b60f60ae57b99d582a63968327e`.
- **Aggregate engine test-runner coverage:** **96.59% line / 83.22% branch / 91.86% function** across loaded `src/engine/**/*.ts` files (including `engine.test.ts`).
- **Per-capability execution report:** 27 source-slice measurement rows across 26 capability groups (#26 has sub-areas #26A/#26B). Named unit/E2E test titles and P/N/B/H categories are read from `scripts/capability-test-map.json` and validated against source tests (**95 named test mappings**). Per-capability line/function figures are V8 source-slice execution attribution; the V8 range metric is a proxy, **not conventional branch coverage**. Source slices can overlap, and coverage is not isolated by test.
- **CI coverage regression floors:** every capability must retain at least **70% source-slice line / 60% V8 execution-range proxy / 60% function coverage**. These are initial anti-regression floors, not certification thresholds; the V8 range value is a proxy, not conventional branch coverage.
- **Small workload:** [Run #659](https://github.com/jollysingla2000/supply_chain/actions/runs/44869734392) measured a real XLSX with 100,000 cells across 5 repetitions; p95 **1.8363 seconds**, peak RSS **0.369 GiB**, file size **1,291,339 bytes**. This is within the proposed Small profile (≤10 seconds, ≤1 GiB). Fixture hash: `SHA256-CB9684279BB40C333068ACE50A854ECA5827F5D868E9ED5697A6BAA6E92B27C7`.
- **Medium workload:** run #659 measured a real XLSX with 1,000,000 cells (100,000 rows × 10 columns), 3 repetitions; p95 **18.3209 seconds**, peak RSS **0.862 GiB**, file size **13,105,419 bytes**. This is within the proposed Medium profile (≤45 seconds, ≤2 GiB). Fixture hash: `SHA256-52CE04A5837B7431A66A72432D3C852E1E5D005FB6C268F295C578338343B177`.
- **Maximum cell workload:** run #659 measured a real XLSX with **5,000,000 cells** (99,999 data rows), 3 repetitions; p95 **86.4262 seconds**, baseline RSS after fixture cleanup **1.028 GiB**, peak sampled RSS **2.576 GiB**, file size **47,557,841 bytes**. This passes the proposed Maximum profile (≤180 seconds, ≤3 GiB) for this fixture. Fixture hash: `SHA256-59AEC2DBC2ACB10AEEAC4045F37FA6DFD4DCF9295F35730D05CAB0E8225087CF`. The benchmark collects garbage after fixture construction and between repetitions; it still measures absolute process RSS during each ingestion repetition and preserves the 5M-cell workload and 3 GiB limit.
- **Performance evidence limitations:** the largest measured fixture is 47.6 MB, not the full 100 MB upload limit. Export/re-import and browser interaction at this maximum scale, durable large-storage recovery, and server-side persistence SLOs remain unmeasured. Results run on the floating `ubuntu-latest` GitHub runner with Node 22; pinning runner image/hardware and repeating on a controlled runner remain necessary for formal performance certification. RSS is sampled during the workload, not an OS-recorded high-water mark.
- **Defect baseline:** DA-001 through DA-004 remain CI-verified from their dedicated regression/repository checks. The follow-up changed-signature reapproval guard (DA-005) passed in #659. The enlarged ZIP adversarial matrix passed in #651. This is not a full 26-capability defect-free audit.
- **Requirement B — partial implementation:** a version-bound Rule × Domain × Dataset Version matrix is generated for six registered top-level validation groups, with explicit outcomes/reasons and release-gate enforcement. Six-domain tests cover optional skips, mandatory-source blocking and stale-version rejection. Still open: fine-grained enabled-check inventory and authenticated immutable server evidence (`DEC-RULEMATRIX-001`).
- **Repository governance:** `main` remains unprotected with required status-check enforcement off (`DEC-CI-001`).
- **Domain onboarding:** automated Requirement D gate tests pass across all six primary domains; all remain **IN VERIFICATION** until their full 12-item evidence pack and named owner/technical-certifier approvals are complete.
- **Certified capabilities:** **0/26**. CI and the measured 5M-cell ingestion profile are necessary evidence but do not satisfy all A–D acceptance criteria, full maximum-upload/round-trip and server-storage evidence, enterprise architecture controls, or named business-owner certification (`certifiedBy` / `certifiedAt`).
- Client-only constraints remain: current persistence is browser-local; user identity is not server-authenticated; audit records are not immutable server records; multi-user concurrency and enterprise SSO are not implemented.
## 26-capability status

Each capability below reports its **per-capability source-slice V8 line / V8 range proxy / function execution** (`covered/total` across its exact TypeScript implementation slices in `src/engine/*`, generated by `scripts/report-capability-coverage.mjs`), the mapped automated test counts from `src/engine/engine.test.ts` (`Unit`) and `e2e/data-assurance-upload.spec.ts` (`E2E`) broken down by category (`P/N/B/H`), and the live defect status from [PHASE1_DEFECT_REGISTER.md](PHASE1_DEFECT_REGISTER.md).

| # | Capability | Implementation state | Source slices (`src/engine/*`) | Measured per-capability line / V8 range proxy / function execution | Named test counts (Unit + E2E; P/N/B/H) | Open / pending-CI defects | Main certification gap |
|---:|---|---|---|---|---|---|---|
| 1 | Workbook upload and ingestion | Implemented; in verification | `workbook.ts:1-265`, `security.ts:1-33` | **90.71% (205/226)** / **75.82% (69/91)** / **100.00% (16/16)** | 8 Unit + 2 E2E (`1P / 2N / 5B / 2H`) | 0 open (scale triage pending) | ZIP-bomb matrix and Small/Medium/5M-cell XLSX profiles pass; 100 MB + 1 byte is rejected before ZIP parsing. Full valid 100 MB ingestion and maximum-scale export/re-import evidence remain pending. |
| 2 | Multi-sheet detection and ingestion | Implemented; in verification | `workbook.ts:160-403` | **82.07% (151/184)** / **71.95% (59/82)** / **100.00% (15/15)** | 2 Unit + 1 E2E (`1P / 1N / 1B / 0H`) | 0 open (scale triage pending) | Hidden-sheet semantics, very wide sheets, duplicate canonical mappings and export/import scale tests. |
| 3 | Source identity and fingerprint | Implemented; in verification | `profilingAndReconciliation.ts:93-238` | **95.50% (106/111)** / **72.50% (29/40)** / **93.33% (14/15)** | 3 Unit + 1 E2E (`2P / 1N / 1B / 0H`) | DA-001/DA-002 verified in CI #636; server architecture gap remains | CI run verification of new mutation-boundary and export-envelope tests; server-side signature attestation. |
| 4 | Source workbook persistence and recovery | Implemented; in verification | `profilingAndReconciliation.ts:2774-3264` | **80.05% (345/431)** / **62.24% (89/143)** / **61.11% (11/18)** | 4 Unit + 2 E2E (`1P / 1N / 3B / 1H`) | 0 open (quota triage pending) | Large-storage failure, interrupted writes and durable server-side persistence. |
| 5 | Dataset versioning and upload lineage | Implemented; in verification | `profilingAndReconciliation.ts:2375-2773` | **70.93% (222/313)** / **61.11% (44/72)** / **94.44% (17/18)** | 4 Unit + 1 E2E (`1P / 2N / 2B / 0H`) | DA-001/DA-002/DA-005 CI-verified (#659); server architecture gap remains | Multi-version comparison diff UI, retention policy, and immutable server-side hash+version storage. |
| 6 | Column-level profiling | Implemented; in verification | `profilingAndReconciliation.ts:81-92`, `profilingAndReconciliation.ts:283-654` | **97.85% (318/325)** / **88.97% (129/145)** / **100.00% (17/17)** | 2 Unit + 0 E2E (`1P / 0N / 1B / 0H`) | 0 open (scale triage pending) | Null/outlier/large-data matrix and profiling-to-validation consistency across all domain fixtures. |
| 7 | Actual data-type inference | Implemented; in verification | `profilingAndReconciliation.ts:239-282`, `profilingAndReconciliation.ts:340-445`, `validation.ts:328-377` | **88.51% (131/148)** / **80.19% (85/106)** / **92.31% (12/13)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (locale triage pending) | Field-level locale, precision, mixed/empty and date/number ambiguity matrix. |
| 8 | Missing values and null analysis | Implemented; in verification | `profilingAndReconciliation.ts:330-380`, `profilingAndReconciliation.ts:520-594`, `validation.ts:1175-1235`, `validation.ts:2940-2985` | **94.24% (180/191)** / **84.93% (62/73)** / **93.75% (15/16)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (matrix triage pending) | Explicit NULL vs empty string vs whitespace vs sentinel vs formula-empty matrix. |
| 9 | Schema and mandatory-column validation | Implemented; in verification | `schema.ts:38-799`, `validation.ts:287-327`, `validation.ts:675-1100` | **98.61% (1134/1150)** / **89.78% (123/137)** / **100.00% (16/16)** | 4 Unit + 0 E2E (`1P / 1N / 1B / 1H`) | 0 open (domain triage pending) | Every table/column contract and mandatory-versus-optional rule × domain outcome. |
| 10 | Schema drift detection | Implemented; in verification | `profilingAndReconciliation.ts:53-80`, `profilingAndReconciliation.ts:1779-1935` | **96.55% (140/145)** / **82.61% (57/69)** / **92.00% (23/25)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | DA-001 verified in CI #636 | Alias, rename, conflicting mapping and backwards-compatibility matrix. |
| 11 | Column mapping and collision prevention | Implemented; in verification | `profilingAndReconciliation.ts:1936-2066`, `validation.ts:29-61` | **91.34% (116/127)** / **77.55% (38/49)** / **100.00% (10/10)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | DA-001 verified in CI #633 | Unicode normalization, locale and conflicting target-column edge cases. |
| 12 | Missing-table/column remediation | Implemented; in verification | `profilingAndReconciliation.ts:2067-2146`, `validation.ts:378-455`, `validation.ts:3060-3105` | **93.67% (148/158)** / **69.23% (45/65)** / **100.00% (7/7)** | 3 Unit + 1 E2E (`1P / 1N / 2B / 0H`) | DA-001 verified in CI #633 | Full table/column remediation rollback/undo UI and multi-step re-run regression. |
| 13 | Data type, format and value validation | Implemented; in verification | `validation.ts:122-152`, `validation.ts:1185-1315`, `security.ts:1-33` | **98.22% (166/169)** / **77.14% (54/70)** / **100.00% (10/10)** | 3 Unit + 0 E2E (`1P / 1N / 0B / 1H`) | 0 open (locale triage pending) | Exhaustive field precision, locale, boundary and malformed-value matrix. |
| 14 | Duplicate and business-key validation | Implemented; in verification | `validation.ts:456-511`, `validation.ts:1135-1162`, `validation.ts:1315-1336`, `validation.ts:2900-2940` | **99.21% (125/126)** / **90.63% (29/32)** / **100.00% (9/9)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (matrix triage pending) | Compound/cross-table keys, whitespace/case, deleted rows, duplicate history and idempotent remediation. |
| 15 | Date, period and time-series integrity | Implemented; in verification | `validation.ts:153-286`, `validation.ts:1225-1305`, `validation.ts:2393-2544` | **89.74% (271/302)** / **82.95% (107/129)** / **93.75% (15/16)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (calendar triage pending) | Timezone, fiscal calendar, leap-year, period continuity and date-system round-trip matrix. |
| 16 | Master-data and referential integrity | Implemented; in verification | `validation.ts:1102-1134`, `validation.ts:1337-1455`, `profilingAndReconciliation.ts:1410-1592` | **92.91% (275/296)** / **82.89% (63/76)** / **100.00% (7/7)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (FK catalog triage pending) | Complete relationship catalog and positive/orphan tests for every domain FK. |
| 17 | Cross-table reconciliation | Implemented; in verification | `profilingAndReconciliation.ts:655-1778`, `formulaTests.ts:16-271` | **95.86% (1157/1207)** / **83.33% (230/276)** / **100.00% (22/22)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (`DEC-REC03-001`, `DEC-RECCERT-001` open) | Formal contracts and per-REC positive/negative/zero-denominator/partial-source fixtures pass in CI; REC-03 methodology decision and business-owner certification (`certifiedBy`/`certifiedAt`) remain open. |
| 18 | UOM, currency and quantity consistency | Implemented; in verification | `validation.ts:1260-1285`, `validation.ts:1360-1385`, `validation.ts:1456-1555`, `validation.ts:2985-3025` | **98.19% (163/166)** / **78.79% (52/66)** / **100.00% (6/6)** | 2 Unit + 0 E2E (`1P / 1N / 0B / 0H`) | 0 open (conversion triage pending) | Conversion chains, mixed units, precision/rounding, currency/rate validity and missing-rate policies. |
| 19 | Business constraints and domain rules | Implemented; in verification | `schema.ts:295-360`, `validation.ts:512-649`, `validation.ts:1556-1720`, `calculations.ts:18-460` | **88.13% (557/632)** / **73.68% (126/171)** / **100.00% (31/31)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (policy triage pending) | Policy provenance, override authorization, effective dates, boundaries and complete rule inventory. |
| 20 | Demand Planning Data Assurance | Implemented; in verification | `schema.ts:38-85`, `validation.ts:1190-1720`, `validation.ts:2393-2544`, `calculations.ts:51-364` | **88.37% (790/894)** / **76.23% (186/244)** / **96.15% (25/26)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (domain gate pending) | Automated onboarding gate passes all-six-domain matrix tests; full 12-item evidence pack and named domain-owner sign-off remain pending. |
| 21 | Supply Planning Data Assurance | Implemented; in verification | `schema.ts:86-128`, `validation.ts:1595-1650`, `validation.ts:1721-1840`, `validation.ts:2270-2310`, `calculations.ts:365-460` | **96.97% (288/297)** / **87.30% (55/63)** / **100.00% (10/10)** | 2 Unit + 0 E2E (`1P / 0N / 1B / 0H`) | 0 open (domain gate pending) | Requirement D automated onboarding gate passes; awaits named domain business-owner sign-off. |
| 22 | S&OP Data Assurance | Implemented; in verification | `schema.ts:129-172`, `validation.ts:675-1100`, `validation.ts:1456-1720`, `profilingAndReconciliation.ts:805-1408` | **94.40% (1112/1178)** / **86.50% (282/326)** / **100.00% (15/15)** | 2 Unit + 0 E2E (`1P / 0N / 1B / 0H`) | 0 open (domain gate pending) | Requirement D automated onboarding gate passes; awaits named domain business-owner sign-off. |
| 23 | MEIO Data Assurance | Implemented; in verification | `schema.ts:173-212`, `validation.ts:2076-2149`, `calculations.ts:392-421` | **84.03% (100/119)** / **70.59% (12/17)** / **100.00% (4/4)** | 2 Unit + 0 E2E (`1P / 0N / 1B / 0H`) | 0 open (domain gate pending) | Requirement D automated onboarding gate passes; awaits named domain business-owner sign-off. |
| 24 | Procurement Data Assurance | Implemented; in verification | `schema.ts:213-252`, `validation.ts:1721-1965` | **100.00% (271/271)** / **94.29% (33/35)** / **100.00% (3/3)** | 3 Unit + 0 E2E (`1P / 1N / 1B / 0H`) | 0 open (domain gate pending) | Requirement D automated onboarding gate passes; awaits named domain business-owner sign-off. |
| 25 | Manufacturing Data Assurance | Implemented; in verification | `schema.ts:253-294`, `validation.ts:1966-2075`, `validation.ts:2150-2269` | **92.86% (234/252)** / **73.17% (30/41)** / **100.00% (4/4)** | 2 Unit + 0 E2E (`1P / 0N / 1B / 0H`) | 0 open (domain gate pending) | Requirement D automated onboarding gate passes; routing/calendar fixtures and owner sign-off pending. |
| 26A | Certification engine: release gate, evidence matrix and audit linkage | Implemented; in verification | `validation.ts:62-121, 675-1100, 2545-3348`, `profilingAndReconciliation.ts:2147-2773` | **84.21% (1403/1666)** / **77.39% (421/544)** / **71.19% (84/118)** | 7 Unit + 1 E2E (`3P / 2N / 1B / 2H`) | DA-001 through DA-005 CI-verified (DA-005 in #659) | Complete fine-grained rule catalog for Requirement B; authenticated immutable server audit/evidence storage; protected CI policy. |
| 26B | Governance UI and workflow coverage | Implemented; in verification | `validation.ts:62-121, 3106-3200`, `profilingAndReconciliation.ts:2751-2773` + `e2e/data-assurance-upload.spec.ts` | **86.79% (138/159)** / **71.21% (47/66)** / **100.00% (7/7)** | 1 Unit + 3 E2E (`2P / 0N / 1B / 1H`) | DA-001/DA-002 verified in CI #633 | Broader remediation undo/reversal UI paths and accessibility/usability regression. |

**Interpretation:** Per-capability coverage percentages above are generated deterministically by `scripts/report-capability-coverage.mjs` using V8 coverage ranges mapped via Node's `SourceMap` to the exact TypeScript source line ranges (`file:startLine-endLine`) implementing each capability. Certified count remains **0/26** until all requirements in [PHASE1_CERTIFICATION_STANDARD.md](PHASE1_CERTIFICATION_STANDARD.md) are met.

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

**Requirement B implementation gap:** the current automated `coverageMatrix` records table × selected domain and table-level execution/skipping; category summaries record the six validation groups. It is not yet a durable Rule × Domain × Dataset Version matrix with explicit optional-rule `SKIPPED(reason)` outcomes. Keep B in verification until that matrix is implemented, version-bound and release-gate tested. See `DEC-RULEMATRIX-001` in the defect register.

| Requirement | Meaning | Capabilities | Mandatory evidence |
|---|---|---|---|
| **A — Dataset identity and lineage** | A source dataset is identified by a stable hash (`sourceWorkbookHash`) and monotonically advancing version (`datasetVersion`). Corrections, approvals, sign-offs, exports (`exportSchemaVersion: '1.0'`), audit events and re-imports retain the same explicit dataset identity/version or are rejected as mismatched. In-app structural remediation and column mapping execute through `executeGovernedDatasetMutation`, incrementing `datasetVersion`, clearing `warningSignOff`, re-binding only demonstrably unaffected corrections with preserved original approval provenance, and marking affected/unprovable corrections `INVALIDATED_BY_REMEDIATION` (which blocks the release gate). | #3, #4, #5, #10, #11, #12, #26A, #26B | Hash + version fields; tamper/mismatch tests; mutation-boundary re-bind vs invalidation tests; correction → approval → remediation → export → re-import lineage sequence; rollback and replay evidence. |
| **B — Validation coverage matrix** | Every configured rule is evaluated against each applicable domain/dataset and reports `NOT_RUN`, `PASSED`, `FAILED`, `PARTIAL` or `SKIPPED(reason)`. Missing mandatory sources block release; optional missing sources are explicitly skipped with a reason and do not masquerade as executed checks. | #9, #16, #20–#26A | Rule × domain × dataset matrix; required/optional source tests; proof no missing mandatory check can become a pass; release-gate integration. |
| **C — Reconciliation rule contracts** | Every REC rule (`REC-01`..`REC-05` in `RECONCILIATION_RULE_CONTRACTS`) has a documented rule version, business purpose, owner role, equation, grain, units, tolerance, effective-date policy, exclusions, source fields, null-denominator behavior, partial-source behavior, certification metadata (`certifiedBy`, `certifiedAt`), and independent expected-result fixtures across the full per-REC positive, negative, zero-denominator, and partial-source boundary matrix. | #17, #26A | Independent calculation fixtures; zero-denominator and partial-source cases across all 5 REC rules; `certifiedBy` / `certifiedAt` evidence (null until human owner sign-off); rule-version linkage. |
| **D — Domain onboarding completeness** | A domain is labelled **SUPPORTED** only when its schema, mandatory/optional tables, keys, dependencies, business rules, fixtures and positive/negative/boundary tests are complete. | #20–#25, #26A | Domain-by-domain onboarding matrix and automated gate in [PHASE1_DOMAIN_SUPPORT_MATRIX.md](PHASE1_DOMAIN_SUPPORT_MATRIX.md). An implemented contract alone does not mean a domain is supported. |

## Defect and risk accounting

The live severity counts and individual defect records (`DA-001` through `DA-004`) are maintained in [the Phase 1 defect register](PHASE1_DEFECT_REGISTER.md).

Certification policy:
- No unresolved open Critical defect.
- High defects must be fixed or explicitly risk-accepted by an accountable owner with a due date and compensating control.
- Medium/Low defects require an owner, target date and documented disposition.
- Every defect must have a reproducible scenario, affected requirement/capability, fix commit and regression test when closed.

## Repository CI governance

GitHub currently reports `main` as unprotected with required status-check enforcement off. The repository must require the Phase 1 workflow before changes are treated as merge/push-gated. This is an external GitHub repository setting and remains open as `DEC-CI-001` until enabled by an administrator.

## Performance and scale targets

**Measurement scope:** a legacy five-run microbenchmark uses an 80-order seeded workbook and times hashing, validation, profiling and reconciliation only; it is not upload-parser evidence. The real XLSX parser benchmarks below exercise workbook ingestion plus downstream data-assurance computation. The quota test covers browser storage failure, not durable server recovery.

Existing hard ingestion bounds are 100 MB per workbook, 100 worksheets, 1,000 columns per sheet, 500,000 total rows and 5,000,000 estimated cells. These are input guardrails, not a guarantee that every file at every byte/cell combination has been benchmarked.

The initial engineering SLO proposals below are measured against the current CI profiles; they remain provisional until the runner is pinned and performance is repeated on controlled hardware:

| Workload | Test profile | Proposed target |
|---|---|---|
| Small | ≤10 MB and ≤100,000 cells | p95 ingest + profiling + validation ≤10 seconds; peak process RSS ≤1 GiB |
| Medium | ≤50 MB and ≤1,000,000 cells | p95 ≤45 seconds; peak process RSS ≤2 GiB |
| Maximum supported | ≤100 MB and ≤5,000,000 cells, subject to all existing row/sheet/column bounds | p95 ≤180 seconds; peak process RSS ≤3 GiB |

**Measured real XLSX ingestion results — CI run #659, commit `ce4eecc3c3fcfcc30e6d138b688c8120c3acb705`:**

| Profile | Cells | File size | Repetitions | p95 elapsed | Baseline / peak sampled RSS | Result |
|---|---:|---:|---:|---:|---:|---|
| Small | 100,000 | 1,291,339 bytes | 5 | 1.8363 s | 0.369 GiB peak | Within proposed target |
| Medium | 1,000,000 | 13,105,419 bytes | 3 | 18.3209 s | 0.862 GiB peak | Within proposed target |
| Maximum cell workload | 5,000,000 | 47,557,841 bytes | 3 | 86.4262 s | 1.028 GiB baseline / 2.576 GiB peak sampled | Within proposed target |

Fixture hashes are recorded above under Current evidence status. The maximum fixture exercises 5M cells in a 47.6 MB XLSX; it does **not** exercise a 100 MB workbook. The benchmark collects garbage after constructing the test fixture and between repetitions so the reported RSS represents the ingestion trials rather than unreachable fixture-builder/previous-trial objects. The assertion remains on absolute sampled process RSS and the 3 GiB limit has not been relaxed.

Measure parse/ingest, profiling, validation, reconciliation, export/re-import and browser interaction separately. Record runner image, CPU/memory, Node/browser versions, fixture hash, repetitions, elapsed time and peak RSS. The #659 results demonstrate the tested Small/Medium/Maximum cell profiles on the current `ubuntu-latest` Node 22 runner; formal performance certification still requires a pinned runner and controlled repeatability. Full 100 MB upload, maximum-scale export/re-import/browser interaction and durable server storage/recovery measurements remain open. If a limit is not achievable safely, reduce the supported workload rather than silently weakening resource protection.

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
