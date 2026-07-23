# Production observability

Puntovivo keeps structured device-local logs and can forward redacted errors and
spans to a Sentry-compatible sink when the deployment and tenant consent gates
allow it.

## Current contract

| Surface                | Implementation                                                    | Behavior                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Server structured logs | `packages/server/src/index.ts`, `trpc/middleware/tracing.ts`      | Records procedure, duration, outcome, correlation, tenant, and user context.                                                   |
| Error and span helpers | `packages/server/src/observability/capture.ts`                    | Always logs locally; forwards tenant-attributed events only after opt-in.                                                      |
| Redaction              | `packages/server/src/observability/redact.ts`                     | Masks credentials and personal identifiers before forwarding.                                                                  |
| Server sink            | `packages/server/src/observability/sentry.ts`                     | Lazy, DSN-gated Sentry/GlitchTip adapter; malformed configuration cannot block boot.                                           |
| Renderer errors        | `apps/web/src/lib/observability.ts`, `apps/web/src/lib/sentry.ts` | Captures React, `window.error`, and unhandled rejection paths; remote events remain tenant-less.                               |
| Electron crashes       | `apps/desktop/src/main/crash-telemetry.ts`                        | Logs, captures, performs bounded flush, and exits on uncaught exceptions.                                                      |
| Tenant consent         | `companies.updateTelemetryOptIn`                                  | Admin-only transactional setting and audit event with immediate cache invalidation.                                            |
| Recovery ownership     | `@puntovivo/shared/operational-readiness` and Operations Center   | Names the first owner, response target, action threshold, recovery surface, and executable drill for six operational services. |

## Operator ownership

The default Operations surface combines tenant-scoped sync, fiscal, hardware,
and payment signals with administrator-owned desktop backup and update state.
Every card carries a text status, first owner, response target, explicit
threshold, recovery route, and pinned drill count. Color accelerates scanning
but never carries status alone.

The four server-backed signals refresh every 15 seconds and successful
recovery mutations invalidate the aggregate immediately. Synchronization opens
**Company → Data**, where queue processing and conflict resolution are real;
fiscal, device, and payment actions open their audited retry panels in
Operations. Browser sessions never expose backup or updater links as if they
could execute device-local work: those controls require the Electron desktop
bridge.

The shared contract is provider-neutral and enforced by
`scripts/check-operational-readiness.mjs`. Stable first-response procedures
live in [`OPERATIONS-RUNBOOKS.md`](./OPERATIONS-RUNBOOKS.md). The local board
does not claim to replace a production telemetry destination or an on-call
system; it makes recovery ownership usable even when remote telemetry is off.

## Consent and privacy

Two independent gates apply:

1. Tenant-attributed server events require both a configured DSN and the
   tenant's `telemetryOptIn` setting.
2. Tenant-less renderer and process diagnostics require a configured DSN; the
   operator setting the DSN is the deployment-level consent.

Local structured logging remains enabled in both cases. Remote attributes pass
through `redactErrorAttrs`, which masks password, token, authorization, cookie,
email, and related credential keys without mutating the input.

## Correlation

The renderer creates a fresh `x-correlation-id` for every tRPC request. The
server accepts only `[A-Za-z0-9_-]{8,64}` and otherwise falls back to Fastify's
request id. Correlation identifiers are diagnostic metadata only and are never
used for authorization or business logic.

## Configuration

- Server and Electron: `PUNTOVIVO_SENTRY_DSN`
- Optional server span sampling: `PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE` in `0..1`
- Web build: `VITE_PUNTOVIVO_SENTRY_DSN`

The web SDK is lazy and omitted from DSN-less builds. CSP configuration adds
only the configured DSN origin. Default SDK integrations are disabled to avoid
network monkey-patching and duplicate browser error capture.

## Operational gaps

Production certification still requires validation against the provisioned
Sentry/GlitchTip instance, external alert delivery and acknowledgement,
retention policy, a per-tenant error-rate view, and a crash-free-session
metric. The in-product ownership board and recovery runbooks are shipped; the
external on-call connection remains a release-readiness gap in
[`PROJECT-STATUS.md`](./PROJECT-STATUS.md).

## Focused verification

```sh
pnpm --filter @puntovivo/server run test -- \
  src/__tests__/observability-capture.test.ts \
  src/__tests__/trpc-tracing.test.ts \
  src/__tests__/companies-telemetry.test.ts

pnpm --filter @puntovivo/web run test -- --run \
  src/components/feedback/__tests__/AppErrorBoundary.test.tsx \
  src/features/company/__tests__/CompanyTelemetryCard.test.tsx
```

The full server, web, and desktop CI gates remain authoritative.

The shared ownership and evidence contract is verified by:

```sh
node --experimental-strip-types scripts/check-operational-readiness.mjs
```
