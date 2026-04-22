# E2E — Web suite

Playwright tests that drive the real web app (`apps/web`) against the real
backend (`packages/server`) with `better-sqlite3` storage. 25 tests, all
parallelisable.

## Run

```sh
npm run test:e2e:web
```

What happens behind that command:

1. `scripts/ensure-playwright-browser.mjs` installs Chromium into
   `.playwright-browsers/` if the cache is cold (subsequent runs are free).
2. `native:ensure:node` ensures `better-sqlite3` is built for the Node
   runtime (Playwright's `globalSetup` runs in Node, not Electron — the
   desktop build of better-sqlite3 has a different ABI).
3. Playwright spins up `npm run dev:server` (port 8090) and
   `npm run dev:web` (port 3000) unless they are already listening
   (`reuseExistingServer: !CI`).
4. `e2e/web/global-setup.ts` prepares the tenant for testing:
   - Prunes artefacts from prior runs (old E2E products, providers,
     sales, purchases, transfers, cash sessions, audit rows, disposable
     users) so the product list stays small and tests stay fast.
   - Ensures a secondary site (`E2E Branch Site`) so the tenant has at
     least two active sites for inventory transfers.
   - Creates four template users (`e2e.admin`, `e2e.manager`,
     `e2e.cashier`, `e2e.viewer`) with the shared password
     `PuntovivoE2E!123`.
5. Each test seeds its own unique actors (via `seedSaleScenario`,
   `seedPurchaseScenario`, `seedTransferScenario`,
   `seedCashSessionScenario`, `seedCashierWithoutSession`) so tests never
   share mutable state.

## Re-run a single test

```sh
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers \
  ./node_modules/.bin/playwright test --config=playwright.web.config.ts \
  -g "cashier closes a cash session with an overage"
```

## What the suite covers

### Smoke (`smoke.spec.ts`)

- Admin traverses every sidebar module without client-side console
  errors, network errors, or unhandled `pageerror` events.
- Admin shell renders multi-site selector and a tablet viewport (820x1180)
  does not introduce horizontal scroll.
- Route gating — manager, cashier, and viewer each hit routes outside
  their role and get redirected to their default landing.
- Spanish localisation — the main navigation and dashboard shell render
  in `es` when `puntovivo-language-preference=es`.

### Business flows (`business.spec.ts`)

Sales:

- Cashier completes a sale and only sees role-appropriate actions.
- Manager refunds a completed sale — stock restores, `sale.return` audit
  is persisted, Sales and Inventory reflect the refund.
- Admin voids a completed sale — stock restores, `sale.void` audit row.
- Manager adjusts stock — aggregate and per-site balances land in
  lockstep, `inventory.adjust_stock` audit row.
- Cashier completes a split-payment sale — the details drawer renders one
  row per tender.

Purchases:

- Manager records a completed purchase — inventory goes up at the
  receiving site, provider + status render in the details drawer.
- Manager returns part of a purchase — purchase status flips to
  `partial_returned`, inventory goes back down, reason persists.
- Admin voids a purchase — `purchase.void` audit row, stock rolls back.

Transfers:

- Manager transfers stock with a discrepancy — destination is credited
  the **received** quantity, origin keeps the full debit, discrepancy
  notes appear in the history row and the details drawer.
- Manager receives a transfer with no discrepancy — destination gains
  exactly what was shipped; no "Discrepancy" badge.
- Manager cannot confirm a receipt claiming more than was shipped —
  the Confirm button stays disabled and the transfer stays in transit.

Cash sessions:

- Cashier opens a cash session from zero with a balanced denomination
  count.
- Cashier records a manual paid-in movement and the active drawer balance
  increases accordingly.
- Cashier closes a register with an overage — over/short is positive,
  `cash_session.close` audit row, closure renders in the Sales report.
- Cashier closes with a shortage — negative over/short, audit row.
- Cashier closes exactly balanced — zero over/short, audit row.

## Test-design conventions

- Every test seeds unique data (product SKU + email + register name all
  include a `randomUUID` suffix) so parallel runs don't collide.
- `data-row-id="<domain id>"` on every DataTable row lets tests pick a
  specific row even when other parallel tests create siblings.
- Cross-cutting helpers (`login`, `resetSession`, `switchToSite`,
  `attachClientIssueTracker`) live in `e2e/web/support/app.ts`.
- DB readers / seeders live in `e2e/web/support/db.ts`. They use raw
  SQL so they don't drag in the server's tRPC stack or TanStack Query
  cache.
- The client-side issue tracker asserts there are **zero** console
  errors, page errors, or unexpected failed HTTP responses at the end
  of every test. Known transient lines (Vite handshake, 401 on initial
  `auth.refresh`) are whitelisted explicitly in `support/app.ts`.

## Free / Pro licensing

There is **no Free / Pro licence tier in the Puntovivo codebase today**.
The roadmap (`docs/ROADMAP.md` and `docs/PLAN.md`) does not mention any
per-tenant feature flag or billing tier. The suite therefore does NOT
model Free vs Pro scenarios — doing so without a real implementation
would be speculative testing.

When / if licensing lands, each gated feature gets a dedicated scenario
(e.g. `seedProScenario` that flips the tenant's licence), and the
smoke + business suites are extended with positive-and-negative tests
per tier.

## CI

`.github/workflows/ci.yml` currently runs the three `ci:*` scripts
(web, server, desktop). The e2e web suite is **not yet wired into CI**
because it needs the two dev servers and a writable SQLite file on a
Linux runner — `test:e2e:web` works end-to-end locally today, but CI
integration is tracked as the next step of ENG-001 in the roadmap.
