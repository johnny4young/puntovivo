# Performance Budgets

> Status: shipped engine (bundle-size + tRPC p95 latency + Electron memory + Lighthouse web vitals).
> Roadmap anchor: `ENG-133`.
> Source of truth: `perf-budget.json` at the repo root.

This doc explains how Puntovivo enforces performance budgets in CI
and what to do when a build trips a regression. The principle is the
same as the coverage floor: every regression is a deliberate choice,
documented in the same PR that produces it.

## What is enforced today

| Metric | Where | Gate runner |
| --- | --- | --- |
| Per-chunk JavaScript gzipped bundle size | `ci:web` | `scripts/check-bundle-size.mjs` after `vite build` |
| tRPC procedure p95 latency for a curated set of read routes | `ci:server` | `__tests__/perf-trpc-latency.test.ts` via vitest |
| Electron main + renderer working-set memory (strict in CI; warn-first locally) | `ci:desktop` | `scripts/run-electron-memory-gate.mjs` → `scripts/check-electron-memory.mjs` |
| Lighthouse web vitals (LCP / TTI / CLS / score) for top routes (warn-first, LOCAL) | `pnpm run perf:lighthouse` (not push-CI) | `scripts/check-lighthouse.mjs` (launches Chromium, logs in, measures) |

The remaining cells in `ENG-133` (promoting the Lighthouse gate into
push-CI, and the Operations Center surface of the latest baseline —
re-routed to `ENG-128`) ride in follow-ups so each slice stays
shippable. The Lighthouse gate shipped in `ENG-133c` (local-only; see
below).

### Electron memory (strict in CI, warn-first locally)

`scripts/check-electron-memory.mjs` launches the built Electron app
with `PUNTOVIVO_MEASURE_MEMORY=1`. The main process waits for the
renderer to finish loading plus a short settle window, reads each
Electron process' working-set via `app.getAppMetrics()`, prints one
`PUNTOVIVO_MEMORY_METRICS=<json>` line, and quits. The gate maps the
`Browser` process to `main` and the `Tab` process to `renderer`
(GPU / utility processes are excluded), sums them in MB, and compares
against `perf-budget.json::electronMemoryMb.perProcessMb` with the
shared `thresholdPercent`.

`ci:desktop` now builds the web bundle plus Electron main/preload
bundle, starts a local Vite preview via
`scripts/run-electron-memory-gate.mjs`, points `WEB_DEV_SERVER_URL` at
that renderer, and runs the memory check with both `--strict` and
`--require-measurement`. On ubuntu, the GitHub Actions desktop job
installs `xvfb` and the launcher wraps Electron with `xvfb-run -a`, so
the CI path measures the real Chromium renderer instead of the error
page. Two failure classes break the build:

- **Regression.** A main or renderer process above
  `budget * (1 + thresholdPercent/100)` exits 1 under `--strict`.
- **Missing proof.** A missing `.vite/build` main bundle, unresolvable
  Electron binary, failed launch, unmounted renderer, missing metrics
  line, or absent budgeted process exits 1 under `--require-measurement`.

The local direct script remains tolerant for operator diagnostics:

- **Warn-first.** An over-ceiling process prints a `WARN` and still
  exits 0. Pass `--strict` (or `PUNTOVIVO_MEMORY_STRICT=1`) to make a
  regression exit 1.
- **Self-skip.** If the `.vite/build` main bundle is absent, the
  electron binary is unresolvable, the launch errors, or no metrics
  line comes back, the gate prints a `WARN: skipped` and exits 0 unless
  `--require-measurement` (or `PUNTOVIVO_MEMORY_REQUIRE_MEASUREMENT=1`)
  is present.

The pure comparison/parse helpers are unit-tested by
`scripts/check-electron-memory.test.mjs`, and the portable preview
runner is pinned by `scripts/run-electron-memory-gate.test.mjs`; both
run before the live memory launch in `ci:desktop`.

### Lighthouse web vitals (warn-first, LOCAL)

`scripts/check-lighthouse.mjs` (`pnpm run perf:lighthouse`) measures the
front-end load experience — LCP, TTI, CLS, and the Lighthouse performance
score — for the top user-facing routes (`/login`, `/dashboard`, `/sales`,
`/products`), compared against `perf-budget.json::lighthouse.perRoute` with the
section `thresholdPercent`. `lower-is-better` metrics (timings, layout shift)
regress past `budget * (1 + t/100)`; the `higher-is-better` score regresses
below `budget * (1 - t/100)`.

How a run works:

1. Launch a real Chromium via Playwright with a CDP port.
2. Log in ONCE (the demo-seed admin from `docs/DEV-SEED.md`). The refresh token
   lands in an httpOnly cookie; the in-memory access token is re-minted via
   `auth.refresh` on each navigation, so authenticated routes measure correctly
   with `disableStorageReset:true`.
