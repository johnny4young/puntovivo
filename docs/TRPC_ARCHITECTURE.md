# tRPC architecture

`/api/trpc` is Puntovivo's canonical application API. Fastify owns the runtime,
tRPC owns typed procedures, and the React client infers request and response
types from `AppRouter`.

## Layout

- Root router: `packages/server/src/trpc/router.ts`
- Context: `packages/server/src/trpc/context.ts`
- Schemas: `packages/server/src/trpc/schemas/`
- Routers: `packages/server/src/trpc/routers/`
- Middleware: `packages/server/src/trpc/middleware/`
- Web client: `apps/web/src/lib/trpc.ts`

Routers should remain thin: validate input, compose shared middleware, call an
application/service function, and project a transport response. Multi-step
business workflows belong under `packages/server/src/application/`; reusable
domain rules belong under `packages/server/src/services/`.

## Procedure boundaries

- Every tenant procedure derives `tenantId` from authenticated context.
- Use the shared role guards; do not implement router-local role middleware.
- Inputs containing `siteId` call `ensureTenantSite` before reading or writing.
- Module-gated features compose role, tenant, and module guards.
- Financial mutations preserve active cash-session and command-envelope
  invariants where applicable.
- Paginated list totals repeat every join and visibility predicate used by the
  row query.

## Transport and errors

Zod schemas are the input boundary. Procedures throw stable server error codes,
and the renderer localizes those codes instead of depending on server prose.
`/api/health` remains a compatibility health endpoint and `/api/realtime/*`
remains the SSE surface; new application features do not add parallel REST APIs.

## Transactions and side effects

Database state and its operation-journal/outbox intent are written in one local
transaction. External fiscal, payment, webhook, sync, and hardware effects run
from their durable queues. A retry must preserve idempotency and tenant/site
ownership.

## Client behavior

React Query owns server-state caching. Mutations invalidate the exact read-side
surfaces that display their result; live smoke must prove the round trip for
user-facing changes. Renderer code never calls server modules directly and the
Electron renderer remains sandboxed behind preload IPC.

## Testing

Server tests call `appRouter.createCaller(...)` against an in-memory SQLite
database; they do not allocate ports. Copy the multi-tenant and role patterns
from the existing router tests. The full commands and live-smoke contract are in
[`TESTING.md`](./TESTING.md) and focused examples are in
[`TRPC_TESTING_GUIDE.md`](./TRPC_TESTING_GUIDE.md).
