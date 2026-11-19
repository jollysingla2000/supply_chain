# Phase 1 Defect Register

**Repository:** `jollysingla2000/supply_chain`  
**Working target:** `main`  
**Initial state:** **UNTRIAGED**. The values below are intentionally not zero. Counts are not known until the initial source review and test-baseline triage are completed.

## Capability severity summary

| # | Capability | Open Critical | Open High | Open Medium | Open Low | Last defect fixed (UTC date) | Triage status |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | Workbook upload and ingestion | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 2 | Multi-sheet detection and ingestion | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 3 | Source identity and fingerprint | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 4 | Source workbook persistence and recovery | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 5 | Dataset versioning and upload lineage | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 6 | Column-level profiling | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 7 | Actual data-type inference | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 8 | Missing values and null analysis | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 9 | Schema and mandatory-column validation | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 10 | Schema drift detection | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 11 | Column mapping and collision prevention | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 12 | Missing-table/column remediation | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 13 | Data type, format and value validation | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 14 | Duplicate and business-key validation | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 15 | Date, period and time-series integrity | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 16 | Master-data and referential integrity | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 17 | Cross-table reconciliation | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 18 | UOM, currency and quantity consistency | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 19 | Business constraints and domain rules | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 20 | Demand Planning Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 21 | Supply Planning Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 22 | S&OP Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 23 | MEIO Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 24 | Procurement Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 25 | Manufacturing Data Assurance | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 26A | Certification engine: release gate, evidence matrix and audit linkage | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |
| 26B | Governance UI and workflow coverage | UNTRIAGED | UNTRIAGED | UNTRIAGED | UNTRIAGED | Not recorded | Pending |

## Known governance decisions requiring owner disposition

| ID | Area | Decision / risk | Severity | Owner | Due date | Status |
|---|---|---|---|---|---|---|
| DEC-REC03-001 | REC-03 methodology | Current main defaults `stockoutRunRateMethodApproved` to true. Confirm whether the run-rate benchmark has formal business approval; do not silently treat a code default as methodology approval. | Triage required | Unassigned | Not set | OPEN |
| DEC-SCOPE-001 | Domain support | Confirm Inventory/Replenishment as shared Supply/MEIO scope and IBP as cross-domain orchestration, or formally onboard either as a separate domain. | Triage required | Unassigned | Not set | OPEN |

## Defect record template

Create one record per reproducible issue using this shape:

| Field | Required content |
|---|---|
| Defect ID | Stable ID, e.g. DA-001 |
| Capability / requirement | Capability number and A–D requirement ID |
| Severity | Critical / High / Medium / Low |
| Description | Observable incorrect behavior and business impact |
| Reproduction | Dataset fixture hash, domain, steps and expected vs actual result |
| Owner / target date | Named accountable owner and due date |
| Status | Open / In Progress / Fixed Pending Verification / Closed / Risk Accepted |
| Fix evidence | Main commit SHA and regression test ID |
| Verification | CI run ID/URL, reviewer, verified-closed UTC timestamp |

## Rules

- Do not record an empty backlog as “0 defects” until all 26 capabilities have been reviewed against requirements, tests, current main code and domain fixtures.
- A defect is closed only after a regression test reproduces the original failure and passes on the fix commit.
- A Risk Accepted issue remains visible and must have an approver, reason, compensating control and expiry date.
- The summary counts must be reconciled against the individual defect records after every triage.
