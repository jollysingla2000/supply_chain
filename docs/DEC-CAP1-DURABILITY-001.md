# DEC-CAP1-DURABILITY-001 — Durable workbook recovery architecture

- **Status:** Proposed / blocked pending platform and product decisions
- **Date:** 2026-11-22
- **Scope:** Capability 1 workbook upload, identity, versioning, recovery

## Context

Capability 1 currently persists workbook/governance state in browser-local storage. Browser reload and interrupted-write recovery have CI evidence, but this does not provide cross-device recovery, authenticated ownership, server durability, immutable audit, or concurrency controls. The repository does not currently define an authenticated backend or a durable storage service that can be safely extended for this capability.

## Decision

Do not implement a server persistence shim or mark server durability verified without an approved service boundary and deployment environment. Treat server-side recovery as an architecture blocker. The proposed target is an authenticated API backed by durable object storage for workbook binaries and a transactional metadata database for dataset versions, content hashes, ownership/authorization, retention state, and audit linkage.

## Required controls before implementation

1. Authentication and authorization: user/tenant identity, ownership, role-based access, least privilege, and cross-tenant isolation tests.
2. Upload: server-enforced byte/cell/sheet limits, content-type-independent file validation, malware/content policy as required, bounded parsing, and upload cancellation semantics.
3. Storage: encrypted-at-rest and in-transit, versioned object keys, SHA-256 content identity, integrity checks, durable write-before-ack semantics, and idempotent upload/version creation.
4. Metadata: transactional dataset-version records; optimistic concurrency/version conflict policy; lifecycle/retention and deletion semantics.
5. Audit: authenticated append-only events, tamper-evidence, actor/time/source/version/hash fields, export policy, and retention.
6. Recovery: cross-device restore, interrupted upload/write behavior, corruption detection, backup/restore testing, and documented RPO/RTO.
7. Operations: monitoring, quotas, backup drills, incident response, cost/resource limits, and deployment ownership.

## Acceptance evidence

A future implementation must demonstrate authenticated upload and retrieval; access-denial and tenant-isolation negatives; upload corruption/partial-write recovery; version conflict handling; restore from backup; retention/deletion; audit integrity; and load/resource behavior at supported workbook sizes. No acceptance criterion is met merely by localStorage tests.

## Unresolved decisions

Backend hosting/runtime, identity provider/SSO, database and object-store selection, tenant model, retention policy, RPO/RTO, deployment owner, and cost limits are not yet defined. Therefore this decision is not authorization to provision or connect external infrastructure.
