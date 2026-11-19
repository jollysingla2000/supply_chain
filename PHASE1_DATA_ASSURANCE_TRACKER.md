# Phase 1 — Enterprise Planning Data Assurance: Capability Tracker

**Branch:** phase1/rec02-effective-price-guard  
**Scope:** Data Assurance for Demand Planning, Supply Planning, S&OP, MEIO, Procurement, Manufacturing, Inventory/Replenishment and IBP.  
**Status:** Working tracker; percentages are engineering estimates, not test-coverage metrics.  
**Certification rule:** A capability is not marked complete until implementation review, unit/negative/boundary tests, cross-domain regression tests, and verification evidence are complete. “Foolproof” is not an absolute guarantee.

## Current verification snapshot

- Engine tests: **41/41 passing** in the latest successful run.
- TypeScript (npm run lint): **passed**.
- Production build: **passed**.
- Dependency audit: **0 vulnerabilities reported**; CI has been tightened to fail if any vulnerability is found.
- Latest successful run: https://github.com/jollysingla2000/supply_chain/actions/runs/44433736371
- Newer source and CI security-gate commits are under validation; do not treat the last green run as evidence for later untested changes.
- Production warnings observed: Vite config used __dirname (being corrected to ESM-native import.meta.dirname); large workbook parser chunk remains a performance consideration.
- Client-only limitations remain: persistence uses browser storage; approvals/audit identities are self-attested; no server-side identity, durable server audit, multi-user concurrency, or enterprise SSO is implemented. These prevent enterprise governance from being certified foolproof.

## 26-capability status

| # | Capability | Estimated work done | Foolproof / independently verified? | Status / remaining |
|---:|---|---:|---|---|
| 1 | Workbook upload and ingestion | 90% | No | Multi-format ingestion, file size/extension checks and failure recording implemented; malformed/hostile file and browser runtime coverage still needed. |
| 2 | Multi-sheet detection and ingestion | 92% | No | All worksheets and headers handled; duplicate canonical mappings, duplicate/blank headers and prototype-key regressions tested; large/edge workbook coverage pending. |
| 3 | Source identity and fingerprint | 90% | No | SHA-256 and deterministic canonical workbook hash tested; full identity/lineage threat review pending. |
| 4 | Source workbook persistence and recovery | 80% | No | Malformed saved payloads rejected; preserve/recover UI added; quota, unavailable storage, refresh and browser-level recovery scenarios pending. |
| 5 | Dataset versioning and upload lineage | 80% | No | Active/superseded/rejected records and lineage migration addressed; multi-upload and persistence regression coverage pending. |
| 6 | Column-level profiling | 85% | No | Core profiling present; full type/null/outlier/large-data edge-case matrix pending. |
| 7 | Actual data-type inference | 90% | No | Inference and strict mixed-type tests exist; every type/locale/empty/mixed case needs exhaustive coverage. |
| 8 | Missing values and null analysis | 80% | No | Core missingness checks/remediation present; null vs blank vs whitespace vs sentinel matrix pending. |
| 9 | Schema and mandatory-column validation | 93% | No | Numeric-prefix lookalikes, ambiguous duplicate canonical tables and unknown aliases fail closed; domain-scoped coverage exists; exhaustive contract certification pending. |
| 10 | Schema drift detection | 90% | No | Canonical table resolution is hardened against prefix spoofing; aliases, renames, conflicting mappings and backward-compatibility matrix pending. |
| 11 | Column mapping and collision prevention | 92% | No | Duplicate/blank headers, unknown table mappings, case-insensitive target conflicts and header normalization are handled; broader alias/Unicode/case scenarios pending. |
| 12 | Missing-table/column remediation | 85% | No | Table-level remediation blocked and source re-upload enforced; every table/column remediation path still needs regression coverage. |
| 13 | Data type, format and value validation | 90% | No | Strict numeric/date/value checks, formula-cell rejection and table-scoped remediation type resolution exist; locale, precision, bounds and all field coverage pending. |
| 14 | Duplicate and business-key validation | 80% | No | Business-key checks implemented; cross-table, compound-key, case/trim, deleted-row and duplicate edge matrix pending. |
| 15 | Date, period and time-series integrity | 87% | No | Ambiguous dates rejected, Excel 1900/1904 numeric and text serials normalized, time checks exist; full calendar/timezone/period boundary suite pending. |
| 16 | Master-data and referential integrity | 87% | No | Domain-scoped FK checks and BOM component FK added; canonical table resolver hardened; complete relationship catalog and all domain orphan tests pending. |
| 17 | Cross-table reconciliation | 85% | No | REC-01..REC-05 logic corrected and regression-tested; full source semantics/partial coverage and business-owner review pending. |
| 18 | UOM, currency and quantity consistency | 75% | No | UOM checks exist; conversions, currencies, precision, mixed units and missing rates need exhaustive validation. |
| 19 | Business constraints/domain rules | 80% | No | Threshold validation and domain rules exist; policy provenance, overrides, boundaries and complete rule coverage pending. |
| 20 | Demand Planning Data Assurance | 85% | No | Demand contract and source validation; no forecast accuracy/optimization; end-to-end domain coverage and certification pending. |
| 21 | Supply Planning Data Assurance | 80% | No | Contract isolation and source checks exist; complete table relationships and domain test matrix pending. |
| 22 | S&OP Data Assurance | 80% | No | Domain contract exists; integrated scenario/master coverage and end-to-end validation pending. |
| 23 | MEIO Data Assurance | 80% | No | Domain-scoped contracts and exclusions exist; network/master completeness and domain-specific regression coverage pending. |
| 24 | Procurement Data Assurance | 85% | No | Supplier-specific contract matching and MOQ/order-multiple validation fixed; full contract/source and PO scenarios pending. |
| 25 | Manufacturing Data Assurance | 85% | No | BOM parent/component FK and lead-time scope checks added; complete routing/work-center/BOM constraints and edge coverage pending. |
| 26 | Exception management, quality score, release governance, audit and automated verification | 77% | No | Approval payload validation, persistence sanitation, lineage and hash-bound release gate are tested; server-backed identity/audit, audit immutability, assignment lifecycle and full UI/flow verification are outstanding. |

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
- Workbook ingestion rejects duplicate headers (case-insensitive after trimming), blank headers within a populated header row, and formula cells whose cached results cannot be verified.
- Canonical table resolution is hardened across validation, schema drift, profiling, REC-04, column mapping, remediation type resolution and NPI-specific rules; numeric-prefix lookalikes cannot impersonate a canonical table.
- Approval modals no longer prefill a person's name; the approver must self-enter.
- Automated remediation and demo initialization audit actors are labeled as system/demo actors, not falsely attributed to a named individual.

## Next review priorities

1. Finish CI on the newest commit and inspect build output.
2. Add browser-level tests for upload, recovery, remediations, sign-off, persistence, and navigation.
3. Complete the field-level schema and relationship catalog review for all six domain contracts.
4. Add resource-abuse and hostile-workbook coverage, including zip bombs, extremely large sheets and parser failure handling (formula-cell rejection is implemented).
5. Verify audit/lineage state transitions and correction replay/reversal with sequence tests.
6. Establish the backend identity, access control, server-side audit, and durable persistence design required for true enterprise governance. These are architectural blockers to foolproof certification, not client-side bugs that can be solved by UI changes alone.
