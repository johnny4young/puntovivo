# tRPC Architecture

> Updated: April 10, 2026

## Summary

Open Yojob is a tRPC-first application.
The canonical application API is:

- `/api/trpc`

Two non-tRPC endpoints still exist intentionally:

- `/api/health` for compatibility checks
- `/api/realtime/*` for SSE

## Backend Request Flow

1. The client calls a query or mutation through the tRPC React client or the shared vanilla client.
2. Requests are batched over HTTP to `/api/trpc`.
3. Fastify builds a tRPC context with:
   - DB handle
   - authenticated user, if present
   - tenant ID
   - current site ID from `x-site-id`
4. Middleware applies:
   - auth requirements
   - tenant isolation
   - role guards
5. Routers validate inputs with Zod and run Drizzle queries or transactions.
6. TanStack Query handles caching and invalidation in the renderer.

## Client Configuration

The web client is configured in:
[trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)

Current request headers:

- `Authorization: Bearer <accessToken>` when logged in
- `x-site-id: <siteId>` when a site is selected
- `x-csrf-token: <csrfToken>` on cookie-backed unsafe auth flows such as refresh/logout

Session model:

- the web client keeps the short-lived access token in memory only
- session continuity comes from a rotated `httpOnly` refresh cookie
- `health.check` can mint the readable CSRF cookie needed before calling cookie-backed unsafe auth procedures
- password changes and admin password resets revoke older tokens through a per-user session version check
- token validation also rejects stale `role`/`email` claims and tenants that are no longer active

## Current Router Surface

Current root router modules:

- `health`
- `auth`
- `companies`
- `countries`
- `identificationTypes`
- `personTypes`
- `regimeTypes`
- `clientTypes`
- `commercialActivities`
- `dashboard`
- `departments`
- `cities`
- `logos`
- `providers`
- `sequentials`
- `units`
- `vatRates`
- `categories`
- `products`
- `orders`
- `customers`
- `purchases`
- `sales`
- `inventory`
- `locations`
- `sites`
- `sync`
- `users`

Source:
[router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)

## Why tRPC Matters in This Repo

- frontend and backend share end-to-end types through `AppRouter`
- business logic for sales, purchases, inventory, orders, and sync lives server-side
- the old app-style REST client layers are no longer the primary application path
- role enforcement is centralized in middleware instead of spread across screens

## Current Exceptions and Boundaries

- `/api/health` remains for compatibility and smoke checks
- SSE remains a Fastify plugin, not a tRPC concern
- desktop offline support also uses a preload bridge for allowlisted local DB and sync actions
- some browser-only utilities still use the `vanillaClient` outside React components

## Reference Files

- Server entry:
  [index.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/index.ts)
- Root router:
  [router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)
- Context:
  [context.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/context.ts)
- Middleware:
  [middleware](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/middleware)
- Client:
  [trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)
