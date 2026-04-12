# Open Yojob Architecture

> Updated: April 10, 2026
> Audience: developers and technical operators

## Overview

Open Yojob is a multi-tenant POS application delivered primarily as an Electron desktop app.
The system has three runtime shapes:

- Desktop: Electron main process embeds the Fastify server in-process and loads the React app.
- Web development: Vite serves the React app, and Fastify runs separately from `packages/server`.
- Standalone server: the server package can run without Electron for tests or local development.

The canonical application API is tRPC on `/api/trpc`.
Two compatibility surfaces remain intentionally outside that transport:

- `/api/health`
- `/api/realtime/*` for SSE

## Current System Shape

```text
Electron Desktop
  ├─ Main process
  │  ├─ Window lifecycle
  │  ├─ Embedded Fastify server
  │  ├─ Auto-update integration
  │  ├─ Receipt printing
  │  ├─ Backup / restore
  │  ├─ Theme / tray / print settings
  │  └─ Desktop sync + allowlisted local DB bridge
  ├─ Preload
  │  └─ Safe IPC bridge exposed as window.electron / window.api / window.db / window.sync
  └─ Renderer
     ├─ React 19
     ├─ TanStack Query + tRPC React client
     ├─ Role-protected routes
     ├─ Offline banner + sync UI
     └─ Business modules
```

## Repository Map

```text
apps/
  desktop/
    src/main/       Electron main process + embedded server host
    src/preload/    Safe IPC bridge
  web/
    src/components/ Shared UI, layout, table, feedback, and resource components
    src/features/   Business modules
    src/lib/        tRPC client and app helpers
    src/services/   Export and offline storage helpers
packages/
  server/
    src/db/         Drizzle schema + raw DDL bootstrap + seed
    src/trpc/       Context, middleware, routers, schemas
    src/realtime/   SSE support
docs/               Project documentation
```

## Backend Architecture

### Runtime

- Fastify 5
- SQLite via `better-sqlite3`
- Drizzle ORM for schema and query typing
- tRPC 11 for the application API
- hybrid auth with in-memory bearer access tokens, rotated refresh cookies, and session-version invalidation on password changes
- SSE for realtime notifications

### Context and guards

Each tRPC request builds a context with:

- authenticated user from the bearer access token, when present
- tenant ID
- current site ID from `x-site-id`
- DB handle

Access control is layered:

- authentication middleware
- tenant middleware
- role middleware

Current role model:

- `admin`
- `manager`
- `cashier`
- `viewer`

### Root router surface

The current root router assembles:

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

### Business modules already implemented

- Company administration
- Sites and document sequentials
- Geography catalogs: countries, departments, cities
- Customer catalogs: identification types, person types, regime types, client types, commercial activities
- Providers, categories, units, VAT rates, locations
- Products with multi-price tiers, VAT, location, provider and unit support
- Orders, partial order receiving into purchases, staged-delivery receipt progress, purchases, purchase return audit metadata with actor visibility, and purchase void
- Sales, sale void, sale refund, receipt printing, POS keyboard shortcuts, responsive checkout
- Inventory stock, movements, adjustments, initial inventory, physical count
- Sync queue, conflicts, merged resolution, and admin sync center
- Dashboard reporting and exports

## Web Architecture

### App shell

The React app is composed around:

- `AuthProvider`
- `TenantProvider`
- `AppErrorBoundary`
- `ToastProvider`
- `ThemeProvider`
- `MainLayout`

The shell also includes:

- role-aware routing
- route-level lazy loading for major business pages
- on-demand export/reporting libraries behind the shared export service
- role-aware sidebar visibility
- offline/sync banner
- shared loading, retry, and toast feedback patterns

### Route surface

Current top-level routes:

- `/dashboard`
- `/company`
- `/sites`
- `/sequentials`
- `/locations`
- `/customer-catalogs`
- `/geography`
- `/providers`
- `/categories`
- `/units`
- `/vat-rates`
- `/products`
- `/orders`
- `/purchases`
- `/customers`
- `/sales`
- `/inventory`
- `/users`

Source:
[App.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/App.tsx)

The route modules are now lazy-loaded with Suspense fallbacks so the renderer does not eagerly ship every business screen in the initial bundle.

### Client data flow

Normal flow:

1. React component calls `trpc.<router>.<procedure>.useQuery()` or `.useMutation()`.
2. Requests go through `httpBatchLink` to `/api/trpc`.
3. The client sends an in-memory bearer access token for protected procedures and sends CSRF headers on cookie-backed unsafe auth flows.
4. Server middleware resolves auth, tenant, and site scope.
5. Router executes Zod validation and Drizzle queries or transactions.
6. TanStack Query remains the source of truth for server state.
7. UI invalidates affected queries after mutations.

Direct client config:
[trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)

## Desktop Architecture

### Main-process responsibilities

The Electron main process currently owns:

- embedded Fastify lifecycle
- auto-update status, manual check, and restart-to-install
- tray behavior and close-to-tray mode
- theme preference persistence
- receipt print settings persistence
- receipt printing
- DB backup and restore
- allowlisted local DB bridge for offline desktop workflows
- tenant-aware sync status and trigger APIs

### Preload bridge

The preload script exposes:

- `window.electron`
- `window.db`
- `window.sync`
- `window.api` as a compatibility aggregate

Source:
[index.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/preload/index.ts)

## Persistence and Sync Model

### Tenant isolation

Business data is scoped by tenant. In business terms, a tenant is one company or organization
using the software with isolated data.

### Site context

Some workflows are site-aware, especially:

- sequentials
- sales
- purchases
- order receiving

The selected site is attached to requests through `x-site-id`.

### Sync

The project currently includes:

- local sync queue tables
- conflict tracking
- server-side queue processing APIs
- desktop-side sync helpers
- sync center observability for pending work, retry/failure counts, conflicts, oldest queued change, and last successful sync time
- web sync center UI
- merged conflict resolution

This is an app-level sync framework, not yet a full documented remote multi-node replication story.

## Design Constraints That Matter

- Fastify is embedded in Electron main for desktop mode. It is not a child process.
- tRPC is the primary application transport. New app flows should not introduce new REST surfaces.
- `/api/health` exists only as a compatibility endpoint.
- SSE remains separate from tRPC by design.
- Inventory is still tenant-wide, not site-owned. That matters for future transfer design.

## Where To Look Next

- Current execution status:
  [IMPLEMENTATION_STATUS.md](/Users/johnny4young/Personal/github/open_yojob/docs/IMPLEMENTATION_STATUS.md)
- tRPC transport details:
  [TRPC_ARCHITECTURE.md](/Users/johnny4young/Personal/github/open_yojob/docs/TRPC_ARCHITECTURE.md)
- Open backlog:
  [OPEN_BACKLOG.md](/Users/johnny4young/Personal/github/open_yojob/docs/OPEN_BACKLOG.md)
