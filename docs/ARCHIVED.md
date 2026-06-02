# Puntovivo Archived Work

This file is the parking lot for shipped, retired, superseded, or historical
planning detail. Active planning files should stay short:

- `ROADMAP.md` keeps the current ENG status and acceptance criteria.
- `SPRINT-PLAN.md` keeps the next execution sequence.
- `BACKLOG.md` keeps unsized ideas and follow-ups only.

When a shipped summary becomes long enough to hide current work, move the
detail here and leave a one-line closeout plus this link in the active file.

## ARCHIVED: Implemented Work

### Core POS Foundation

The early roadmap phases are implemented and no longer drive active planning:

- Foundation, schema, transport baseline.
- Administration and master catalogs.
- Product management and pricing.
- Site-owned inventory.
- Sales, cash sessions, returns, voids, split tender, suspended carts, and
  receipt reprint.
- Procurement, quotations, reporting, sync, desktop operations, and UX polish.

The canonical current capability status is still
[ROADMAP.md §0](./ROADMAP.md#0-mvp-colombia--definition-of-done) and
[SELLABILITY.md](./SELLABILITY.md).

### Plan v2.0 History

`ENG-025..ENG-040` closed the Q2 hardening and expansion bridge:

- Security, dependency, dead-code, and helper cleanup.
- Vercel AI SDK provider foundation, co-pilot analytics, anomaly detection,
  semantic product search, OCR, voice transcription, and Ollama support.
- Fiscal core refactor plus Mexico and Chile foundation/XML modeling slices.
- Sync/payment rails investigation and implementation slices.
- Restaurant table/tip/service/modifier/KDS/voice-ordering slices.

Remaining gated or follow-up work from this wave stays in `ROADMAP.md` or
`BACKLOG.md`; the shipped implementation narrative belongs here when it is
too verbose for active planning.

### Foundation Reset And Authority Node

`ENG-051..ENG-076` established the architectural rails that now constrain new
work:

- ADR pack for local authority, command envelope, outbox taxonomy, and conflict
  policy.
- Device identity, idempotency, operation journal, sale lifecycle extraction,
  and cash-session aggregate boundary.
- Fiscal outbox, receipt finalization, peripheral registry, barcode/print
  foundations, sync/operations/resilience lanes.
- Authority Node runtime modes: `device_local`, `site_hub`, and `hub_client`.

Active follow-ups remain ticketed in the roadmap instead of copied here.

### Website And Capability Truth

`ENG-096..ENG-102` and related out-of-band work tightened public claims,
website copy, offline capability truth, and status documentation. Stronger
external marketing claims must continue to map to shipped runtime capability
or an explicit roadmap ticket.

### 2026-05-24 Audit Closure

`ENG-166..ENG-181` closed the security, data-integrity, frontend-performance,
and code-quality audit waves:

- Security hardening, helmet/CSP, auth timing, Argon2 policy, strict schemas,
  procedure rate limits, and print HTML sanitization.
- SQLCipher groundwork, PRAGMA tuning, composite indexes, FK policy, money
  rounding/storage checks, token/session lifecycle, and optimistic versioning
  slice.
- Web bundle optimization, lazy i18n, render/fetch hygiene, DataTable
  virtualization, CLS polish, and Web Vitals RUM ingestion.
- Error-code cleanup, TypeScript strictness, lint tightening, and critical
  logic docblocks.

The focus-reset wave after this audit is `ENG-182`, `ENG-182a`, and
`ENG-183..ENG-186`; only `ENG-183..ENG-186` remain pending, alongside the
remaining pending/gated Plan v3 tickets.

### Archive Migration Status

As of 2026-06-01, the active sprint plan and top-level onboarding docs have
been compacted. A first pass compacted the 26 most verbose `ROADMAP.md §3b`
shipped rows; a second pass (2026-06-01) extended that across the remaining
verbose `§3b` shipped closeouts and the `§2` Tier inline prose, taking
`ROADMAP.md` from ~444 KB to ~280 KB, and slimmed `BACKLOG.md` items to
one-line bullets. Every shipped closeout is now a concise
one-to-three-sentence summary that keeps the ticket's scope, the shipped
result, and the acceptance criteria. The full implementation logs live in git
history; the load-bearing invariants live in the `AGENTS.md` marker index; the
wave-level narrative lives in the clusters above. `Pending`, `Partial`,
`Gated`, and `Deferred` rows were left untouched because they still drive the
active pool. The same pass applied only confirmed-zero-import hygiene (dead
renderer/storage/component shims, unused deps, shared tenant-site guard, and
`dev:stop` orphan cleanup) and captured larger cross-cutting follow-ups
(design-system canonicalization, i18n fallbacks, server duplication) into
`BACKLOG.md`. When a future shipped row grows verbose again, apply the same
compaction.

## ARCHIVED: Retired Or Superseded Planning

Use this section when an item is intentionally not going to be done as written.
Record:

- original ticket or backlog handle,
- date archived,
- reason,
- replacement ticket if one exists.

Current examples:

- `ENG-037` libSQL/Turso embedded replicas: spike recommended defer after the
  current Turso/embedded-replica conflict model failed the local-authority
  requirement. Replacement path is the bespoke sync outbox plus a future hosted
  substrate spike.
- Older npm-based onboarding instructions: superseded by pnpm 11 + Node 24 in
  the root README and AGENTS guidance.

## Archive Policy

- Do not move active `Pending`, `Partial`, `Gated`, or `Deferred` rows here.
- Do not archive external gates just because they are inconvenient.
- Keep links from the active file to the archived detail when a shipped summary
  is compacted.
- Prefer one paragraph per shipped cluster over copying entire old roadmap
  rows verbatim.
