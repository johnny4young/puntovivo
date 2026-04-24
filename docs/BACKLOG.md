# Puntovivo — Backlog

> Raw capture for work that **is not yet a commitment**. Anything here has
> not been sized, has no acceptance criteria, or has no priority. It is
> the buffer between "somebody had an idea" and the formal engineering
> backlog in [`docs/ROADMAP.md §3b`](./ROADMAP.md).
>
> **Promotion flow**: when an item here matures — acceptance criteria
> clear, scope sized, priority agreed — move it to `ROADMAP.md §3b` as
> a new `ENG-NNN` row with `Status: Pending`, and delete it from here.
> That is the single migration direction. Items do not demote back.
>
> **What does NOT belong here**: work with clear acceptance criteria
> already (that is a ROADMAP ENG ticket), shipped work (stays in
> ROADMAP with `Status: Shipped`), or deferred ENG tickets (those keep
> their row in ROADMAP with `Status: Deferred`).

## Conventions

- One bullet per item. Keep it short; if it needs more than two lines,
  it is already mature enough to graduate to ROADMAP.
- Tag items with `[domain]` so the list is scannable: `[fiscal]`,
  `[pos]`, `[inventory]`, `[ux]`, `[infra]`, `[bug]`, `[research]`.
- Dated captures welcome (`— 2026-04-23 (jy)`) so decay is visible.
- When you promote an item to ROADMAP, **delete the bullet here** in
  the same commit; do not leave stale duplicates.

## 1. Ideas without acceptance criteria

Product / strategic ideas that have not been sized. A human decides
whether they graduate to ROADMAP, die here, or stay pending more
research.

- `[i18n][infra]` Migrate raw `throw new TRPCError` calls in every
  router other than `sales.ts` to `throwServerError` + a stable
  `errorCode`, so user-facing messages always render in the active
  locale. Today ~170 raw throws are spread across purchases (35),
  geography (21), products (13), inventory + categories (9 each),
  sites + orders (8 each), locations (7), users + customerCatalogs
  (5 each), providers + customers (4 each), vatRates + units + sync
  + receiptTemplates (3 each), sequentials + quotations + logos +
  companies (2 each), transfers (1). The `sales.ts` router was
  migrated during ENG-018/019 as the canonical example. Batching
  the rest into one or two tickets is cheaper than drip-migrating —
  each router needs new codes in `server/src/lib/errorCodes.ts`,
  the matching entry in `web/src/lib/translateServerError.ts`, and
  en/es strings in `web/src/i18n/locales/*/errors.json`. — 2026-04-23 (jy)

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`ENG-NNN` ticket. Group into a single `ENG-NNN` when you have ~5
and want to batch them into one sprint.

- `[sales][testing]` Add a dedicated component test file for
  `apps/web/src/features/sales/SuspendedSalesPanel.tsx`. The panel
  has a non-trivial discard-confirm flow (ConfirmModal → mutation →
  toast), a listDrafts query mapping, and a resume callback — all
  currently exercised only by the ENG-018b E2E round-trip. A
  focused unit test (empty state, draft cards render, discard
  confirm calls mutation, resume callback fires) would catch future
  regressions without needing a full browser. Flagged by the code
  review that landed ENG-018b. — 2026-04-23 (jy)
- `[infra][locale]` Retire the legacy `tenants.settings` JSON blob
  fields `currency`, `timezone`, `dateFormat` now that ENG-017
  resolves locale through `tenant_locale_settings` + the global
  catalogs. The `DEFAULT_TENANT_SETTINGS` constant in
  `apps/web/src/features/auth/AuthProvider.tsx` and the
  `TenantSettings` interface in `apps/web/src/types/index.ts` still
  carry the stale currency/timezone/dateFormat fields; nothing reads
  them anymore. Either delete the fields (breaking type contract,
  needs a minor version bump) or keep them as type-only metadata
  marked `@deprecated`. — 2026-04-23 (jy)

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates to capture here: libSQL migration feasibility, Turso replication latency vs SQLite local-first, Playwright Electron runner for E2E coverage, pt-BR locale bundle effort estimate)_

## 4. Parked feature requests

Requests from operators or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
