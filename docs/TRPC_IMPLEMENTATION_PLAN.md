# Consolidated tRPC Migration Plan

> **Updated:** April 7, 2026
> **Status:** Historical migration plan with current-state annotations
> **Current reality:** The app now runs tRPC-first for production flows

This document started as the active migration plan from the older REST layer to tRPC. It now serves
as a historical reference. For the concise repo snapshot, see
`docs/IMPLEMENTATION_STATUS.md`.

## Current State

### Migration outcome

- tRPC is the primary application API on `/api/trpc`.
- The root router now includes the operational modules used by the app:
  `auth`, `companies`, `dashboard`, `providers`, `sequentials`, `units`, `vatRates`,
  `categories`, `products`, `customers`, `purchases`, `sales`, `inventory`, `sites`,
  `sync`, and `users`.
- The frontend uses the configured tRPC React client and vanilla client in
  `apps/web/src/lib/trpc.ts`.
- The old `services/api/*` and `hooks/api/*` REST client layers are gone.
- SSE remains outside tRPC under `/api/realtime/*`, which is expected.

### What completed from the original plan

| Original phase | Result |
| --- | --- |
| Phase 1: Setup | Complete |
| Phase 2: Auth router | Complete |
| Phase 3: Entity routers | Complete and expanded beyond the original scope |
| Phase 4: Frontend page wiring | Complete for the operational feature set, including admin pages, products, customers, inventory, sales, purchases, and dashboard |
| Phase 5: Remove REST layer | Complete in practice for app flows; `/api/health` remains intentionally as a compatibility endpoint |

## Current tRPC Architecture Snapshot

### Backend

- Server entry:
  [packages/server/src/index.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/index.ts)
- Root router:
  [packages/server/src/trpc/router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)
- Auth/tenant/role middleware:
  [packages/server/src/trpc/middleware](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/middleware)
- Domain routers:
  [packages/server/src/trpc/routers](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/routers)

### Frontend

- React tRPC provider and links:
  [apps/web/src/main.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/main.tsx)
- Shared tRPC client helpers:
  [apps/web/src/lib/trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)
- Feature pages call tRPC procedures directly instead of going through wrapper REST hooks.

## Remaining Follow-Up

The migration plan itself is no longer the main backlog, but a few cleanup items still exist:

- Keep documentation aligned with the tRPC-first architecture.
- Continue retiring historical references to REST routes in older docs.
- Preserve `/api/health` as compatibility-only unless the team chooses to remove it.
- Keep SSE isolated as a Fastify plugin until there is a concrete reason to replace it.

## Recommended Reference Order

Use these docs in this order:

1. `docs/IMPLEMENTATION_STATUS.md` for the current project status
2. `docs/TRPC_ARCHITECTURE.md` for the live transport architecture
3. `docs/MIGRATION_PLAN.md` for the broader product-roadmap history
