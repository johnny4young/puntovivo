# Consolidated tRPC Migration & Phase 0 Plan

> **Updated:** March 31, 2026
> **Status:** Phase 1 Complete -- Phases 2-5 ready to implement
> **Approach:** Build all new features on tRPC, migrate existing REST, then remove REST layer entirely

---

## Current State

### What exists (Phase 1 -- DONE)

| Component                            | Status | Location                                        |
| ------------------------------------ | ------ | ----------------------------------------------- |
| tRPC init + error formatter          | Done   | `packages/server/src/trpc/init.ts`              |
| Context (db, user, tenant)           | Done   | `packages/server/src/trpc/context.ts`           |
| Auth middleware (protectedProcedure) | Done   | `packages/server/src/trpc/middleware/auth.ts`   |
| Tenant middleware (tenantProcedure)  | Done   | `packages/server/src/trpc/middleware/tenant.ts` |
| Root router + health.check           | Done   | `packages/server/src/trpc/router.ts`            |
| Fastify plugin at `/api/trpc`        | Done   | `packages/server/src/index.ts`                  |
| React client + vanilla client        | Done   | `apps/web/src/lib/trpc.ts`                      |
| React provider wiring                | Done   | `apps/web/src/main.tsx`                         |

### What needs migration (REST -> tRPC)

| REST Route File         | Endpoints                            | Target                                   |
| ----------------------- | ------------------------------------ | ---------------------------------------- |
| `routes/auth.ts`        | login, logout, refresh, me, password | `trpc/routers/auth.ts`                   |
| `routes/collections.ts` | Generic CRUD for 8 tables            | Individual tRPC routers per entity       |
| `routes/sync.ts`        | Queue CRUD, status, conflicts, stubs | `trpc/routers/sync.ts`                   |
| `realtime/sse.ts`       | SSE subscribe + status               | Keep as Fastify plugin (SSE is not tRPC) |
| Health check (inline)   | `/api/health`                        | Already in tRPC as `health.check`        |

### Frontend to rewrite

| Layer                 | Files to Remove                                                                 | Replacement                               |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| REST client           | `services/api/client.ts`                                                        | tRPC client (already exists)              |
| REST domain services  | `services/api/products.ts`, `customers.ts`, `sales.ts`, `inventory.ts`          | tRPC router type inference                |
| REST hooks            | `hooks/api/useProducts.ts`, `useCustomers.ts`, `useSales.ts`, `useInventory.ts` | tRPC React hooks                          |
| Auth (keep partially) | `services/api/client.ts` login/logout methods                                   | tRPC auth router + simplified auth client |

---

## Phase 2: Auth Router (Day 1)

Migrate all 5 auth endpoints to tRPC. Auth is the foundation -- everything else depends on it.

### 2.1 Create Zod Schemas

Create `packages/server/src/trpc/schemas/auth.ts`:

```typescript
// loginSchema: { email: string, password: string }
// changePasswordSchema: { currentPassword: string (12+ chars), newPassword: string (12+ chars) }
```

### 2.2 Create Auth Router

Create `packages/server/src/trpc/routers/auth.ts`:

| Procedure             | Type     | Auth      | Input                  | Notes                                                |
| --------------------- | -------- | --------- | ---------------------- | ---------------------------------------------------- |
| `auth.login`          | mutation | Public    | `loginSchema`          | Rate limit: 5/15min (keep Fastify rate-limit plugin) |
| `auth.logout`         | mutation | Public    | None                   | Returns `{ success: true }`                          |
| `auth.refresh`        | mutation | Protected | None                   | Returns new JWT                                      |
| `auth.me`             | query    | Protected | None                   | Returns user + tenant                                |
| `auth.changePassword` | mutation | Protected | `changePasswordSchema` | Validates strength                                   |

**Business logic to move from `routes/auth.ts`:**

- `validatePasswordStrength()` function
- Argon2 hash/verify
- JWT sign with `{ userId, tenantId, email, role }`, 7-day expiry
- User active-status + tenant active-status checks

**Rate limiting note:** tRPC doesn't have built-in rate limiting. Keep the Fastify `@fastify/rate-limit` plugin and apply it via a tRPC middleware that checks the route path, or apply rate limiting at the Fastify level for the `/api/trpc/auth.login` path specifically.

