# Phase 1 — Enterprise Planning Data Assurance Tracker

**Working branch:** `phase1/rec02-effective-price-guard`  
**Pull request:** [#1](https://github.com/jollysingla2000/supply_chain/pull/1)  
**Scope:** Demand Planning, Supply Planning, S&OP, MEIO, Procurement, Manufacturing/Production, Inventory/Replenishment and IBP data assurance.

## Completion rule

A capability is only `COMPLETED — VERIFIED` after implementation, positive and negative tests, boundary/edge-case coverage, regression testing, relevant cross-domain testing, and review of the resulting evidence. A passing CI run alone does not make every capability foolproof. Percentages below are engineering estimates, not test coverage.

## Current tracker

| # | Capability | Work done (est.) | Foolproof? | Status | Main remaining verification |
|---:|---|---:|---|---|---|
| 1 | Excel workbook upload and ingestion | 90% | No | IN PROGRESS | Corrupt/partial files, file-size boundary, rollback on failed import, browser compatibility |
| 2 | Multiple-sheet detection and ingestion | 95% | No | IN PROGRESS | Duplicate headers, hidden sheets, mixed workbook structures and full round-trip cases |
| 3 | Source workbook identity and fingerprint | 90% | No | IN PROGRESS | Cross-runtime hash fixtures, malformed values, and tamper/replay tests |
| 4 | Source workbook persistence after refresh | 80% | No | IN PROGRESS | Quota recovery, corrupted storage, interrupted writes and reload recovery |
| 5 | Dataset versioning and upload lineage | 80% | No | IN PROGRESS | Atomic version transitions, failed upload history and full lineage round-trip |
| 6 | Column-level data profiling | 85% | No | IN PROGRESS | All-domain profiling, empty columns, extreme values and large datasets |
| 7 | Actual data-type inference | 90% | No | IN PROGRESS | Locale-specific values, mixed formats and ambiguous date/number columns |
| 8 | Missing values and null analysis | 75% | No | IN PROGRESS | Null/blank/whitespace/NaN/infinity matrix and optional-field policy |
| 9 | Schema and mandatory-column validation | 90% | No | IN PROGRESS | Full domain-by-domain mandatory contract and malformed schema fixtures |
| 10 | Schema drift detection | 85% | No | IN PROGRESS | Rename, type drift, duplicate aliases and multi-sheet conflict cases |
| 11 | Column mapping and conflict prevention | 85% | No | IN PROGRESS | Ambiguous aliases, partial row coverage and reversible mapping tests |
| 12 | Missing-table and missing-column remediation | 90% | No | IN PROGRESS | Remediation rollback, repeated remediation and post-remediation revalidation |
| 13 | Data type, format and value validation | 80% | No | IN PROGRESS | Exhaustive field-level bounds, locale formats and invalid numeric/date cases |
| 14 | Duplicate and business-key validation | 80% | No | IN PROGRESS | Composite keys across every domain and null/duplicate edge cases |
| 15 | Date, period and time-series integrity | 85% | No | IN PROGRESS | Calendar boundaries, leap years, Excel date systems, timezone and fiscal calendars |
| 16 | Master-data and referential integrity | 85% | No | IN PROGRESS | Full relationship inventory, optional FK semantics and large-master performance |
| 17 | Cross-table reconciliation | 85% | No | IN PROGRESS | Business-owner sign-off on REC-01/02 semantics and broader domain reconciliation |
| 18 | UOM, currency and quantity consistency | 65% | No | IN PROGRESS | Complete conversion model, currency-code coverage and mixed-UOM/FX policy |
| 19 | Business constraints and domain-specific rules | 75% | No | IN PROGRESS | Threshold ownership, rule completeness and cross-industry boundary tests |
| 20 | Demand Planning data assurance | 80% | No | IN PROGRESS | Full Demand contract, source completeness and end-to-end release-gate tests |
| 21 | Supply Planning data assurance | 75% | No | IN PROGRESS | Full Supply contract, inventory/lead-time reconciliation and edge cases |
| 22 | S&OP data assurance | 65% | No | IN PROGRESS | Commercial/pricing inputs, override governance and full contract tests |
| 23 | MEIO data assurance | 75% | No | IN PROGRESS | Network policy coverage, safety-stock bound integrity and cross-table tests |
| 24 | Procurement data assurance | 80% | No | IN PROGRESS | Supplier contract completeness policy, PO/receipt reconciliation and exceptions |
| 25 | Manufacturing data assurance | 75% | No | IN PROGRESS | BOM/work-center completeness, component master rules and capacity/yield edge cases |
| 26 | Exception management, quality scoring, release governance, audit trail and automated verification | 75% | No | IN PROGRESS | End-to-end state recovery, audit actor identity, dataset binding and full release-gate matrix |

## Implemented and regression-tested improvements

- **REC-01:** Forward fulfilment no longer adds reverse-flow returns; zero-net-order over-shipment is detected.
- **REC-02:** Effective-dated price lookup does not use future prices; missing eligible prices are accounted for.
- **REC-03:** Stockout-day source integrity is checked; no uncensored-demand estimate is generated by this reconciliation.
- **REC-04:** Manufacturing BOM parent and component SKU references are validated.
- **REC-05:** Lead-time policy checks are scoped to the selected domain and fail closed when an in-scope source is missing.
- Procurement MOQ/order-multiple checks use the exact supplier × SKU × location contract.
- Excel date ingestion normalizes serial/date cells to ISO dates and clears stale Excel number formats before JSON conversion.
- Workbook fingerprints use typed, structured serialization and preserve source row order because correction approvals reference row indices.
- Original uploaded-file SHA-256 and normalized governed-data fingerprint are tracked separately.
- Unbound or mismatched persisted approvals/sign-offs are rejected; failed browser-storage writes are surfaced to the user.
- Upload lineage distinguishes the active workbook from superseded versions and tracks the governed output hash.
- Ambiguous worksheet-to-table mappings and export names that collide after Excel's 31-character limit are rejected instead of silently overwriting data.
- Forecast inputs are treated as ordinary source data. Phase 1 does **not** score forecast accuracy, bias, reasonableness, model performance, or generate demand estimates. The interactive demand-estimation sandbox was removed from the Data Assurance screen.

## CI evidence and current caveats

- A fully green run at commit `16fb2ea`: **40/40 engine tests passed**, TypeScript checks passed, production build passed, and dependency audit reported **0 vulnerabilities**.
- Later changes include removal of the out-of-scope demand-estimation sandbox, lazy-loaded modules/dialogs, and dataset-hash-bound audit entries. Their latest CI run must be checked before treating those changes as verified.
- The earlier production bundle emitted a large-chunk warning. Lazy loading was added; its effect on bundle sizes is pending CI confirmation.
- The official SheetJS 0.20.3 CDN tarball is used because the npm-registry `xlsx@0.18.5` package had known advisories. Audit reported zero vulnerabilities with the CDN package. Keep the dependency source and integrity/reproducibility under review.
- No capability is marked foolproof or completed at this stage. Business-owner sign-off is still needed for REC-01 billed/returns semantics, REC-02 SKU × ALL-channel fallback, and procurement's mandatory-vs-ad-hoc supplier contract policy.

## Scope guardrails

Phase 1 assures data completeness, validity, consistency, reconciliation, traceability and usability. It does not generate forecasts, optimize forecasts, assess forecast accuracy/bias/reasonableness, optimize supply/inventory/MEIO/procurement/production, or make S&OP consensus decisions.
