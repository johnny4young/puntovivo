# Puntovivo — Sprint Plan

> Tactical execution plan for the next implementation slices.
> `ROADMAP.md` remains the canonical ENG ticket list; this file only keeps
> the active sequence, commit shape, and verification checklist. Historical
> shipped detail lives in [ARCHIVED.md](./ARCHIVED.md).

Updated: 2026-06-01.

## Current Focus

Run one ticket at a time. The first line of a shipping turn is:

```text
Executing <ENG-NNN> — <one-liner>
```

The current focus wave is the product-truth and retail-scope reset:

| Order | Ticket    | Status  | Intent                                                    | Required proof                                                                                                                                       |
| ----- | --------- | ------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `ENG-182` | Shipped | Product doctrine and README truth reset.                  | README, SELLABILITY, ROADMAP §0, docs index, and command docs agree on pnpm 11, Node 24, local-first retail scope, and demo/pilot/production status. |
| 1a    | `ENG-182a` | Shipped | Token-budget cleanup + dead-code hygiene.                 | ROADMAP / BACKLOG / ARCHIVED are compact without losing non-shipped tickets; confirmed-zero-import code/deps are removed; ci + live smoke are green. |
| 2     | `ENG-183` | Shipped | Retail Ring-1 scope gate and module exposure cleanup.     | Fresh retail tenant hides non-core surfaces unless profile/module enables them; tests prove no route/sidebar/palette leaks.                          |
| 3     | `ENG-184` | Shipped | Colombia retail readiness profile and checkout preflight. | `/company` + `/sales` surface fiscal/hardware/sync/payment as optional reminders (never blockers); basic CO DIAN config card ships; en/es + recovery CTAs proven.          |
| 4     | `ENG-185` | Shipped | Fiscal adapter truth guard.                               | Unsupported countries fail with a typed error; mock/draft packs are labelled Demo/Draft across cards, document views, and diagnostics; e-invoicing stays optional.   |
| 5     | `ENG-186` | Shipped | Ring-1 screen focus pass (re-scoped: `/sales` sellability slice). | `/sales` completes the common sale without desktop scroll at 1440x900 (cart + checkout scroll internally); History + Suspended behind a reusable Drawer; live smoke desktop + mobile, en/es. Operations + Setup slices split to `ENG-187`. |
| 6     | `ENG-187` | Shipped | Ring-1 screen focus pass — Operations needs-attention (re-scoped: `/operations` slice). | `/operations` defaults to a Needs-attention queue (server aggregation of retryable sync/fiscal/hardware/payment failures, each row deep-links to its panel) + tested all-clear state; live smoke en/es covered the failure row + CTA. Setup/`/company` restructure split to `ENG-188`. |
| 7     | `ENG-188` | Pending | Ring-1 screen focus pass remainder (Setup/`/company` readiness-hub restructure). | Live smoke on `/company` proves Setup is organized around the readiness checklist rather than a flat 10-tab strip; readiness hub stays the admin landing.                |

## Recommended Sequence

1. Finish `ENG-188` (the screen-focus remainder: Setup/`/company` readiness-hub restructure;
   `ENG-182..ENG-187` shipped — `/sales` sellability under `ENG-186`, `/operations` needs-attention
   under `ENG-187`) before adding more visible restaurant, AI, platform, or hosted scope. Low urgency:
   `/company` already opens on its readiness hub.
2. Resume pending Plan v3 tickets from [PLAN-V3.md](./PLAN-V3.md) only after
   the retail scope reset is true in docs and runtime.
3. Keep gated tickets parked until their gate clears:
   `ENG-021`, `ENG-022`, `ENG-023`, `ENG-059`, `ENG-063`, `ENG-160`, and the
   Brazil NFe slice of `ENG-161`.
4. Run `ENG-164` before hosted-only work (`ENG-157`, `ENG-158`, `ENG-162`) or
   the cross-tenant aggregate slice of `ENG-138`.
5. Run `ENG-165` before `ENG-118` public API exposure.

## Ticket Execution Shape

For each ticket:

1. Read `ROADMAP.md §3b` for the ticket row and acceptance criteria.
2. Read the specialty docs named by the row.
3. Keep edits scoped to the ticket plus collateral fixes needed for truth.
4. Update docs in the same commit when behavior, commands, gates, or product
   claims change.
5. Move long shipped-history detail to [ARCHIVED.md](./ARCHIVED.md) instead of
   extending active planning files.

## Verification Matrix

| Touched area                           | Required command                              |
| -------------------------------------- | --------------------------------------------- |
| Web React/TypeScript                   | `pnpm run ci:web`                             |
| Server/Node/tRPC/DB                    | `pnpm run ci:server`                          |
| Electron main process                  | `pnpm run ci:desktop`                         |
| Web E2E, login, sales, inventory flows | `pnpm run test:e2e:web`                       |
| Electron bootstrap or E2E              | `pnpm run test:e2e:electron`                  |
| Docs-only cleanup                      | `git diff --check` plus link/claim inspection |

Any user-facing UI change also needs live browser or Electron smoke. Tests do
not replace the smoke.

## Closing A Ticket

When a ticket closes:

1. Change its `ROADMAP.md §3b` status to `Shipped`.
2. Append a concise `Shipped:` summary to the scope cell.
3. Capture follow-ups in `BACKLOG.md` or ask the operator before stopping.
4. If the closeout gets long, move detail to `ARCHIVED.md` and leave a link.
5. Keep the commit message conventional and scoped, with no AI co-author
   trailer.
