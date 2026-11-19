# Phase 1 — Enterprise Planning Data Assurance: Capability Tracker

**Branch:** phase1/rec02-effective-price-guard  
**Scope:** Data Assurance for Demand Planning, Supply Planning, S&OP, MEIO, Procurement, Manufacturing, Inventory/Replenishment and IBP.  
**Status:** Working tracker; percentages are engineering estimates, not test-coverage metrics.  
**Certification rule:** A capability is not marked complete until implementation review, unit/negative/boundary tests, cross-domain regression tests, and verification evidence are complete. “Foolproof” is not an absolute guarantee.

**Current estimated implementation progress:** approximately **89%** across the 26 capabilities; **0/26 foolproof-certified**. This estimate reflects reviewed implementation scope and is not a measure of automated test coverage.

## Current verification snapshot

- Engine tests: **51/51 passing** on branch head `11e513b`.
- TypeScript (npm run lint): **passed**.
- Production build: **passed**.
- Dependency audit: **0 vulnerabilities reported**; CI fails if any vulnerability is found.
- Browser end-to-end tests: **9/9 passed** in the latest completed full run; the current branch run is repeating the suite after domain mandatory-table changes.
- Current branch-head CI run: https://github.com/jollysingla2000/supply_chain/actions/runs/44443152426 (engine tests, TypeScript, production build and dependency audit passed; E2E pending).
- Latest completed full run verified 51 engine tests, 9 E2E tests, TypeScript, build, and dependency audit. The current branch run has already passed engine tests, TypeScript, build and audit; E2E is pending.
- ESM-native Vite config warning was fixed; the large workbook parser chunk remains a performance consideration. GitHub Actions also emits a Node.js 20 action-runtime deprecation warning; the test run is green.
- Client-only limitations remain: persistence uses browser storage; approvals/audit identities are self-attested; no server-side identity, durable server audit, multi-user concurrency, or enterprise SSO is implemented. These prevent enterprise governance from being certified foolproof.

## 26-capability status

