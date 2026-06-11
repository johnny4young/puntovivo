# Production observability

> Status: shipped engine (sink interface + capture helpers + tracing
> middleware + tenant opt-in + audit row/cache invalidation +
> render-error wiring) + shipped adapter (ENG-135b: Sentry/GlitchTip
> DSN-gated adapter on server and web + Electron main crash path).
> Roadmap anchor: `ENG-135`.

This doc explains how Puntovivo records errors, measures spans, and
forwards both to a centralized pipe when an operator turns
telemetry on. It pairs with ENG-128 (local diagnostic bundles).
The local NDJSON pino log is the source of truth on the device;
the centralized pipe is the fan-out that lets support see fleet
health without a tenant-by-tenant phone call.

## What is enforced today

| Surface | Where | Notes |
| --- | --- | --- |
| Local NDJSON pino logs for every tRPC procedure | Server `index.ts` + `trpc/middleware/tracing.ts` | Stamps `procedure / durationMs / outcome / correlationId / tenantId / userId`. |
| `captureException(err, attrs, db)` helper | `packages/server/src/observability/capture.ts` | Always emits to pino; forwards to the registered sink when the tenant has opted in. |
| `withSpan(name, attrs, fn, db)` helper | Same module | Same opt-in gate; emits info on ok, error on throw, captures the exception in either case. |
| Render-tree error boundary funnels into `captureRenderError` | `apps/web/src/lib/observability.ts` + `AppErrorBoundary.tsx` | Console-error fallback plus a pluggable sink for the future Sentry / GlitchTip browser adapter. |
| `window.error` + `window.unhandledrejection` listeners | Mounted in `apps/web/src/main.tsx` via `installGlobalErrorListeners()` | Catches escapes from the React tree (uncaught promise rejections, async errors). |
| Per-tenant opt-in toggle + audit | `companies.updateTelemetryOptIn` + `telemetry.opt_in.updated` audit | Admin-only, scoped by `ctx.tenantId`; setting update + audit row are transactional, and the opt-in cache is invalidated immediately. |
| Redaction policy on attrs sent to the sink | `packages/server/src/observability/redact.ts` | Walks the attrs bag and masks `password / token / authorization / refreshToken / email`. Mirrors the spirit of pino `REDACT_PATHS` (ENG-006). |
| Sentry / GlitchTip adapter (server) | `packages/server/src/observability/sentry.ts`, wired in `createServer` | ENG-135b. Activates only when `PUNTOVIVO_SENTRY_DSN` is set; otherwise the SDK is never imported. Never throws — a malformed DSN can never block a boot. |
| Sentry / GlitchTip adapter (web) | `apps/web/src/lib/sentry.ts` via `installRenderTelemetryAdapter()` | ENG-135b. Lazy chunk gated on `VITE_PUNTOVIVO_SENTRY_DSN` at BUILD time; a DSN-less build ships zero SDK bytes (the dynamic import is dead-code-eliminated). |
| Electron main crash path | `apps/desktop/src/main/crash-telemetry.ts` | ENG-135b. `uncaughtException` → structured log + `captureProcessCrash` + bounded flush + exit 1; `unhandledRejection` → log + capture without exit. |

## Why opt-in matters

LATAM privacy expectations (Habeas Data in Colombia, LFPDPPP in
Mexico) treat operational telemetry as third-party data sharing.
Default-off ensures Puntovivo never silently forwards events; the
admin must flip the toggle, the flip writes an audit row
(`telemetry.opt_in.updated`) with `before` / `after`, and the
operator can revoke at any time. The local pino log keeps running
regardless — the toggle controls the centralized pipe only.

## V1 scope vs. follow-up

The cell of ENG-135 lists four deliverables, three of which need
external infrastructure (Sentry account, per-tenant dashboard,
trace propagation end-to-end across renderer → main → server →
DB). V1 ships the parts that can land without a DSN:

Shipped now:
- Server `TelemetrySink` interface + `noopSink` + `registerTelemetrySink`.
- Server `captureException` + `withSpan` helpers with the opt-in
  cache (60 s TTL so error storms do not hammer the DB).
- tRPC tracing middleware applied to every procedure, with local
  logs and centralized `recordSpan` calls on ok/error outcomes.
- `companies.updateTelemetryOptIn` admin-only mutation +
  `telemetry.opt_in.updated` audit row + `tenant` resource type +
  immediate opt-in cache invalidation.
- `companies.getCurrent` surfaces `telemetryOptIn` on its response.
- Renderer-side `captureRenderError` + `installGlobalErrorListeners`
  + `RenderTelemetrySink` interface (also noop by default).
- `CompanyTelemetryCard` admin control in the `/company` data tab.

Shipped by ENG-135b (2026-06-10):
- `@sentry/node` (server) + `@sentry/browser` (web) installed and
  registered through the existing sink interfaces, DSN-gated on
  both sides. GlitchTip speaks the Sentry protocol, so the same
  adapter covers both backends — only the DSN changes.
- Electron main process crash path: `uncaughtException` /
  `unhandledRejection` handlers with structured logging, telemetry
  capture, and bounded-flush fail-fast exit.

Remaining (re-routed to follow-up tickets):
- Per-tenant error rate dashboard + crash-free sessions metric
  (needs a real centralized instance to aggregate against).
- Trace propagation end-to-end (renderer → main → server → DB).
  V1 stops at the server boundary: the correlationId is server
  reqId; the renderer does not yet echo it on its next call.