### 2.3 Update Auth Provider

Modify `apps/web/src/features/auth/AuthProvider.tsx` to use tRPC:

```typescript
// Replace api.login() with trpc.auth.login.mutate()
// Replace api.getMe() with trpc.auth.me.useQuery()
// Replace api.logout() with trpc.auth.logout.mutate()
// Replace api.changePassword() with trpc.auth.changePassword.mutate()
```

### 2.4 Update Tests

Rewrite `packages/server/src/__tests__/auth.test.ts`:

- Use `appRouter.createCaller(context)` instead of HTTP injection
- Test the same scenarios: valid login, invalid password, non-existent user, etc.
- Test rate limiting separately (stays at Fastify level)

### Phase 2 Deliverables

- [ ] Auth Zod schemas
- [ ] Auth tRPC router with all 5 procedures
- [ ] Rate limiting working for auth.login
- [ ] AuthProvider rewritten to use tRPC
- [ ] Auth tests rewritten and passing
- [ ] REST `routes/auth.ts` still registered (keep as fallback until Phase 5)

---

## Phase 3: Entity Routers (Days 2-4)

Migrate all collection CRUD to individual tRPC routers. Build them one at a time.

### 3.1 Common Schemas

Create `packages/server/src/trpc/schemas/common.ts`:

```typescript
// paginationSchema: { page: number (default 1), perPage: number (1-100, default 50) }
// sortSchema: { sortBy: string, sortDirection: 'asc' | 'desc' }
// idSchema: { id: string }
```

### 3.2 Router Build Order

Build in dependency order (simpler entities first, complex ones last):

#### 3.2.1 Categories Router

| Procedure            | Type     | Auth           | Notes                           |
| -------------------- | -------- | -------------- | ------------------------------- |
| `categories.list`    | query    | Tenant         | Paginated, tenant-isolated      |
| `categories.getById` | query    | Tenant         | Single record                   |
| `categories.create`  | mutation | Tenant         | Auto-generates id, timestamps   |
| `categories.update`  | mutation | Tenant         | Validates exists + tenant match |
| `categories.delete`  | mutation | Tenant (admin) | Admin only                      |
| `categories.tree`    | query    | Tenant         | Returns parent-child hierarchy  |

#### 3.2.2 Products Router

| Procedure          | Type     | Auth           | Notes                                            |
| ------------------ | -------- | -------------- | ------------------------------------------------ |
| `products.list`    | query    | Tenant         | Paginated, filterable (category, active, search) |
| `products.getById` | query    | Tenant         | With category name join                          |
| `products.create`  | mutation | Tenant         | Validates categoryId exists, adds to sync queue  |
| `products.update`  | mutation | Tenant         | Validates exists, increments syncVersion         |
| `products.delete`  | mutation | Tenant (admin) | Admin only, adds to sync queue                   |
| `products.search`  | query    | Tenant         | Fast search by name/SKU/barcode (for POS)        |

#### 3.2.3 Customers Router

| Procedure           | Type     | Auth           | Notes                 |
| ------------------- | -------- | -------------- | --------------------- |
| `customers.list`    | query    | Tenant         | Paginated, searchable |
| `customers.getById` | query    | Tenant         |                       |
| `customers.create`  | mutation | Tenant         |                       |
| `customers.update`  | mutation | Tenant         |                       |
| `customers.delete`  | mutation | Tenant (admin) |                       |
| `customers.search`  | query    | Tenant         | By name, email, phone |

#### 3.2.4 Sales Router

| Procedure       | Type     | Auth           | Notes                                                                  |
| --------------- | -------- | -------------- | ---------------------------------------------------------------------- |
| `sales.list`    | query    | Tenant         | Paginated, filterable (customer, date range, status)                   |
| `sales.getById` | query    | Tenant         | With sale items joined                                                 |
| `sales.create`  | mutation | Tenant         | **Transactional:** create sale + items, decrement stock, add movements |
| `sales.update`  | mutation | Tenant         | Status changes only                                                    |
| `sales.void`    | mutation | Tenant (admin) | Reverses stock changes                                                 |