3. Warm up each route (the Vite dev server compiles route modules on first hit —
   a cold visit is 10s+, a warm one ~3s; measuring cold would be meaningless).
4. Run Lighthouse per route and compare.

Two deliberate tolerant paths, same as the memory gate:

- **Warn-first.** An over-budget metric prints a `WARN` and still exits 0. Pass
  `--strict` (or `PUNTOVIVO_LIGHTHOUSE_STRICT=1`) to make a regression exit 1.
- **Self-skip.** If Playwright/Lighthouse is unavailable, the dev:web/dev:server
  stack is not up, or the browser fails to launch, the gate prints a
  `WARN: skipped` and exits 0.

This gate is **LOCAL-only — it is NOT wired into push-CI**. A real Chromium
launch plus a running `dev:server` + `dev:web` is too heavy for the Actions
budget (the repo took the same stance on the Playwright e2e suite). Only the
pure helpers ride `ci:web` via `scripts/check-lighthouse.test.mjs`. The measured
numbers are DEV-build figures under Lighthouse's simulated throttle, not
production values — the gate detects regressions from the local baseline.

## Why budgets matter

Puntovivo ships into ICP merchants on legacy Celeron / 4 GB AIO
hardware. A 50 KB bundle bloat or a 60 ms regression on a hot read
procedure is invisible to a fast workstation but a visibly slow
checkout on the cashier's box. The budget catches the regression
when the PR lands, not when a customer complains.

## How the gates run

### Bundle size

`pnpm run ci:web` chains:

1. `pnpm audit --prod`, typecheck, lint, unit tests with coverage, build.
2. `node --test scripts/check-bundle-size.test.mjs` — pins the
   strip-hash regex + compare logic.
3. `node scripts/check-bundle-size.mjs` — reads
   `apps/web/dist/assets/*.js`, computes the gzipped size of each
   chunk, strips the Rolldown content hash (e.g.
   `SalesPage-Br3xY9Q_.js` → `SalesPage`), compares against
   `perf-budget.json::bundleSize.perChunkGzKb`. A chunk that exceeds
   `budget * (1 + thresholdPercent/100)` fails the build with a
   markdown table pointing at the offending chunk and the delta.

Tolerant paths:
- A chunk in the build that is not in the budget produces a warning
  but does not fail only when it is at least `5 kB` gzipped (so introducing
  a new route does not block the PR; the operator adds the baseline in the
  same commit). Smaller route splits and micro-icon chunks are intentionally
  silent until they grow large enough to deserve an explicit baseline.
- A chunk in the budget that is not in the build produces a warning
  but does not fail (so removing a route does not block the PR; the
  operator drops the dead key in the same commit).

### tRPC p95 latency

`pnpm run ci:server` runs `vitest run --coverage`, which picks up
`__tests__/perf-trpc-latency.test.ts`. The test:

1. Boots `createServer({ dbPath: ':memory:' })`.
2. Seeds 30 products + 20 customers so the curated procedures
   exercise non-empty result paths.
3. For every key in `perf-budget.json::trpcLatencyMs.p95`:
   - Runs `warmupIterations` invocations (discarded — JIT settling).
   - Runs `samplesPerProcedure` measured invocations with
     `performance.now()` deltas.
   - Computes p95 with `computePercentile` (linear interpolation).
   - Asserts the p95 fits inside
     `budget * (1 + thresholdPercent/100)`.

Mitigations against runner jitter:
- Default `warmupIterations` is 10.
- Default `samplesPerProcedure` is 50.
- p95 (not p99) — less tail noise.
- 20% threshold on top of the budget.

## Web Vitals real-user monitoring (RUM)

> Status: ingest path shipped (`ENG-173`). Aggregation dashboard is a follow-up.

The bundle-size and tRPC-latency gates above are synthetic — they measure the
build and the server in isolation. They cannot see what the cashier's actual
browser experiences on the actual hardware. `ENG-173` closes that gap with
field measurement.

`apps/web/src/lib/observability.ts::installWebVitalsReporter()` hooks the
`web-vitals` library (LCP, CLS, INP, TTFB, FCP) at bootstrap and forwards each
finalised metric to the public `observability.reportWebVital` tRPC mutation,
which stores one row per metric in `web_vital_samples`
(`tenant_id`, `tenant_plan`, `route`, `metric`, `value`, `rating`,
`device_class`, `created_at`). Properties of the pipe:

- **Sampling** — decided once per page load (all five metrics report, or none),
  default 10% in production and 100% in dev, overridable via
  `VITE_WEB_VITALS_SAMPLE_RATE`.
- **Privacy** — the mutation derives `tenant_id` server-side from the session
  (anonymous login-page loads store `NULL`) and drops the sample when the
  tenant has not opted into telemetry (`tenants.settings.telemetryOptIn`).
- **Logging** — every accepted sample emits a structured pino line under
  `module: web-vitals`.

### Per-route targets

