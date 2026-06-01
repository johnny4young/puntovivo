# Performance Budgets

> Status: shipped engine (bundle-size + tRPC p95 latency).
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

The remaining cells in `ENG-133` (Lighthouse-CI for top routes,
Electron main + renderer memory ceiling, Operations Center surface
of the latest baseline) ride in follow-ups so the first slice stays
shippable.

## Why budgets matter

Puntovivo ships into ICP merchants on legacy Celeron / 4 GB AIO
hardware. A 50 KB bundle bloat or a 60 ms regression on a hot read
procedure is invisible to a fast workstation but a visibly slow
checkout on the cashier's box. The budget catches the regression
when the PR lands, not when a customer complains.

## How the gates run

### Bundle size

`npm run ci:web` chains:

1. `npm audit`, typecheck, lint, unit tests with coverage, build.
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

`npm run ci:server` runs `vitest run --coverage`, which picks up
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
3. Run `npm run ci:server` to confirm the new gate passes.

## How to add a new chunk to the bundle-size budget

1. Open `perf-budget.json`, add an entry under
   `bundleSize.perChunkGzKb` with the measured gzipped size in KB
   (round up to the nearest integer).
2. The strip-hash logic in `scripts/check-bundle-size.mjs` is
   regex-based — your chunk's name (without the `-<hash>.js`
   suffix) must match the budget key verbatim.

## Capturing baselines from scratch

```
npm run build --workspace=@puntovivo/web
node scripts/check-bundle-size.mjs
```

The PASS report at the end of the script lists each tracked chunk
with budget vs actual. Copy the actual values into
`perf-budget.json`.

For latency:

```
npm run test:coverage --workspace=@puntovivo/server -- perf-trpc-latency
```

When the test fails it prints the measured p95 in the error
message. Use that number as the new baseline.

## Out-of-scope follow-ups

- **Lighthouse-CI** for top user-facing routes (LCP, TTI, CLS).
- **Electron main + renderer memory ceiling** captured in `ci:desktop`.
- **Operations Center surface** of the latest measured baseline so
  the operator can see the current state without opening the JSON
  file. Will land alongside `ENG-128` supportability so the surface
  consolidates with the attention queue instead of growing a
  parallel panel.
