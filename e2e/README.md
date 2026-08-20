# End-to-end validation

Playwright tests that drive the real web app (`apps/web`) against the real
backend (`packages/server`) with `better-sqlite3` storage, plus a serial
Electron suite that drives the real desktop runtime in development or from a
packaged application.

## Run the web suite

```sh
pnpm run test:e2e:web
```

For the bounded four-journey development/CI contract only:

```sh
pnpm run test:e2e:web:critical
```

That serial subset reuses the indexed first-sale, exact manager-approval,
immutable day-close, and discrepant inventory-transfer journeys. It covers one
real mutation plus persisted read-side path in each critical operating area;
it is a fast protection layer, not a replacement for the complete suite.

For the opt-in same-renderer long-shift contract:

```sh
pnpm run test:e2e:web:soak
```

The soak keeps one authenticated React tree alive, warms its finite route and
query caches, then performs 30 measured product/sales modal and drawer cycles.
Chromium GC runs before each checkpoint; the final sample must stay within the
retained heap, document, DOM-node, and listener growth ceilings in
`perf-budget.json::longShiftSoak`. It also opens the real purchase OCR dialog,
holds upload persistence in flight, closes the surface, and proves that the
exact preview Blob URL is revoked before the late response completes. The
ordinary `test:e2e:web` command excludes this tagged soak so its 106 functional
journeys remain bounded.

What happens behind that command:

1. `scripts/ensure-playwright-browser.mjs` installs Chromium into
   `.playwright-browsers/` if the cache is cold (subsequent runs are free).
2. `native:ensure:node` verifies that the bundled Node-API SQLite addon loads
   under Node before Playwright's `globalSetup` touches the database.
3. Playwright spins up `pnpm run dev:server` (port 8090) and
   `pnpm run dev:web` (port 3000) unless they are already listening
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

Push and pull-request CI uses path-filtered workspace gates. The full Playwright
web suite and the Electron suite remain local-only so ordinary changes do not
consume the expensive browser/runtime minutes. The web job does run the bounded
four-test `test:e2e:web:critical` contract after `ci:web`, with one worker, no
retries, and retained diagnostics on failure. Run `pnpm run test:e2e:web`
locally whenever login, sales, inventory, imports, or a browser flow changes.
Run `pnpm run test:e2e:web:soak` after lifecycle, modal/drawer, query-cache, or
renderer-memory changes; CI still runs its pure comparator and command-contract
tests without paying the live soak cost.

Cross-platform desktop validation lives in the manual
`.github/workflows/build-desktop.yml` workflow. Its full-build mode packages
the selected immutable commit on Linux, macOS, and/or Windows, runs the
packaged runtime smoke, and uploads candidate evidence. Signing and
notarization remain release-workflow responsibilities.

## Electron runner

The Electron suite (`e2e/electron/`) launches the main process against an
isolated copy of a pre-seeded database and drives the renderer as a regular
Playwright `page`. It catches main-process regressions (IPC bridge, sandbox
flags, embedded-server boot) and ports selected shift-defining journeys to the
desktop target. The full role and business-flow matrix remains in the web
suite.

### Prerequisites

Run Electron E2E through the root script:

```sh
pnpm run test:e2e:electron
```

That command rebuilds the Electron main + preload bundles and copies
Drizzle migrations into `.vite/build/migrations/` before Playwright
starts. Do not use `vite build --config vite.main.config.ts` as a
shortcut: Forge injects the Electron entry points, and plain Vite
builds the wrong target. If you invoke Playwright directly, rebuild the
bundles first:

```sh
pnpm --filter @puntovivo/desktop run build:main
```

If the bundles are missing, `scripts/ensure-electron-main-build.mjs`
fails fast with the same command.

### Run

```sh
pnpm run test:e2e:electron

# or web + electron back-to-back:
pnpm run test:e2e

# drive a freshly packaged macOS directory instead of the dev bundle:
PUNTOVIVO_PACKAGED_APP=apps/desktop/out-builder/mac-arm64 \
  pnpm run test:e2e:electron:packaged
```

For representative release evidence, use the stricter external wrapper from a
normal interactive Terminal/iTerm/Windows Terminal session, never from Codex,
XCTest, CI, or another injected automation host:

Generate a fresh correlation id with `node -p "crypto.randomUUID()"`, then use
it in the command and the matching Gate 5 draft:

```sh
pnpm run test:e2e:electron:external -- \
  --candidate-root /absolute/path/to/a/clean/candidate-worktree \
  --packaged-app /absolute/path/to/the/installed/signed/Puntovivo.app \
  --session-id 018f6f8c-4e5b-7a21-8abc-1234567890ab \
  --output .artifacts/gate5/current-host/external-electron.json
```

