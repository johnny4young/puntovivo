# tRPC Architecture

> Updated: April 15, 2026

## Summary

Puntovivo is a tRPC-first application.
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
[trpc.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/trpc.ts)

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
- `cashSessions`
- `inventory`
- `locations`
- `sites`
- `sync`
- `users`

Source:
[router.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/router.ts)

## Why tRPC Matters in This Repo

- frontend and backend share end-to-end types through `AppRouter`
- business logic for sales, purchases, inventory, orders, and sync lives server-side
- the old app-style REST client layers are no longer the primary application path
- role enforcement is centralized in middleware instead of spread across screens

## Cash Sessions Router

`cashSessions` is the Phase 1 cash-management surface. It exposes:

- `registerAssignments` — active-site register templates for POS assignment, including occupancy metadata for registers already opened by another cashier
- `getActive` — returns the current cashier's open session for the active site, or `null`
- `listRecent` — last 20 sessions for the tenant (any site)
- `open` — opens a session after validating the opening float matches the denomination count
- `close` — closes the session in blind mode (expected balance stays hidden until count submission) and writes `actualCount`, `overShort`, and `closedAt`
- `movements` — paginated timeline of cash movements for a session (cashier sees own; admin/manager sees any session in the active site)
- `report` — active-site cash management report with active sessions, recent closures, and over/short summary (cashier sees own sessions only; admin/manager see site-wide data)
- `recordMovement` — manual paid-in / paid-out / skim / replenishment entries with an audit note

Automatic movements:

- `sales.create` writes a `sale` cash movement against the cashier's active session when the sale is paid in cash
- `sales.returnSale` writes a `refund` cash movement against the refunding cashier's active session
- `sales.void` writes a `refund` cash movement against the ORIGINAL sale's session ONLY if that session is still open; voids that target a closed session leave the finalized over/short untouched

Every movement updates `cash_sessions.expected_balance` inside the same transaction via a signed delta derived from `CASH_MOVEMENT_POSITIVE_TYPES` / `CASH_MOVEMENT_NEGATIVE_TYPES` in `services/cash-session.ts`.

`registerAssignments` bootstraps standardized denomination templates from `denomination_templates` for the active site, backfills missing register templates from historical sessions, and lets the POS preload the opening dialog with the register's standard float breakdown.

## Inventory Router — Per-Site Balances

`inventory.listBalancesBySite` is the Phase 2 step 0 slice of site-owned
inventory (DB-101 / API-101). It returns on-hand / reserved / available per
product for a specific site plus a summary (totals + low-stock count).

Until transfer writes land, the `inventory_balances` table is a projection of
tenant-wide `products.stock`:

- The earliest-created active site per tenant is the **primary site** and
  receives current `products.stock` on first read.
- Every other active site seeds at `on_hand = 0`.
- New products added after the initial seed create zero-rows on the next read.

Seeding reads and inserts run inside a single better-sqlite3 transaction so the
"which site is primary" check is consistent with the inserts. The unique index
`(tenant_id, site_id, product_id)` combined with `ON CONFLICT DO NOTHING`
makes repeated reads idempotent.

## Current Exceptions and Boundaries

- `/api/health` remains for compatibility and smoke checks
- SSE remains a Fastify plugin, not a tRPC concern
- desktop offline support also uses a preload bridge for allowlisted local DB and sync actions
- some browser-only utilities still use the `vanillaClient` outside React components

## Reference Files

- Server entry:
  [index.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/index.ts)
- Root router:
  [router.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/router.ts)
- Context:
  [context.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/context.ts)
- Middleware:
  [middleware](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/middleware)
- Client:
  [trpc.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/trpc.ts)
