# Phase 1 — Enterprise Planning Data Assurance: Capability Tracker

**Working target:** `main` (direct commits; no feature-branch workflow)  
**Purpose:** Track implementation, measurable verification, open defects and certification evidence for all 26 capabilities.  
**Certification rule:** No capability is complete until requirements are traceable to implementation and tests, positive/negative/boundary/hostile cases are exercised where applicable, cross-domain regressions pass, performance limits are measured, and evidence is tied to a commit and CI run. “Foolproof” is not an absolute guarantee.

## Current evidence status

- **Last known green integrated run:** [GitHub Actions #606](https://github.com/jollysingla2000/supply_chain/actions/runs/44453622091), commit `283311bc6c06ba2c073f03704b70aed840b91bf9`, 2026-11-19 03:47 UTC.
- **Last known results:** 60/60 engine tests, 9/9 browser E2E tests, TypeScript, production build and dependency audit passed.
- This is a **historical last-known-good result**, not a fresh verification of the present `main` HEAD. Any code/test/tooling change must receive a new green CI run before the corresponding evidence is treated as current.
- **Coverage baseline:** not yet measured. The engine test command is being instrumented to report line, branch and function coverage. Initial coverage is aggregate across loaded engine modules; it is not automatically attributable to each capability.
- **Capability-level test mapping:** not yet complete. Test counts must be mapped to capability, requirement and test category before being used as a certification claim.
- **Defect baseline:** untriaged. The register deliberately does not report zero defects.
- **Certified capabilities:** 0/26. Implementation presence and passing tests do not by themselves establish certification.
- Client-only constraints remain: current persistence is browser-local; user identity is not server-authenticated; audit records are not immutable server records; multi-user concurrency and enterprise SSO are not implemented.

## 26-capability status

The former engineering-estimate percentages have been removed. They were subjective and were not test coverage. Each capability will instead receive measured coverage, mapped test counts and a severity-based defect count once the baseline is collected.

| # | Capability | Implementation state | Measured line / branch / function coverage | Test matrix counts | Open defects | Main certification gap |
|---:|---|---|---|---|---|---|
| 1 | Workbook upload and ingestion | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Hostile archive expansion, malformed ZIP resilience, representative large-file runtime and memory benchmarks. |
| 2 | Multi-sheet detection and ingestion | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Hidden-sheet semantics, very wide sheets, duplicate canonical mappings and export/import scale tests. |
| 3 | Source identity and fingerprint | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Complete dataset identity + version contract across corrections, approvals, audit, exports and re-imports. |
| 4 | Source workbook persistence and recovery | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Large-storage failure, interrupted writes and durable server-side persistence. |
| 5 | Dataset versioning and upload lineage | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Multi-version history, version comparisons, retention, and immutable hash+version linkage. |
| 6 | Column-level profiling | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Null/outlier/large-data matrix and profiling-to-validation consistency across all domain fixtures. |
| 7 | Actual data-type inference | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Field-level locale, precision, mixed/empty and date/number ambiguity matrix. |
| 8 | Missing values and null analysis | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Explicit NULL vs empty string vs whitespace vs sentinel vs formula-empty matrix. |
| 9 | Schema and mandatory-column validation | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Every table/column contract and mandatory-versus-optional rule × domain outcome. |
| 10 | Schema drift detection | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Alias, rename, conflicting mapping and backwards-compatibility matrix. |
| 11 | Column mapping and collision prevention | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Unicode normalization, locale and conflicting target-column edge cases. |
| 12 | Missing-table/column remediation | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Full table/column remediation, rollback, re-run and correction-sequence regression. |
| 13 | Data type, format and value validation | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Exhaustive field precision, locale, boundary and malformed-value matrix. |
| 14 | Duplicate and business-key validation | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Compound/cross-table keys, whitespace/case, deleted rows, duplicate history and idempotent remediation. |
| 15 | Date, period and time-series integrity | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Timezone, fiscal calendar, leap-year, period continuity and date-system round-trip matrix. |
| 16 | Master-data and referential integrity | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Complete relationship catalog and positive/orphan tests for every domain FK. |
| 17 | Cross-table reconciliation | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Formal equation contracts, independent expected-value fixtures, partial-source semantics and rule certification metadata. |
| 18 | UOM, currency and quantity consistency | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Conversion chains, mixed units, precision/rounding, currency/rate validity and missing-rate policies. |
| 19 | Business constraints and domain rules | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Policy provenance, override authorization, effective dates, boundaries and complete rule inventory. |
| 20 | Demand Planning Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | End-to-end supported-domain gate: schema, keys, dependencies, rule matrix, fixtures and evidence. |
| 21 | Supply Planning Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Complete table relationships, dependency graph, scenario fixtures and domain regression matrix. |
| 22 | S&OP Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Integrated scenario/master-data coverage and cross-domain end-to-end fixtures. |
| 23 | MEIO Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Network/echelon completeness, master relationships, policy fixtures and regression matrix. |
| 24 | Procurement Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Full contract effective-date, PO, receipt, supplier substitution and unmatched-source scenarios. |
| 25 | Manufacturing Data Assurance | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Routing, work-center shifts/calendars, shared capacity, alternate BOM and edge-case fixture coverage. |
| 26A | Certification engine: release gate, evidence matrix and audit linkage | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Dataset version binding, rule × dataset matrix, full lifecycle audit sequence, authenticated immutable server evidence. |
| 26B | Governance UI and workflow coverage | Implemented; certification pending | Not yet measured per capability | Not yet mapped | Untriaged | Broader remediation/sign-off/navigation/undo/reversal UI paths and accessibility/usability regression. |

**Interpretation:** “Not yet measured”, “Not yet mapped” and “Untriaged” are unknown states, not zeroes. Coverage must be reported with the exact commit SHA and CI run ID.

## Priority plan

| Priority | Scope | Exit condition |
|---|---|---|
| **P1a — Critical foundation** | #1–#5, #17 and #26A | Dataset ingestion/identity/lineage, reconciliation contracts, validation matrix and release gate are evidenced end-to-end. |
| **P1b — Data integrity** | #8, #12, #14, #15 and #16 | Missingness, remediation, duplicate keys, date integrity and referential integrity have complete negative/boundary tests. |
| **P2 — Validation and business rules** | #6, #7, #9, #10, #11, #13, #18 and #19 | Measured coverage and complete field/locale/rule test matrices exist. |
| **P3 — Planning domain certification** | #20–#25 | Each domain passes the onboarding gate in the domain support matrix. |
| **P4 — Remaining governance UI** | #26B | Broader user workflows and UI regression/accessibility evidence pass. |

P1a and P1b are ordered milestones, not claims that lower-priority safeguards can be ignored.

## Mandatory requirement traceability: A–D

| Requirement | Meaning | Capabilities | Mandatory evidence |
|---|---|---|---|
| **A — Dataset identity and lineage** | A source dataset is identified by a stable hash and version. Corrections, approvals, sign-offs, exports, audit events and re-imports retain the same explicit dataset identity/version or are rejected as mismatched. | #3, #4, #5, #26A | Hash + version fields; tamper/mismatch tests; correction → approval → export → re-import lineage sequence; rollback and replay evidence. |
| **B — Validation coverage matrix** | Every configured rule is evaluated against each applicable domain/dataset and reports `NOT_RUN`, `PASSED`, `FAILED`, `PARTIAL` or `SKIPPED(reason)`. Missing mandatory sources block release; optional missing sources are explicitly skipped with a reason and do not masquerade as executed checks. | #9, #16, #20–#26A | Rule × domain × dataset matrix; required/optional source tests; proof no missing mandatory check can become a pass; release-gate integration. |
| **C — Reconciliation rule contracts** | Every REC rule has a documented equation, grain, tolerance, exclusions, source fields, owner/certifier, certification timestamp and independent expected-result fixtures. | #17, #26A | Independent calculation fixtures; zero-denominator and partial-source cases; `certifiedBy` / `certifiedAt` evidence; rule-version linkage. |
| **D — Domain onboarding completeness** | A domain is labelled **SUPPORTED** only when its schema, mandatory/optional tables, keys, dependencies, business rules, fixtures and positive/negative/boundary tests are complete. | #20–#25, #26A | Domain-by-domain onboarding matrix and automated gate. An implemented contract alone does not mean a domain is supported. |

## Defect and risk accounting

The live severity counts are maintained in [the Phase 1 defect register](docs/PHASE1_DEFECT_REGISTER.md). Until the initial triage is complete, all capability defect counts remain **UNTRIAGED**; do not infer “0 open defects”.

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

The baseline domain set is the six primary planning domains: Demand, Supply, S&OP, MEIO, Procurement and Manufacturing. Regression evidence must cover each domain's mandatory/relevant/master tables, declared foreign keys, required validation categories and all applicable REC rules. The full matrix is defined in [the domain support matrix](docs/PHASE1_DOMAIN_SUPPORT_MATRIX.md).

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