**Critical:** Move sale creation business logic **from client-side** (`services/api/sales.ts`) **to server-side** in this router. The server must calculate totals, validate stock, and use a Drizzle transaction.

#### 3.2.5 Inventory Router

| Procedure                  | Type     | Auth           | Notes                                                              |
| -------------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| `inventory.listMovements`  | query    | Tenant         | Paginated, filterable (product, type, date range)                  |
| `inventory.getMovement`    | query    | Tenant         |                                                                    |
| `inventory.createMovement` | mutation | Tenant         | **Transactional:** validate stock, update product, create movement |
| `inventory.adjustStock`    | mutation | Tenant (admin) | Adjustment type movement                                           |
| `inventory.productStock`   | query    | Tenant         | Current stock for a product                                        |

**Critical:** Move stock calculation logic **from client-side** (`services/api/inventory.ts`) **to server-side**.

#### 3.2.6 Sync Router

| Procedure              | Type     | Auth      | Notes                          |
| ---------------------- | -------- | --------- | ------------------------------ |
| `sync.status`          | query    | Protected | Pending count, conflicts count |
| `sync.listQueue`       | query    | Protected | Pending items with limit       |
| `sync.addToQueue`      | mutation | Protected | Add sync operation             |
| `sync.removeFromQueue` | mutation | Protected | Delete by id                   |
| `sync.listConflicts`   | query    | Protected | Unresolved conflicts           |

Keep the 3 stub endpoints (push, pull, resolve) as tRPC procedures returning `NOT_IMPLEMENTED` error.

### 3.3 Root Router Assembly

Update `packages/server/src/trpc/router.ts`:

```typescript
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  categories: categoriesRouter,
  products: productsRouter,
  customers: customersRouter,
  sales: salesRouter,
  inventory: inventoryRouter,
  sync: syncRouter,
});
```

### 3.4 Frontend Hooks

For each entity, create a tRPC hook file that replaces the REST hook:

| Old File (delete)           | New Pattern                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `hooks/api/useProducts.ts`  | `trpc.products.list.useQuery(...)` directly in components           |
| `hooks/api/useCustomers.ts` | `trpc.customers.list.useQuery(...)` directly in components          |
| `hooks/api/useSales.ts`     | `trpc.sales.list.useQuery(...)` directly in components              |
| `hooks/api/useInventory.ts` | `trpc.inventory.listMovements.useQuery(...)` directly in components |

**No wrapper hooks needed.** tRPC provides full type inference through the React hooks. Components call `trpc.<router>.<procedure>.useQuery()` or `.useMutation()` directly.

For cache invalidation patterns, use `trpc.useUtils()`:

```typescript
const utils = trpc.useUtils();
const createProduct = trpc.products.create.useMutation({
  onSuccess: () => utils.products.list.invalidate(),
});
```

### 3.5 Rewrite Tests

For each entity router, rewrite the test file using `createCaller`:

```typescript
const caller = appRouter.createCaller({
  req,
  res,
  db,
  user,
  tenantId,
});
const result = await caller.products.list({ page: 1, perPage: 10 });
```

### Phase 3 Deliverables

- [ ] Zod schemas for all entities
- [ ] Categories tRPC router + tests
- [ ] Products tRPC router + tests
- [ ] Customers tRPC router + tests
- [ ] Sales tRPC router + tests (with server-side transaction logic)
- [ ] Inventory tRPC router + tests (with server-side stock logic)
- [ ] Sync tRPC router + tests
- [ ] Root router assembles all routers
- [ ] All existing test scenarios ported and passing

---

## Phase 4: Wire Frontend Pages (Days 5-6)

Replace hardcoded sample data in all pages with live tRPC queries.

### 4.1 Pages to Wire

| Page                | Current State               | Wire To                                                |
| ------------------- | --------------------------- | ------------------------------------------------------ |
| `ProductsPage.tsx`  | `useState(sampleProducts)`  | `trpc.products.list.useQuery()`                        |
| `CustomersPage.tsx` | `useState(sampleCustomers)` | `trpc.customers.list.useQuery()`                       |
| `SalesPage.tsx`     | `useState(sampleSales)`     | `trpc.sales.list.useQuery()`                           |
| `InventoryPage.tsx` | `useState(sampleMovements)` | `trpc.inventory.listMovements.useQuery()`              |
| `DashboardPage.tsx` | Hardcoded metrics           | Needs aggregation queries (defer to Migration Phase 6) |

