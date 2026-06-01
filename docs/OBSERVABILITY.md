# Production observability

> Status: shipped engine (sink interface + capture helpers + tracing
> middleware + tenant opt-in + audit row/cache invalidation +
> render-error wiring).
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

Remaining (re-routed to follow-up tickets):
- Install `@sentry/node` + `@sentry/browser` (or self-hosted
  GlitchTip equivalents) and register the adapter via the
  existing sink interfaces. The bundle-size gate (ENG-133) will
  flag the new browser chunk so the budget bump and the install
  ride the same PR.
- Per-tenant error rate dashboard + crash-free sessions metric.
- Trace propagation end-to-end (renderer → main → server → DB).
  V1 stops at the server boundary: the correlationId is server
  reqId; the renderer does not yet echo it on its next call.
- Electron main process telemetry init (the embedded Fastify is
  in-process so the server-side wiring already covers tenant calls;
  what is missing is the main-process crash path).

## How to wire an adapter

When the operator has provisioned a DSN (Sentry, GlitchTip, OTLP
collector), the adapter PR follows this shape:

1. Install the SDK as a workspace devDep — `@sentry/node` for the
   server, `@sentry/browser` for the web bundle.
2. At server boot (`packages/server/src/index.ts`), after the
   Fastify instance is created, instantiate the SDK and call
   `registerTelemetrySink({ captureException, recordSpan })` with
   thin wrappers around the SDK's `captureException` /
   `startSpan` methods.
3. In the web bundle (`apps/web/src/main.tsx`), do the same with
   `registerRenderTelemetrySink({ captureRenderError })`.
4. Read the DSN from env vars (`PUNTOVIVO_SENTRY_DSN` server-side,
   `VITE_PUNTOVIVO_SENTRY_DSN` browser-side). When unset, register
   the noop sink and skip the SDK init entirely so dev / test
   sessions emit zero network traffic.
5. Bump the bundle-size baseline (`perf-budget.json`) in the same
   PR — the new chunk is expected, the gate just needs to know.

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
