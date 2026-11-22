# Capability 1 — architecture constraints and decision record

**Status:** documented constraint; backend implementation is not authorized by this record.  
**Scope:** workbook upload/ingestion and its persistence, audit and recovery guarantees.

## Current architecture boundary

The current application is browser-based. Workbook and governance state persistence is implemented through browser storage. This supports same-browser restoration when storage succeeds, but it is not equivalent to a server-side durable record.

| Concern | Current guarantee | Not guaranteed |
|---|---|---|
| Workbook persistence | Browser-local snapshot can be restored in the same browser profile when storage succeeds | Server-side backup, cross-device recovery, central retention |
| Upload rejection | Invalid uploads should leave the last accepted workbook active | A server transaction or immutable upload ledger |
| Audit attribution | Client-side actor label/attestation is explicitly unauthenticated or system-attributed | Verified human identity, non-repudiation |
| Audit integrity | Client-side audit export is available for inspection | Tamper-proof or append-only server audit |
| Concurrency | Single browser session state | Conflict-free multi-user editing, locking or merge semantics |
| Recovery | Browser reload recovery and visible quota/corrupt-state handling | Disaster recovery, server snapshots, point-in-time restore |
| Access control | No server-authenticated tenant/user authorization in this capability | Enterprise SSO, RBAC enforcement and tenant isolation |

## Decisions required before enterprise server guarantees

1. **Identity and authorization:** select the identity provider and define user, role, tenant and service-account claims.
2. **Persistence model:** select a server database/object store, transaction boundaries, versioning and atomic workbook/state commit behavior.
3. **Audit model:** define append-only event storage, cryptographic integrity/tamper evidence, actor identity, timestamps and export verification.
4. **Concurrency:** define optimistic version checks, conflict resolution, locking policy and idempotency for retries.
5. **Retention and recovery:** define retention periods, backup frequency, RPO/RTO, restore testing and deletion/legal-hold policy.
6. **Security boundary:** define upload quarantine, malware scanning policy, encryption in transit/at rest, authorization checks and operational monitoring.
7. **Availability and scale:** define workload SLOs, maximum object sizes, storage quotas, rate limits and failure behavior.

## Non-goals and safeguards

- Do not add an unapproved backend, identity provider, database or cloud storage service as part of Capability 1 verification.
- Do not describe localStorage as immutable, server-authenticated or enterprise durable.
- Keep browser quota failures visible and preserve the previous durable snapshot.
- Keep the current 100 MiB upload, 5M-cell and 3 GiB memory thresholds unchanged unless a separately reviewed requirement decision authorizes a change.
- Keep formal certification at 0/26 until implementation and evidence satisfy the approved criteria.

## Acceptance path

This document records the current architecture gap and the decisions needed to close it. It is not evidence that server recovery, immutable audit, authenticated identity or multi-user concurrency has been implemented. Those require a separately approved architecture and implementation plan.
