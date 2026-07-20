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
The product does not define any
per-tenant feature flag or billing tier. The suite therefore does NOT
model Free vs Pro scenarios — doing so without a real implementation
would be speculative testing.

When / if licensing lands, each gated feature gets a dedicated scenario
(e.g. `seedProScenario` that flips the tenant's licence), and the
smoke + business suites are extended with positive-and-negative tests
per tier.

## CI

`.github/workflows/ci.yml` runs four jobs: `web`, `backend`, `desktop`
(matrix: ubuntu / macos / windows), and **`e2e-web`** (added in
Step 3). The `e2e-web` job runs on `ubuntu-latest`:

- Caches the Playwright browser binary in `.playwright-browsers/` keyed
  on `package-lock.json` hash. A `@playwright/test` bump changes the
  lockfile and invalidates the cache automatically.
- Installs Chromium + system deps via `npx playwright install --with-deps chromium`.
- Runs `npm run test:e2e:web` with a 30-minute timeout.
- Uploads `playwright-report/web/` on every run (pass or fail); uploads
  `test-results/playwright-web/` (traces, screenshots, videos) on
  failure only. Retention 7 days.

Electron in CI is explicitly deferred — see the next section.

## Electron runner

The Electron suite (`e2e/electron/`) is a smoke runner that launches
the Electron main process against a pre-seeded tmpdir DB and drives
the renderer as a regular Playwright `page`. It exists to catch
main-process regressions (IPC bridge, sandbox flags, embedded-server
boot) that the web suite cannot reach. Full role / business-flow
coverage stays in the web suite.

### Prerequisites

Run Electron E2E through the root script:

```sh
npm run test:e2e:electron
```

That command rebuilds the Electron main + preload bundles and copies
Drizzle migrations into `.vite/build/migrations/` before Playwright
starts. Do not use `vite build --config vite.main.config.ts` as a
shortcut: Forge injects the Electron entry points, and plain Vite
builds the wrong target. If you invoke Playwright directly, rebuild the
bundles first:

```sh
npm run build:main --workspace=@puntovivo/desktop
```

If the bundles are missing, `scripts/ensure-electron-main-build.mjs`
fails fast with the same command.

### Run

```sh
npm run test:e2e:electron

# or web + electron back-to-back:
npm run test:e2e
```

What happens:

1. `@puntovivo/server` is built so the compiled DB bootstrap helpers
   are importable.
2. The desktop preflight verifies the Electron runtime binary exists
   and has a valid macOS code signature when running on macOS. It can
   also repair a corrupt local Electron.app with a fresh install plus
   ad-hoc signing.
3. `build:main --workspace=@puntovivo/desktop` rebuilds the Vite main
   - preload bundles that Electron launches and copies Drizzle
     migrations beside the bundled server.
4. `ensure-electron-main-build.mjs` verifies the rebuilt bundles are
   present.
5. The Node ABI for `better-sqlite3` is restored so Playwright
   `globalSetup` can seed the DB from Node.
6. Playwright starts `npm run dev:web` to serve the renderer bundle.
   Electron still starts its own embedded Fastify server; the web
   server is not the application backend for this suite.
7. `playwright.electron.config.ts` runs `e2e/electron/global-setup.ts`
   which:
   - Wipes `test-results/electron-userdata/` from prior runs.
   - Calls `initDatabase({ dbPath: <tmpdir>/data/local.db })` so the
     fresh DB runs the full drizzle migrations + default-data seed.
   - Runs `prepareBaseline()` from `e2e/shared/baseline.ts` to upsert
     the 4 template users and ensure the secondary site exists.
8. For each test, the `electronApp` fixture in
   `e2e/electron/fixtures.ts` swaps `better-sqlite3` to the Electron
   ABI, launches Electron with `--user-data-dir=<tmpdir>`, forwards
   Electron stdout/stderr/exit status into the Playwright output, and
   restores the Node ABI after closing the app. The `page` fixture
   yields `electronApp.firstWindow()`.
9. Workers=1 (the Electron smoke serialises — two concurrent launches
   would race the WAL on the tmpdir DB).

### Coverage

Currently one test — `smoke.spec.ts`:

- Electron launches without crashing.
- Login form renders.
- Admin logs in with the seeded `e2e.admin@local.test` /
  `PuntovivoE2E!123` credentials.
- `/dashboard` URL loads.
- No `console.error` / `pageerror` events fire during the flow.

### Troubleshooting

If Playwright reports `Target page, context or browser has been closed`
before the login form renders, first verify the Electron runtime itself:

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --version
```

On macOS this must print the Electron version, for example `v41.2.2`.
Do not pass Node-style `-e` snippets to the Electron binary; Electron
interprets the snippet as an app path and opens a misleading "Unable to
find Electron app" dialog.

If `--version` exits with `SIGABRT` from a sandboxed agent session but
works in a normal terminal, rerun the Electron UI smoke from a session
that has permission to launch GUI apps. If it fails in a normal terminal
too, run `npm run electron:ensure:binary --workspace=@puntovivo/desktop`
followed by `npm run rebuild --workspace=@puntovivo/desktop`.

### Not in CI

The Electron suite is **local-only**. Running Playwright Electron on
Ubuntu CI still needs `xvfb` and CI-specific GUI hardening around the
Electron launch. Deferred as a follow-up; will land when signed release
builds approach.
