# Capability 1 — evidence audit (working document)

**Original baseline under review:** `de34f27b435c2b0a755517bbdec13ee204e1a9b2` on `main` (historical; refresh evidence below before sign-off)  
**Rule:** A passing PR workflow verifies only that PR's code and tests. It does not certify Capability 1. Do not move an acceptance criterion to verified without a named test, exact commit, completed CI run, and retained artifact.

## Current fresh CI evidence

| Evidence | Commit / branch | Run | Result | Scope |
|---|---|---:|---|---|
| ZIP64 validation ordering | `main` / `de34f27b435c2b0a755517bbdec13ee204e1a9b2` | [#743](https://github.com/jollysingla2000/supply_chain/actions/runs/45011688880) | Passed | Main-branch engine tests, TypeScript, production build, browser E2E and evidence upload |
| ZIP data descriptor signed/unsigned handling | `cap1/ws1-zip-security` / `f6f7fbaf62f6948bc5bfdd50cbcc2d41ea23bb05` | [#744](https://github.com/jollysingla2000/supply_chain/actions/runs/45011932657) | Passed | PR #3 tests; not merged |
| Browser quota recovery | `cap1/ws3-browser-recovery` / `b41e3131506fecf81ce5f87e91c28fda04f9fd49` | [#745](https://github.com/jollysingla2000/supply_chain/actions/runs/45011937306) | Passed | PR #4 tests; not merged |
| Benchmark environment metadata | `cap1/ws5-runner-repeatability` / `267898d08d927e494ffccbd827bd65f90cffb250` | [#746](https://github.com/jollysingla2000/supply_chain/actions/runs/45011942633) | Passed | PR #6 tests; metadata change not merged |

## Acceptance evidence still required

| Workstream | Required proof | Current state |
|---|---|---|
| ZIP security | Complete hostile archive matrix, including CRC payload integrity distinction, ZIP64, descriptor ambiguity, encryption, metadata mismatch, overlap, EOCD and path-name cases | Partial; PR #3 passed but not merged; actual payload CRC verification must not be claimed without proof |
| Upload-state preservation | Accepted workbook and persisted governance snapshot remain byte-for-byte unchanged after rejected upload and reload | Existing source-preservation E2E exists; strengthened snapshot test is in this workstream branch |
| Browser recovery | Quota failure preserves last durable snapshot; reload restores durable state and does not claim session-only state was persisted | PR #4 passed; not merged |
| Combined limits | Exact and over-boundary tests across worksheet count, per-sheet columns, total rows and total estimated cells; include realistic combinations | New sparse combined-boundary tests pending CI |
| Memory repeatability | Retain 5M-cell fixture and 3 GiB ceiling; repeated runs record GC availability, baseline/peak RSS, runner/Node and separate ingestion/validation/round-trip metrics | #743 passed at 2.649 GiB sampled ingestion peak; repeated controlled-runner proof still open |
| Multi-sheet/state | Hidden-sheet retention, duplicate canonical mapping rejection, state import/export and selected-sheet persistence | Selected-sheet E2E already exists; added hidden/duplicate mapping test pending CI |
| Evidence reconciliation | Reconcile every criterion to test, commit, run and artifact; update tracker only after evidence exists | This audit is a working matrix, not final sign-off |
| Architecture | Record browser-only persistence, unauthenticated actor, mutable client audit and absent server recovery/concurrency guarantees; identify decisions requiring approved backend | Architecture decision record in separate workstream |

## Known limits and cautions

- The 100 MiB byte boundary, 500,000-row limit, 5,000,000-cell limit, 1,000-column limit and 100-worksheet limit are separate existing acceptance checks. The new combined fixture adds interaction coverage; it does not establish a 100 MiB × 5M-cell workload.
- The 5M-cell benchmark remains subject to a strict 3 GiB sampled-RSS ceiling. A single pass does not prove controlled-runner repeatability.
- Browser-local storage is not server-authenticated, immutable, multi-user or durable server-side evidence.
- Historical failed runs remain failed in GitHub history; fresh passing runs are the evidence for corrected code.
- Phase 1 certification remains 0/26 until the formal certification standard is met.