### 4.2 Per-Page Wiring Pattern

For each page:

1. Remove `sampleData` array and `useState`
2. Add tRPC query: `const { data, isLoading, error } = trpc.<entity>.list.useQuery({ page: 1, perPage: 50 })`
3. Add loading state (skeleton or spinner)
4. Add error state
5. Wire CRUD actions to tRPC mutations (create/update/delete buttons)
6. Add cache invalidation on mutations

### 4.3 Auth Integration

Verify `AuthProvider` works end-to-end with tRPC auth procedures:

- Login flow: tRPC mutation -> store token -> redirect to dashboard
- Token refresh: on 401, call `trpc.auth.refresh.mutate()`
- Protected routes: `trpc.auth.me.useQuery()` for session validation

### Phase 4 Deliverables

- [ ] ProductsPage wired to live tRPC data
- [ ] CustomersPage wired to live tRPC data
- [ ] SalesPage wired to live tRPC data
- [ ] InventoryPage wired to live tRPC data
- [ ] Loading and error states on all pages
- [ ] CRUD actions working (create, edit, delete)
- [ ] Auth flow working end-to-end with tRPC
- [ ] DashboardPage left as-is (hardcoded until Migration Phase 6)

---

## Phase 5: Remove REST Layer (Day 7)

Once all functionality is on tRPC, remove the REST layer.

### 5.1 Server -- Delete REST Routes

| File to Delete                              | Replacement                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `packages/server/src/routes/auth.ts`        | `trpc/routers/auth.ts`                                            |
| `packages/server/src/routes/collections.ts` | `trpc/routers/{products,categories,customers,sales,inventory}.ts` |
| `packages/server/src/routes/sync.ts`        | `trpc/routers/sync.ts`                                            |

### 5.2 Server -- Clean Up index.ts

Remove from `packages/server/src/index.ts`:

- `import { authRoutes }` and its `app.register(authRoutes, ...)`
- `import { collectionsRoutes }` and its `app.register(collectionsRoutes, ...)`
- `import { syncRoutes }` and its `app.register(syncRoutes, ...)`
- Inline health check route (replaced by `health.check` tRPC procedure)
- `X-Tenant-ID` header preHandler hook (tRPC context handles this via JWT)

Keep:

- `@fastify/cors` (still needed)
- `@fastify/jwt` (tRPC context uses `req.jwtVerify()`)
- `@fastify/rate-limit` (still needed for auth)
- SSE plugin (`realtime/sse.ts`) -- SSE is transport-level, not tRPC
- Database decoration (`app.decorate('db', db)`)

### 5.3 Frontend -- Delete REST Services

