# tRPC Architecture for Open Yojob

## Executive Summary

Open Yojob now uses a tRPC-first application API. The canonical transport is `/api/trpc`, backed
by Fastify, Drizzle ORM, and SQLite. `/api/health` is retained only as a compatibility endpoint,
and `/api/realtime/*` remains in Fastify for SSE.

**Status:** The migration is operationally complete for the shipped app surface. See
`docs/IMPLEMENTATION_STATUS.md` for roadmap status.

---

## Current Architecture

### Backend

- **Framework**: Fastify 5.x
- **Database**: SQLite with Drizzle ORM
- **API Style**: tRPC-first on `/api/trpc`
- **Compatibility Surface**: `/api/health`
- **Authentication**: JWT with `@fastify/jwt`
- **Authorization**: tRPC middleware for auth, tenant isolation, and role enforcement
- **Real-time**: Server-Sent Events (SSE) under `/api/realtime/*`

### Frontend

- **Framework**: React 19 with TypeScript
- **State Management**: TanStack Query + Zustand
- **API Client**: tRPC React client plus a shared vanilla client
- **Site Context**: `x-site-id` header is attached from the stored site selector

### Desktop

- **Shell**: Electron 41
- **Backend topology**: Fastify runs in-process inside the Electron main process
- **IPC additions**: Receipt printing bridge from renderer to main process

---

## Current Router Surface

The root router currently assembles:

- `health`
- `auth`
- `companies`
- `dashboard`
- `providers`
- `sequentials`
- `units`
- `vatRates`
- `categories`
- `products`
- `customers`
- `purchases`
- `sales`
- `inventory`
- `sites`
- `sync`
- `users`

Source:
[packages/server/src/trpc/router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)

---

## Request Flow

### Query or Mutation Flow

1. React code calls `trpc.<router>.<procedure>.useQuery()` or `.useMutation()`.
2. The client batches over HTTP to `/api/trpc` using `httpBatchLink`.
3. Fastify creates a tRPC context with DB access, authenticated user, tenant, and current site.
4. Middleware enforces authentication, tenant isolation, and role-based access where required.
5. Router procedures validate input with Zod and execute Drizzle queries or transactions.
6. TanStack Query handles caching and invalidation on the client.

### Headers

The frontend currently attaches:

- `Authorization: Bearer <token>` when logged in
- `x-site-id: <siteId>` when a site is selected

Source:
[apps/web/src/lib/trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)

---

## Why This Matters in the Current Repo

- Backend and frontend share end-to-end types through `AppRouter`.
- The old REST service layer is no longer the application’s primary integration path.
- Domain logic that used to live in client-side helpers is now server-side in transactional tRPC
  routers for sales, purchases, inventory, and dashboard reporting.
- Role enforcement is centralized in middleware instead of being scattered through routes.

---

## Remaining Caveats

- `/api/health` is still intentionally exposed as a compatibility endpoint.
- SSE is still a separate Fastify plugin rather than a tRPC transport concern.
- A few historical docs still mention the older REST migration path; those should be treated as
  archival context, not as the live architecture.