- Validation against a real provisioned Sentry / GlitchTip
  instance (the ENG-135b smoke verified envelopes against a local
  HTTP catcher only).

## Consent layers (ENG-135b)

Two consent layers, deliberately different:

1. **Tenant-attributed events** (everything flowing through
   `captureException` / `withSpan` / the tRPC tracing middleware)
   keep the per-tenant opt-in gate: the sink only sees them when
   the tenant flipped `telemetryOptIn` AND the operator provisioned
   a DSN. Both switches are required.
2. **Tenant-less app diagnostics** (process crashes via
   `captureProcessCrash`, render errors from the web adapter) are
   gated on the DSN alone: configuring `PUNTOVIVO_SENTRY_DSN` /
   `VITE_PUNTOVIVO_SENTRY_DSN` IS the operator-level consent. A
   process crash carries no tenant context, so the per-tenant gate
   cannot apply — gating on it would make the crash path vacuous.
   Render errors are forwarded TENANT-LESS by construction: the
   web adapter strips `tenantId` from the context before the SDK
   sees it, because the renderer cannot verify the tenant's opt-in
   reliably. Per-tenant attribution of render errors arrives with
   the opt-in-aware follow-up.

Attrs are redacted (`redactErrorAttrs`) before the sink sees them
on every path, including crashes.

## How to enable the centralized pipe

The adapter is shipped; enabling it is configuration only:

1. Provision a DSN — a Sentry project or a self-hosted GlitchTip
   instance (same protocol, same SDK).
2. Server / desktop: set `PUNTOVIVO_SENTRY_DSN` in the process
   environment. Both the standalone server and the embedded
   desktop server pick it up inside `createServer`. Optionally set
   `PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE` (0..1, default 0) to also
   fan out spans — errors flow regardless.
3. Web: build with `VITE_PUNTOVIVO_SENTRY_DSN` set. This is a
   BUILD-time decision (Vite inlines `import.meta.env`): a build
   without the var ships zero SDK bytes (the lazy chunk is
   dead-code-eliminated); a build with it emits a `sentry-*.js`
   lazy chunk (~28 kB gz) that loads after mount. In dev,
   `.env.local` works because the dev server reads env at boot.
4. The SDK initialises with `defaultIntegrations: false` on both
   sides: no http/undici monkey-patching (which would distort the
   ENG-133 p95 latency budgets) and no double-capture of window
   errors (our `installGlobalErrorListeners` is the single source;
   `dedupeIntegration` rides along as insurance on the web).
5. CSP is widened automatically — no manual step. The browser can
   only POST envelopes to origins in `connect-src`, so a
   `sentryConnectSrcPlugin` in `apps/web/vite.config.ts` injects the
   DSN origin into the index.html meta CSP at build time, and
   `buildRendererContentSecurityPolicy` (Electron) appends it from
   `PUNTOVIVO_SENTRY_DSN` at runtime. DSN-less builds keep the
   strict baseline. (Found live during the ENG-135b smoke: without
   this, the browser silently blocks every envelope.)

Bundle-size note: the `sentry-*.js` chunk has NO `perf-budget.json`
entry on purpose — the chunk only exists in DSN-set builds, so a
budget entry would emit a "chunk in budget but absent" warning on
every standard CI build. A DSN-set build instead surfaces it under
the gate's "new chunks" warning (which does not fail), measured at
~28 kB gz when ENG-135b landed.

## Redaction contract

The helper `redactErrorAttrs` walks the attrs bag and masks any
key whose lowercase name matches one of:

- `password`, `passwordhash`
- `token`, `refreshtoken`, `jwtsecret`
- `authorization`, `cookie`
- `email`

It tolerates cycles via a `WeakSet`, leaves non-plain objects
(`Map`, `Set`, `Error`) untouched, and never mutates the input —
the local pino log still sees the original payload (with its own
redact policy).

When ENG-128 formalises the diagnostic-bundle redaction surface,
the two lists merge — `__REDACT_FIELD_NAMES_FOR_TESTS` plus the
pino-side `REDACT_PATHS` should stay aligned so an operator who
inspects a local log and a centralized event sees the same
masking.

## How to silence a noisy sink event

If a particular procedure or surface emits too many events, two
escape hatches:

1. **Per-call**: pass `tenantId: null` to `captureException` to
   short-circuit the opt-in lookup. Useful for procedures we
   intentionally exclude from the centralized pipe (e.g. an SSE
   keepalive that fails on a flaky LAN).

2. **Per-tenant**: an admin disables the toggle via the
   `CompanyTelemetryCard` in `/company` → tab data. The toggle
   mutation clears that tenant's opt-in cache, so the next captured
   event goes local-only.

Both leave the local pino log intact — the device-side trail is
always complete.

## Running the contract locally

```
# Server tests (capture helpers + tracing middleware + companies toggle)
pnpm --filter @puntovivo/server run test -- \
  src/__tests__/observability-capture.test.ts \
  src/__tests__/trpc-tracing.test.ts \
  src/__tests__/companies-telemetry.test.ts

# Web tests (error boundary + telemetry card)
pnpm --filter @puntovivo/web run test -- --run \
  src/components/feedback/__tests__/AppErrorBoundary.test.tsx \
  src/features/company/__tests__/CompanyTelemetryCard.test.tsx
```

The full server + web CI gates also cover the contract; this
direct invocation is for fast local iteration.