| File to Delete                           | Notes                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web/src/services/api/products.ts`  | Replaced by tRPC type inference                                                  |
| `apps/web/src/services/api/customers.ts` | Replaced by tRPC type inference                                                  |
| `apps/web/src/services/api/sales.ts`     | Replaced by tRPC type inference                                                  |
| `apps/web/src/services/api/inventory.ts` | Replaced by tRPC type inference                                                  |
| `apps/web/src/services/api/client.ts`    | Auth methods moved to tRPC. SSE subscribe can move to a small standalone helper. |
| `apps/web/src/services/api/index.ts`     | Barrel export, delete                                                            |
| `apps/web/src/hooks/api/useProducts.ts`  | Replaced by direct tRPC hooks                                                    |
| `apps/web/src/hooks/api/useCustomers.ts` | Replaced by direct tRPC hooks                                                    |
| `apps/web/src/hooks/api/useSales.ts`     | Replaced by direct tRPC hooks                                                    |
| `apps/web/src/hooks/api/useInventory.ts` | Replaced by direct tRPC hooks                                                    |
| `apps/web/src/hooks/api/index.ts`        | Barrel export, delete                                                            |

### 5.4 Verify Nothing References REST

Search entire codebase for:

- `/api/auth/` -- should only exist in tests (which were already rewritten)
- `/api/collections/` -- should not exist anywhere
- `/api/sync/` -- should not exist anywhere
- `ApiClient` or `api.` calls -- should not exist in production code
- `fetch(` calls to the server -- should not exist (tRPC handles transport)

### 5.5 Update Postman Collection

Update or delete `postman/Open_Yojob_tRPC.postman_collection.json` to reflect tRPC endpoints.

### Phase 5 Deliverables

- [ ] REST route files deleted (3 files)
- [ ] Server index.ts cleaned up
- [ ] Frontend REST services deleted (6 files)
- [ ] Frontend REST hooks deleted (5 files)
- [ ] No remaining references to REST endpoints in production code
- [ ] SSE subscribe extracted to standalone helper (if still needed)
- [ ] All tests passing
- [ ] Postman collection updated

---

## File Structure After Migration

```
packages/server/src/
  trpc/
    init.ts                    # (exists)
    context.ts                 # (exists)
    router.ts                  # (update: assemble all routers)
    schemas/
      auth.ts                  # NEW
      common.ts                # NEW (pagination, sort, id)
      products.ts              # NEW
      categories.ts            # NEW
      customers.ts             # NEW
      sales.ts                 # NEW
      inventory.ts             # NEW
      sync.ts                  # NEW
    routers/
      auth.ts                  # NEW
      products.ts              # NEW
      categories.ts            # NEW
      customers.ts             # NEW
      sales.ts                 # NEW
      inventory.ts             # NEW
      sync.ts                  # NEW
    middleware/
      auth.ts                  # (exists)
      tenant.ts                # (exists)
  db/                          # (unchanged)
  realtime/                    # (unchanged -- SSE stays)
  routes/                      # DELETED entirely
  __tests__/
    auth.test.ts               # Rewritten for tRPC callers
    collections.test.ts        # Rewritten -> products.test.ts, categories.test.ts, etc.
    sync.test.ts               # Rewritten for tRPC callers

apps/web/src/
  lib/
    trpc.ts                    # (exists)
  features/
    auth/AuthProvider.tsx       # Updated to use tRPC
    products/ProductsPage.tsx   # Updated to use tRPC
    customers/CustomersPage.tsx # Updated to use tRPC
    sales/SalesPage.tsx         # Updated to use tRPC
    inventory/InventoryPage.tsx # Updated to use tRPC
  services/api/                # DELETED entirely
  hooks/api/                   # DELETED entirely
```

---

## Implementation Checklist

### Phase 1: Setup (DONE)

- [x] Dependencies installed
- [x] Folder structure created
- [x] Initializer and context configured
- [x] Auth middlewares implemented
- [x] Root router created
- [x] Fastify integration complete
- [x] React client configured
- [x] Test procedure works

### Phase 2: Auth Router

- [ ] Auth Zod schemas
- [ ] Auth tRPC router (5 procedures)
- [ ] Rate limiting for auth.login
- [ ] AuthProvider updated
- [ ] Auth tests rewritten and passing

### Phase 3: Entity Routers

- [ ] Common schemas (pagination, sort, id)
- [ ] Categories router + tests
- [ ] Products router + tests
- [ ] Customers router + tests
- [ ] Sales router + tests (server-side transactions)
- [ ] Inventory router + tests (server-side stock logic)
- [ ] Sync router + tests
- [ ] Root router assembles all

### Phase 4: Wire Frontend Pages

- [ ] ProductsPage wired
- [ ] CustomersPage wired
- [ ] SalesPage wired
- [ ] InventoryPage wired
- [ ] Loading/error states
- [ ] CRUD actions working
- [ ] Auth flow end-to-end

### Phase 5: Remove REST

- [ ] REST route files deleted
- [ ] Server index.ts cleaned
- [ ] Frontend REST services deleted
- [ ] Frontend REST hooks deleted
- [ ] No stale REST references
- [ ] All tests passing
- [ ] Documentation updated

---

**Plan Version**: 2.0
**Last Updated**: March 2026
**Status**: Phase 1 Complete -- Phase 2 ready to implement