These are the yardsticks the future aggregation dashboard measures the RUM data
against — advisory today (no CI gate; the data has to accumulate first). Values
follow the Google Web Vitals "good" thresholds, tightened for the routes a
cashier hits hundreds of times a day.

| Route | LCP (good) | INP (good) | Notes |
| --- | ---: | ---: | --- |
| `/login` | <= 2.0 s | <= 200 ms | First impression; no auth round-trip yet. |
| `/sales` | <= 2.5 s | <= 200 ms | The hot path — checkout responsiveness matters most. |
| `/dashboard` | <= 2.5 s | <= 200 ms | First screen after sign-in. |
| `/products`, `/inventory`, list routes | <= 2.5 s | <= 200 ms | Large DataTables; virtualised since `ENG-172`. |
| CLS (all routes) | <= 0.1 | — | Image dimensions hardened in `ENG-172`. |

When the dashboard ticket lands it will compute per-tenant medians + p95 per
`(route, metric)` and flag routes whose p95 breaches the target above.

## How to update a baseline

Two flavors:

### 1. The regression is intentional (new feature legitimately costs the bytes / ms)

In the same PR that introduces the regression:

1. Edit `perf-budget.json` and bump the offending entry to the new
   measured value (round up to the nearest integer for bundle sizes,
   round up to the nearest 5 ms for latency).
2. Mention the metric + the delta in the commit body, e.g.
   `colateral: bump SalesPage bundle budget from 33 to 38 kB gz to
   absorb the new keyboard-shortcuts hook`.
3. The reviewer signs off — the budget bump is part of the diff
   under review, not a sneaky escape valve.

### 2. The regression is accidental (no scope change should have moved the metric)

Stop the PR and find the actual cause. The threshold absorbed the
noise; if the gate is firing despite the threshold, something real
changed.

## How to add a new procedure to the latency gate

1. Open `perf-budget.json`, add an entry under `trpcLatencyMs.p95`
   with the desired p95 ceiling (start from a measured run, round
   to the nearest 5 ms).
2. Open `packages/server/src/__tests__/perf-trpc-latency.test.ts`,
   add a branch in `invokeProcedureForLatency()` that calls the
   procedure with minimal inputs (default pagination, identity
   defaults).
3. Run `pnpm run ci:server` to confirm the new gate passes.

## How to add a new chunk to the bundle-size budget

1. Open `perf-budget.json`, add an entry under
   `bundleSize.perChunkGzKb` with the measured gzipped size in KB
   (round up to the nearest integer).
2. The strip-hash logic in `scripts/check-bundle-size.mjs` is
   regex-based — your chunk's name (without the `-<hash>.js`
   suffix) must match the budget key verbatim.

Exception — conditional chunks: a chunk that only exists in some
builds gets NO budget entry, because the entry would emit a
"chunk in budget but absent" warning on every build that lacks it.
The one case today is `sentry` (ENG-135b): the lazy adapter chunk
(~28 kB gz) only exists when the build ran with
`VITE_PUNTOVIVO_SENTRY_DSN` set; a DSN-less build (the CI default)
dead-code-eliminates it entirely. A DSN build surfaces it under
the gate's "new chunks" warning, which does not fail.

## Capturing baselines from scratch

```
pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
```

The PASS report at the end of the script lists each tracked chunk
with budget vs actual. Copy the actual values into
`perf-budget.json`.

For latency:

```
pnpm --filter @puntovivo/server run test:coverage -- perf-trpc-latency
```

When the test fails it prints the measured p95 in the error
message. Use that number as the new baseline.

For Electron memory:

```
pnpm --filter @puntovivo/server run build
pnpm --filter @puntovivo/web run build
pnpm --filter @puntovivo/desktop run build:main
node scripts/run-electron-memory-gate.mjs --strict --require-measurement
```

The PASS table prints the measured main / renderer working-set MB.
Use those values only after a stable run on the same target class.

For Lighthouse web vitals:

```
pnpm run seed:dev                      # demo-co tenant in local.db
pnpm run dev:server                    # 8090 (background)
pnpm run dev:web                       # 3000 (background)
pnpm run perf:lighthouse
```

The script prints a `check-lighthouse: measured = {...}` line with the raw
LCP / TTI / CLS / score per route; copy those into
`perf-budget.json::lighthouse.perRoute` (round timings up a little to absorb
run-to-run variance). Re-run a couple of times — the warm numbers stabilise
once Vite has compiled each route. Note these are DEV-build figures, not
production.

## Out-of-scope follow-ups

- **Lighthouse in push-CI** — today the gate is local-only; promoting it to CI
  needs a browser + the served stack in the runner (and the Actions-minute
  trade-off the repo deliberately avoids).
- **Operations Center surface** of the latest measured baseline so
  the operator can see the current state without opening the JSON
  file. Will land alongside `ENG-128` supportability so the surface
  consolidates with the attention queue instead of growing a
  parallel panel.
