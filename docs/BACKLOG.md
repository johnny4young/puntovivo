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

- _(none captured yet — add new items as short bullets with a domain tag and date)_

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`ENG-NNN` ticket. Group into a single `ENG-NNN` when you have ~5
and want to batch them into one sprint.

- _(none captured yet)_

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates to capture here: libSQL migration feasibility, Turso replication latency vs SQLite local-first, Playwright Electron runner for E2E coverage, pt-BR locale bundle effort estimate)_

## 4. Parked feature requests

Requests from operators or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
