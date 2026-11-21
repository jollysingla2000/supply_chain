# Phase 1 Domain Support and Onboarding Matrix

## 1. Primary planning domains

The current product contract declares six primary planning domains. Each is independently gated; a domain is not supported simply because its selector or contract exists.

| Domain | Key | Current implementation evidence | Mandatory onboarding evidence before SUPPORTED |
|---|---|---|---|
| Demand Planning | DEMAND | Demand source contracts, validation and REC rules exist. | Forecast/source tables, grains, keys, time-series rules, governed adjustments, fixtures and UI flow. |
| Supply Planning | SUPPLY | Supply contracts, inventory checks and source validation exist. | Supply network, inventory, replenishment dependencies, UOM, lead-time and capacity fixtures. |
| S&OP | SOP | Domain contract and domain isolation exist. | Demand/supply/finance scenario joins, version/scenario keys, reconciliation and integrated fixtures. |
| MEIO | MEIO | Domain contract, network constraints and MEIO checks exist. | Echelon/network graph, stocking policy, service targets, inventory constraints and FK fixtures. |
| Procurement | PROCUREMENT | Supplier × SKU × Depot contracts, MOQ and order-multiple checks exist. | Effective-dated supplier terms, PO/receipt linkage, substitutions, currency and contract fixtures. |
| Manufacturing | MANUFACTURING | BOM, component FK, cycle, yield/scrap and work-center capacity logic exist. | Routing, work-center calendar/shift, shared capacity, alternate BOM and production-order fixtures. |

**Current status:** all six remain **IN VERIFICATION**, not certified Supported.

**Automated gate evidence:** the Requirement D regression test passed for all six domains in [CI run #652](https://github.com/jollysingla2000/supply_chain/actions/runs/44866538786) on commit `1d82dc505df45fdcf6811be8ee2c61be621ef37e`. It covers mandatory/optional table declarations, business keys, FK orphan behavior, per-domain REC applicability and cross-domain isolation. This validates the automated onboarding-gate matrix; it does **not** complete the 12-item domain evidence pack (notably full domain-specific fixtures, browser workflows, scale/defect evidence and named owner/technical-certifier approval). Therefore no domain status is promoted to **SUPPORTED**.

## 2. Shared and cross-domain scopes

| Scope | Provisional treatment | Required confirmation |
|---|---|---|
| Inventory / Replenishment | Shared data capability consumed by Supply and MEIO; not currently a separate PlanningDomainKey. | Business owner must confirm whether it needs an independent domain contract, rule set and release gate. |
| IBP | Cross-domain orchestration across Demand, Supply, S&OP, MEIO, Procurement and Manufacturing; not currently an independent PlanningDomainKey. | Business owner must confirm whether IBP needs a separately supported domain and scenario contract. |
| ALL | Aggregate execution mode, not a seventh business domain. | Must prove domain applicability and non-applicable rule behavior without cross-domain contamination. |

## 3. Domain onboarding checklist

For each of the six domains, the evidence pack must contain:

1. Canonical table inventory with mandatory/optional status.
2. Required columns and explicit field data types, units and date semantics.
3. Business keys and all source/target foreign-key contracts.
4. Dependency graph and rule applicability map.
5. Mandatory validation categories and behavior for absent optional inputs.
6. All applicable reconciliation rules with equation, grain, tolerance and exclusions.
7. Positive, negative, boundary, orphan, ambiguous-mapping and malformed-data fixtures.
8. Remediation and correction governance scenarios, when applicable.
9. Cross-domain isolation tests: irrelevant domain tables must neither pass nor contaminate another domain's checks.
10. Browser workflow evidence for upload, results, remediation, approval and export.
11. Coverage, defects, performance, commit and CI evidence.
12. Named business owner and technical certifier.

## 4. Status gate

- **IN VERIFICATION:** implementation exists, but one or more required evidence items are missing.
- **SUPPORTED:** all mandatory onboarding checklist items pass and are tied to a current commit/CI run.
- **BLOCKED:** critical defect, missing required source/contract, unapproved rule, or failed gate.
- **NOT APPLICABLE:** only for an explicitly documented rule/scope exclusion; never use it to conceal an unexecuted mandatory validation.

No domain may move to SUPPORTED solely because it has tables in `DOMAIN_CONTRACTS` or passes a single happy-path fixture.
