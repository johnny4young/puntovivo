# Module Activation System

> Status: **Stub — design document.** Phase 0 Foundation item #13 in [ROADMAP.md](./ROADMAP.md).
> Created: April 21, 2026.

## Goal

Ship a single codebase where each tenant can turn on the verticals
they need — restaurant, pharmacy, salon, workshop — without loading
irrelevant code in the renderer or applying unused migrations to the DB.

## Contract

### What a module is

A **module** is a bundle of:

- Zero or more new DB tables (with additive DDL)
- Zero or more new tRPC routers (mounted under a namespace)
- Zero or more new UI routes (lazy-loaded)
- Zero or more extensions to existing routers (hooks / middlewares)
- Its own i18n namespace

It is **NOT**:

- A branch of the code
- A separately versioned package
- A fork of the domain

### Activation

A module is activated per tenant via `tenant_modules`:

```sql
CREATE TABLE tenant_modules (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,      -- 'restaurant', 'pharmacy', 'salon', ...
  activated_at TEXT NOT NULL,
  activated_by TEXT NOT NULL REFERENCES users(id),
  config_json TEXT,
  PRIMARY KEY (tenant_id, module_key)
);
```

At request time, tRPC context loads the active modules for the tenant.
Routers gated by a module use an `activeModule('restaurant')` middleware
that returns `FORBIDDEN` if the module is off.

### Module registry (server)

```ts
// packages/server/src/modules/registry.ts (planned)
export type ModuleKey = 'restaurant' | 'pharmacy' | 'salon' | 'workshop' | ...;

export interface ModuleDefinition {
  key: ModuleKey;
  displayName: string;
  router?: AnyRouter;             // mounted under /api/trpc/<key>/*
  seedOnActivate?: (ctx) => Promise<void>;
  uninstallPolicy: 'prevent-if-data' | 'soft-disable';
}
```

Core adds a module to the registry at build time. Activating it at
runtime only flips the `tenant_modules` row — no code reload.

### Module registry (web)

```ts
// apps/web/src/modules/registry.ts (planned)
export const moduleRoutes: Record<ModuleKey, { path: string; component: React.LazyExoticComponent<...> }> = {
  restaurant: { path: '/kds', component: React.lazy(() => import('./features/kds/KdsPage')) },
  ...
};
```

`App.tsx` only registers the lazy routes for modules the tenant has on.
Sidebar filters entries accordingly.

## Invariants

- A module cannot modify a core table's existing columns (only add new
  tables or columns with safe defaults)
- A module's tRPC procedures always pass through the tenant + auth
  middleware stack — no shortcut
- A module can register `seedOnActivate` hooks but these run in a
  single transaction; failure rolls back activation
- Deactivation is `soft-disable` by default — rows stay, only the
  module's UI and procedures hide. Full uninstall requires admin +
  confirmation + audit entry
- Adding a new module never requires a schema migration across tenants
  who don't use it

## Example: restaurant module

```
packages/server/src/modules/restaurant/
  index.ts              # ModuleDefinition export
  schema.ts             # preparation_stations, tables, ...
  routers/
    tables.ts
    kitchen.ts
  services/
    tables.ts
    preparation.ts
  seed.ts               # default stations, demo tables
```

On activation:

1. Ensure restaurant tables exist (idempotent DDL, like the current
   bootstrap approach)
2. Seed default preparation stations (Kitchen, Bar)
3. Emit audit_log entry `module.activated` with `metadata.moduleKey`

## Testing plan

- Activate / deactivate round-trip preserves data (soft-disable)
- Inactive module's tRPC routes return `FORBIDDEN` for that tenant
- Inactive module's UI routes are not registered
- Cross-tenant isolation: one tenant's activation doesn't leak into
  another
- Bundle splitting: confirmed by Vite `rollupOptions.output.manualChunks`

## Why this matters for stack evolution

Once modules are formalized, adding a new vertical (future: colleges,
agencies, food trucks, …) is a **contained PR** — a new directory, a
new row type. The core stays lean, each vertical evolves independently,
and tenants opt into exactly what they use.