| # | Capability | Estimated work done | Foolproof / independently verified? | Status / remaining |
|---:|---|---:|---|---|
| 1 | Workbook upload and ingestion | 96% | No | Multi-format ingestion, extension guard, failure recording, 100 MB limit, 100-sheet/1,000-column/500k-row/5m-cell bounds, empty-workbook rejection and browser rollback covered; hostile archive expansion and real large-workbook performance still pending. |
| 2 | Multi-sheet detection and ingestion | 94% | No | All worksheets and headers handled; duplicate canonical mappings, duplicate/blank headers, prototype-key regression and round-trip tests pass; hidden-sheet and large-workbook coverage pending. |
| 3 | Source identity and fingerprint | 92% | No | Original-file SHA-256 and deterministic governed-workbook hash tested; nested object values are canonicalized by sorted keys while arrays and row order remain significant; full identity/lineage threat review pending. |
| 4 | Source workbook persistence and recovery | 92% | No | Corrupt payload recovery, upload recovery, reload persistence, rejected-upload rollback, active-sheet restore and visible quota-failure warning browser tests pass; large-storage failure remains. |
| 5 | Dataset versioning and upload lineage | 84% | No | Active/superseded/rejected states and failed-upload rollback are covered; multi-version history and long-retention behavior pending. |
| 6 | Column-level profiling | 88% | No | Profiling shares strict numeric parsing with validation and detects malformed grouping as MIXED; full null/outlier/large-data matrix pending. |
| 7 | Actual data-type inference | 93% | No | Strict number parsing supports valid Western/Indian grouping, signed values and exponent notation; malformed/non-finite values rejected and profiling regression tested. |
| 8 | Missing values and null analysis | 80% | No | Core missingness checks/remediation present; null vs blank vs whitespace vs sentinel matrix pending. |
| 9 | Schema and mandatory-column validation | 95% | No | Numeric-prefix lookalikes, ambiguous duplicate canonical tables and duplicate metadata headers fail closed; domain-scoped coverage exists; exhaustive contract certification pending. |
| 10 | Schema drift detection | 90% | No | Canonical table resolution is hardened against prefix spoofing; aliases, renames, conflicting mappings and backward-compatibility matrix pending. |
| 11 | Column mapping and collision prevention | 94% | No | Duplicate/blank input and metadata headers, normalized punctuation/case collisions, unknown table mappings, case-insensitive target conflicts and header normalization are handled; broader Unicode scenarios pending. |
| 12 | Missing-table/column remediation | 87% | No | Table-level remediation blocked, source re-upload enforced, mapping type resolution scoped and duplicate corrections guarded; every table/column path still needs regression coverage. |
| 13 | Data type, format and value validation | 95% | No | Strict numeric grouping, non-finite rejection, date serial range, formula-cell rejection and typed remediation tested; full field/precision/locale matrix pending. |
| 14 | Duplicate and business-key validation | 82% | No | Business-key checks implemented; cross-table, compound-key, case/trim, deleted-row and duplicate edge matrix pending. |
| 15 | Date, period and time-series integrity | 90% | No | Ambiguous dates rejected; Excel 1900/1904 serials normalized, including six-digit text serials; tested through 2199 bounds; full timezone/fiscal-calendar suite pending. |
| 16 | Master-data and referential integrity | 88% | No | Domain-scoped FK checks and BOM component FK added; canonical table resolver hardened; complete relationship catalog and all domain orphan tests pending. |
| 17 | Cross-table reconciliation | 87% | No | REC-01..REC-05 logic corrected and regression-tested; full source semantics/partial coverage and business-owner review pending. |
| 18 | UOM, currency and quantity consistency | 78% | No | UOM factor validation uses strict parsing and rejects hex-like values; conversion rules, currencies, precision, mixed units and missing rates need exhaustive validation. |
| 19 | Business constraints/domain rules | 82% | No | Threshold validation and domain rules exist; policy provenance, overrides, boundaries and complete rule coverage pending. |
| 20 | Demand Planning Data Assurance | 87% | No | Demand contract and source validation; no forecast accuracy/optimization; end-to-end domain coverage and certification pending. |
| 21 | Supply Planning Data Assurance | 82% | No | Contract isolation and source checks exist; complete table relationships and domain test matrix pending. |
| 22 | S&OP Data Assurance | 82% | No | Domain contract exists; integrated scenario/master coverage and end-to-end validation pending. |
| 23 | MEIO Data Assurance | 82% | No | Domain-scoped contracts and exclusions exist; network/master completeness and domain-specific regression coverage pending. |
| 24 | Procurement Data Assurance | 88% | No | Supplier-specific contract matching and MOQ/order-multiple validation fixed; full contract/source and PO scenarios pending. |
| 25 | Manufacturing Data Assurance | 88% | No | BOM parent/component FK and lead-time scope checks added; complete routing/work-center/BOM constraints and edge coverage pending. |
| 26 | Exception management, quality score, release governance, audit and automated verification | 92% | No | Approval validation, correction idempotency, hash-bound release gate, assignment SLA, upload rollback, audit retention capped at 1,000 records and JSON audit export are implemented and E2E-tested. Server-backed identity/audit and full UI/flow verification remain. |

## Recent confirmed changes