The wrapper refuses a dirty candidate tree, missing packaged target, non-TTY
execution, `TERM=dumb`, and CI/Codex/XCTest/dynamic-library-injection signals
before launching Electron. It drives the installed signed candidate through
the packaged CDP fixture, then writes a sanitized report bound to the candidate
SHA, app/Electron/Node versions, OS/architecture, exact command, duration, Gate
5 session UUID, and exit result. It never contains the hostname, local path,
device identifier, or user identity. A failed suite remains failed evidence;
there is no allowlist for `SIGTRAP`, `SIGABRT`, or Apple private-framework
exceptions. The session UUID is an evidence correlation id, not a machine
identity; use the same value in the Gate 5 draft.

`--candidate-root` is especially important for a released historical SHA: the
wrapper lives in the current tooling checkout but executes `pnpm run
test:e2e:electron:packaged` inside the separate clean candidate worktree while
`PUNTOVIVO_PACKAGED_APP` points at the installed artifact. Install that
worktree's dependencies and native bindings first. See the representative Gate
5 section in `docs/TESTING.md` for the signed-install/upgrade/downgrade artifact
contract.

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
5. The shared Node-API SQLite binary is verified under Node so Playwright
   `globalSetup` can seed the DB.
6. Playwright starts the web workspace's `dev` command to serve the renderer
   bundle.
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
   `e2e/electron/fixtures.ts` verifies the same Node-API addon under Electron,
   launches Electron with `--user-data-dir=<tmpdir>`, and forwards Electron
   stdout/stderr/exit status into the Playwright output. The `page` fixture
   yields `electronApp.firstWindow()`.
9. Workers=1 (the Electron suite serialises — two concurrent launches
   would race the WAL on the tmpdir DB).

### Coverage

The suite contains one platform smoke plus ten target-agnostic operator
journeys:

- `smoke.spec.ts` — launch, login, application shell, device configuration,
  audit history, backup, cloud-vault, and restore readiness.
- `first-sale.spec.ts` — product creation, drawer opening, first charge, and
  completion feedback.
- `suspended-cart.spec.ts` — park one cart, charge another, then resume and
  charge the first.
- `split-tender.spec.ts` — settle one sale across cash and card.
- `manager-approval.spec.ts` — keep the exact cashier checkout mounted while
  an eligible manager presents a fresh PIN, then prove one-use grant
  consumption and correlated immutable audit evidence.
- `blind-close.spec.ts` — close a drawer with a discrepancy without revealing
  the expected balance first.
- `day-close.spec.ts` — manager sign-off, irreversible confirmation, stored PDF
  verification, and immutable evidence after reload.
- `refund.spec.ts` — direct manager refund authority, restored inventory, and
  immutable actor-and-reason audit evidence after reload.
- `inventory-receipt.spec.ts` — completed purchase receipt details, exact
  aggregate and site stock effects, and immutable actor-attributed receipt
  evidence after re-authentication.
- `inventory-transfer.spec.ts` — exact inter-site debit, in-transit custody,
  discrepant receipt, aggregate and site stock effects, and immutable
  actor-attributed transfer evidence after re-authentication.
- `staff-switch.spec.ts` — admin enrollment of a cashier PIN, same-workstation
  authority handoff, privileged-route denial, cashier continuity after renderer
  reload, and immutable actor/target switch evidence after re-authentication.

Every spec also enforces clean renderer and Electron process diagnostics.

### Troubleshooting

If Playwright reports `Target page, context or browser has been closed`
before the login form renders, first verify the Electron runtime itself:

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --version
```

On macOS this must print the pinned Electron version, currently `v43.4.1`.
Do not pass Node-style `-e` snippets to the Electron binary; Electron
interprets the snippet as an app path and opens a misleading "Unable to
find Electron app" dialog.

If `--version` exits with `SIGABRT` from a sandboxed agent session but works in
a normal terminal, the ordinary suite can be rerun from a session that has
permission to launch GUI apps. For retained representative evidence, use the
external wrapper above; do not copy the ordinary run's result into its report.
If the runtime fails in a normal terminal too, run `pnpm --filter
@puntovivo/desktop run electron:ensure:binary` followed by `pnpm --filter
@puntovivo/desktop run rebuild`.

### Not in CI

The Playwright Electron journey suite is local-only. The manual desktop build
workflow provides the cross-OS packaged runtime smoke; it does not replace the
full local journey suite. Signed release validation remains separate because
ordinary CI runners do not have the required signing material.