- REC-01: fulfillment excludes reverse-flow returns; zero-net-order over-shipment caught.
- REC-02: price match requires effective price on/before transaction date; future price fallback disallowed; exclusions tracked.
- REC-03: source stockout-day integrity only; no uncensored-demand estimate generation/judgement in Data Assurance.
- REC-04: manufacturing component SKU foreign-key relationship added.
- REC-05: lead-time policy check scoped to selected domain; missing in-scope sources fail closed to NOT_RUN.
- Procurement: supplier-contract key includes Supplier × SKU × Depot; unmatched contracts explicitly warned.
- SheetJS dependency moved to official 0.20.3 CDN distribution; audit returned zero vulnerabilities.
- Persisted workbook, correction, sign-off, audit, lineage and assignment payloads are structurally checked; approval/sign-off payloads are bound to the active workbook hash.
- Warning release sign-off now fails closed when the app supplies an active workbook hash but the sign-off is unbound or tied to a different workbook.
- Upload rejection is recorded without replacing active workbook; upload attempts are serialized in the UI.
- Upload file picker restricts selection to supported XLSX/XLS/CSV extensions; parser still validates actual content.
- Workbook ingestion rejects duplicate headers (case-insensitive after trimming), blank headers within a populated header row, and formula cells whose cached results cannot be verified.
- Schema validation independently flags duplicate column metadata, even when a workbook bypasses normal ingestion.
- Header duplicate detection now normalizes punctuation, whitespace and case so variants such as SKU_Code vs SKU Code are rejected.
- Canonical table resolution is hardened across validation, schema drift, profiling, REC-04, column mapping, remediation type resolution and NPI-specific rules; numeric-prefix lookalikes and duplicate canonical/suffix aliases fail closed.
- Implicit table-name aliases are no longer trusted: worksheets must use the canonical table name or a clearly suffixed full canonical name; explicit table mapping is not yet implemented.
- REC-04 now reports NOT_RUN instead of passing when any in-domain worksheet-to-contract mapping is ambiguous.
- Row-value and field-key alias lookup uses normalized exact matching instead of substring matching, preventing similarly named fields from being confused.
- Added schema metadata consistency tests covering every table contract, declared foreign-key source/target columns, and all planning-domain mandatory/relevant/master tables.
- Domain fixtures now assert structural schema passes and every configured required validation category actually executes for all six planning domains.
- Exception assignments now track owner, lifecycle status, SLA start/due dates and overdue state; the UI refreshes overdue indicators and persistence restore recomputes stale overdue state.
- Numeric parser is now shared by profiling and validation, preventing malformed thousands separators from being interpreted inconsistently; strict parsing regression tests cover Western/Indian grouping, signs, exponent values, and invalid/non-finite inputs.
- Excel serial dates support the full 1900–2199 date guard and six-digit text serials; the 1900 date system now correctly maps serials 1/59/61 and rejects fictitious serial 60. Workbook ingestion also normalizes six-digit text serials in the 1904 date system.
- The audit actor is labelled `APP SESSION (UNAUTHENTICATED)` instead of attributing browser actions to a real person; true actor identity remains a backend authentication requirement.
- Assignment lifecycle/date rules are extracted into a tested engine helper; malformed persisted SLA dates are discarded and overdue state recalculated on restore.
- Assignment history is validated and bounded to the most recent 100 entries on restore.
- Assignment history is also capped to 100 events during live updates, preventing unbounded state growth.
- Workbook ingestion now applies configurable guardrails: 100 MB input, 100 worksheets, 1,000 columns per sheet, 500,000 total rows, and 5 million estimated cells; guardrail rejection tests are included.
- Workbook fingerprint encoding canonicalizes nested object keys to avoid hash drift from object property insertion order.
- Session audit history is capped at 1,000 entries in memory and on persistence; the audit screen can export a JSON snapshot with a clear disclaimer that it is not server-authenticated/immutable.
- Playwright browser tests cover formula CSV rejection, normalized duplicate-header rejection, upload identity persistence, exception assignment/SLA persistence, corrupted-state recovery, persistence-quota warnings, multi-sheet selected-table persistence, and audit export; current 9-test E2E run pending.
- Missing-period correction replay is idempotent, and duplicate correction approvals for the same exception/workbook are blocked and deduplicated on persistence restore.
- Approval modals no longer prefill a person's name; the approver must self-enter.
- Automated remediation and demo initialization audit actors are labeled as system/demo actors, not falsely attributed to a named individual.

## Next review priorities

1. Finish CI on the newest commit and inspect build output.
2. Add browser-level tests for remediations, sign-off, persistence quota handling, and navigation.
3. Complete the field-level schema and relationship catalog review for all six domain contracts.
4. Add resource-abuse and hostile-workbook coverage, including zip bombs, extremely large sheets and parser failure handling (formula-cell rejection is implemented).
5. Verify audit/lineage state transitions and correction replay/reversal with sequence tests.
6. Establish the backend identity, access control, server-side audit, and durable persistence design required for true enterprise governance. These are architectural blockers to foolproof certification, not client-side bugs that can be solved by UI changes alone.
