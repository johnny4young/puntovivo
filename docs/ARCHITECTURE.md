# Puntovivo Architecture

> Updated: April 21, 2026
> Audience: developers and technical operators

## System Diagram

![Puntovivo architecture](./architecture.svg)

Source: [architecture.mmd](./architecture.mmd). Re-render with:

```sh
npx -y @mermaid-js/mermaid-cli mmdc -i docs/architecture.mmd -o docs/architecture.svg -b transparent
```

Colour code: green = shipped, yellow = planned (Phase 11/12 — fiscal +
hardware), red = future (Phase 10+).

## Overview

Puntovivo is a multi-tenant POS application delivered primarily as an Electron desktop app.
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

The current root router assembles 31 routers:

- Core: `health`, `auth`, `users`
- Tenant master data: `companies`, `sites`, `sequentials`, `locations`, `logos`
- Geography: `countries`, `departments`, `cities`
- Customer classification: `identificationTypes`, `personTypes`, `regimeTypes`, `clientTypes`, `commercialActivities`, `customers`
- Catalog: `categories`, `units`, `vatRates`, `products`, `providers`
- Procurement: `orders`, `purchases`
- Sales: `sales`, `cashSessions`, `quotations`
- Inventory: `inventory`, `transfers`
- Operations: `dashboard`, `sync`, `auditLogs`

Source: [packages/server/src/trpc/router.ts](../packages/server/src/trpc/router.ts)

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

Source: [apps/web/src/App.tsx](../apps/web/src/App.tsx)

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

Direct client config: [apps/web/src/lib/trpc.ts](../apps/web/src/lib/trpc.ts)

## Desktop Architecture

For a detailed explanation of desktop lifecycle, IPC, and watch-state usage, see [DESKTOP_RUNTIME_GUIDE.md](./DESKTOP_RUNTIME_GUIDE.md).

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

Source: [apps/desktop/src/preload/index.ts](../apps/desktop/src/preload/index.ts)

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

## Persistence Reality Today

The current persistence layer is optimized for local SQLite:

- `packages/server/src/db/schema.ts` uses Drizzle SQLite schema primitives
- `packages/server/src/db/index.ts` uses `better-sqlite3`
- startup schema sync is written as raw SQLite DDL
- desktop runtime assumptions also expect a local SQLite database and allowlisted local bridge access

That means:

- standalone/local-first SQLite is a strong fit today
- remote-authoritative deployments are conceptually possible through the existing tRPC and sync boundaries
- PostgreSQL support would require deliberate abstraction work rather than a simple driver swap

## FK `onDelete` policy (ENG-175b)

Every foreign-key reference in `packages/server/src/db/schema.ts` falls
under one of three onDelete behaviours. The policy resolves the audit
2026-05-24 finding that 80% of FKs were defaulting to RESTRICT without
an explicit declaration, which produced confusing UX ("cannot delete
provider; 3 products reference it") and made the intent of each FK
opaque to a future maintainer.

| Behaviour | When to apply | Examples |
| --- | --- | --- |
| **`cascade`** | Parent-of-child relations where the child row has no meaning without the parent. Deleting the parent must atomically delete the children. | `sale_items.sale_id → sales`, `quotation_items.quotation_id → quotations`, `purchase_items.purchase_id → purchases`, `transfer_order_items.transfer_order_id → transfer_orders`, `fiscal_document_items.fiscal_document_id → fiscal_documents`, `sale_payments.sale_id → sales` |
| **`set null`** | Optional pointers to context that may legitimately disappear. The nullable column stores the historical link; clearing it preserves the parent row's audit value. | `sync_outbox.device_id → devices`, `*.operation_event_id → operation_events`, `sales.last_reprinted_by → users` |
| **`restrict`** (default) | Cross-aggregate references where deleting the parent would orphan business-meaningful data. The default SQLite behaviour matches this policy; the absence of an explicit `onDelete` in `references()` means RESTRICT applies. | `sales.customer_id → customers`, `products.category_id → categories`, every `*.tenant_id → tenants` (multi-tenant invariant), every `*.site_id → sites`, every `audit_logs.*` (immutability invariant), every `*.created_by → users` (users are deactivated via `is_active`, never hard-deleted) |

### Operational notes

- **Multi-tenant invariant**: a tenant row must NEVER cascade-delete the
  data that points to it. Every `*.tenant_id → tenants` reference is
  RESTRICT (explicit or implicit). The cleanup story for an offboarded
  tenant is a `tenants.is_active = 0` flip + a separate scheduled-purge
  job (out of scope for this policy).
- **Audit log immutability**: `audit_logs.*` references are RESTRICT.
  Deleting a user or a tenant must fail while audit rows reference
  them. The operator workaround is `users.is_active = 0`.
- **Backwards-compat**: SQLite treats `ON DELETE NO ACTION` (Drizzle's
  default when `onDelete` is omitted) and `ON DELETE RESTRICT`
  identically at runtime — the policy's "implicit RESTRICT" rule does
  not change behaviour on any existing install. Migration recreation
  pressure is therefore zero for the RESTRICT majority; only the
  cascade and set-null relations triggered table-recreation migrations
  when they were originally introduced.
- **New FK declarations**: when adding a new `references()` in
  `schema.ts`, default to RESTRICT (omit `onDelete`). Add an explicit
  `onDelete: 'cascade'` or `'set null'` only when the new relation
  falls under the cascade or set-null category above. The reviewer
  flags any new cascade introduction in the Review Guide so the
  semantic shift gets operator sign-off.
- **Cascade audit**: the cascade and set-null cases shipped today
  remain intact and are pinned by regression tests in
  `packages/server/src/__tests__/db-fk-policy.test.ts`. Any new cascade
  added in a later ticket must extend that suite.

## Database open path + encryption (ENG-167)

`local.db` opens through a single ordered sequence in
`packages/server/src/db/index.ts`. Step-1 of ENG-167 inserts the
SQLCipher key application as the very first PRAGMA so every later
read or write speaks to a keyed page cipher:

1. **Connection.** `new Database(dbPath, { verbose })` via the
   `better-sqlite3` alias that resolves to
   `better-sqlite3-multiple-ciphers@^12.10.0` (root `package.json`
   declares the alias; the fork ships SQLite3MultipleCiphers in the
   prebuilt native binary).
2. **Encryption key (skipped for `:memory:`).** When
   `DatabaseOptions.encryptionKey` is supplied:
   `PRAGMA cipher='sqlcipher'`, `PRAGMA legacy=4`, then
   `PRAGMA key = "x'<hex64>'"`.
   The fork rejects keys on transient DBs, so the in-memory test
   fleet keeps working unkeyed.
3. **WAL + FK** (ENG-002 baseline): `journal_mode = WAL` (skipped
   for `:memory:`), then `foreign_keys = ON`.
4. **ENG-174 PRAGMA cluster:** `busy_timeout`, `cache_size`,
   `temp_store`, then (file-only) `mmap_size` and
   `wal_autocheckpoint`.
5. **Drizzle handle + migrations** (ENG-002): `drizzle(sqlite,
   { schema })` then `drizzleMigrate(...)` against the explicit
   migrations folder.
6. **Catalogue seed** (ENG-002 Step 3): `seedCatalogs(db)`.
7. **Optional default-data seed.**

**Where the key comes from.** Electron main
(`apps/desktop/src/main/index.ts`) calls
`getOrCreateDbKey(getDbKeyDir(DB_PATH), safeStorage)` from
`apps/desktop/src/main/db-key-store.ts` BEFORE `createServer`. The
key is sealed at `<userData>/data/.dbkey.enc` via Electron's
`safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret /
gnome-keyring / KWallet). The standalone `dev:server` reads
`process.env.PUNTOVIVO_DB_KEY` instead — when unset, the legacy
cleartext path stays in effect. The renderer never sees the key:
the Chromium sandbox bars all Node access (ENG-004), and queries
travel through tRPC to the in-process Fastify, which is the only
holder of the live connection.

**What ENG-167 Step-1 deliberately leaves for ENG-167b.** Pre-Step-1
cleartext DBs require a one-shot migration on first boot of the
upgraded build; restore from a different device needs a key prompt
UX; cross-OS validation must run through
[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml).
Until ENG-167b lands, the ticket stays `Status: Partial` and the
production rollout is gated on the migration UX so existing
installs do not break.

## Future Data Topology Direction

The strongest forward path is:

1. keep SQLite as the local/offline database
2. introduce dialect-neutral repository and migration boundaries
3. formalize a remote-authority sync contract
4. support remote SQLite or PostgreSQL depending on deployment mode

The active roadmap for this work lives in:

- [ROADMAP.md](./ROADMAP.md)

## Error code policy (ENG-181)

Every error that crosses the tRPC boundary toward the frontend carries
a stable `errorCode` so the web client can translate it via
`errors.server.<CODE>` in the i18n catalogs. The canonical helper
lives at `packages/server/src/lib/errorCodes.ts`:

```ts
throwServerError({
  trpcCode: 'CONFLICT',
  errorCode: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
  message: 'Fiscal numbering resolution was not advanced',
  details: { resolutionId, tenantId, siteId, kind, expectedConsecutive },
});
```

This raises a `TRPCError` whose `cause` is a `ServerErrorWithCode`
instance carrying the `errorCode` enum value and the `details`
object. The frontend `translateServerError` reads `cause.errorCode`
through the formatter-projected `data.errorCode` field and looks up the
matching i18n key; `error-codes-coverage.test.ts` fails CI if a code
lands without both locale keys.

### Categoría A vs Categoría B — when to use which

Not every literal throw needs to become a `throwServerError`. The
split:

- **Categoría A — user-facing failures.** A real operator-or-tenant
  precondition has failed and the UI should toast a translated
  message. Examples: cash movement amount out of range, fiscal
  numbering TOCTOU loss, defensive post-INSERT reload that returned
  no row, credit ledger amount validation, pairing code allocation
  exhaustion. **→ Use `throwServerError({ trpcCode, errorCode,
  message, details })`.**

- **Categoría B — programmer asserts in internal helpers.** A pure
  helper (XML serializer, byte builder, manifest type guard) detected
  an invariant violation that the orchestrator upstream catches and
  re-emits with the right `errorCode`. Examples: CFDI 4.0 / DTE 1.0
  validators ("CFDI requires RFC in tenant settings"), ESC/POS
  unsupported character set, surfaces / events manifest unknown
  module / event type, sync contract unknown entity type. **→ Use
  `new Error(message, { cause: { country, document, missing, …
  tenantId } })`.** The structured `cause` flows through pino logs
  for operational diagnosis; the orchestrator's try/catch is the
  funnel that translates the inner error into a customer-facing
  `errorCode` via `throwServerError`.

### Pino redact policy

`logger.ts` preserves the `cause` chain for operational fields
(`cause.tenantId`, `cause.siteId`, `cause.errorCode`, `cause.kind`,
`cause.details.*`) so operators can grep an NDJSON log and see which
tenant + site + document triggered the failure. Sensitive nested
fields are still censored: `cause.password`, `cause.token`,
`cause.refreshToken`, `cause.email`, plus the one-level-deep
wildcards `cause.*.password` etc. The `logger.test.ts` ENG-181
describe block pins this contract.

### Frontend funnel — `onErrorToast`

Every mutation `onError` must funnel through `onErrorToast(toast, t,
options)` from `@/lib/mutationHelpers`. This single helper resolves
the `cause.errorCode` against the i18n catalog and emits a
translated toast. Inline patterns like `onError: (err) =>
toast.error({ title, description: err.message })` skip translation
and silently drop the cause chain — an ESLint `no-restricted-syntax`
rule in `apps/web/eslint.config.js` blocks the regression at lint
time.

## TypeScript strict-mode floor (ENG-179)

Every workspace's `tsconfig.json` enables `strict: true` plus an
explicit set of stricter flags that catch classes of bugs the
default strict profile leaves through. The floor is enforced in
three landings (ENG-179a / b / c) so each flag's blast radius
stays observable in a single staged commit:

| Workspace | `strict` | `noUncheckedIndexedAccess` | `exactOptionalPropertyTypes` | `noImplicitOverride` |
| --- | --- | --- | --- | --- |
| `packages/server` | ✅ | ✅ (ENG-179a) | parked (ENG-179b) | parked (ENG-179b) |
| `apps/web` | ✅ | ✅ (ENG-179a) | parked (ENG-179b) | parked (ENG-179b) |
| `apps/desktop` | ✅ | ✅ (ENG-179a) | parked (ENG-179b) | parked (ENG-179b) |

### `noUncheckedIndexedAccess` (ENG-179a, 2026-05-27)

The flag promotes every array / record index access from `T` to
`T | undefined`. Catches:

- `arr[i]` when the array could be empty (most common: result of
  a filter, a regex `match[N]` group that's actually optional, the
  first element of a `screen.getAllByRole(...)` query in tests).
- `record[key]` when the key might not exist (most common: looking
  up a pricing row by model id, a catalog row by code).

Fix patterns the codebase uses:

1. **Explicit `if (value === undefined)` narrow** — preferred when
   the path can be reached at runtime. Keeps the falsy branch
   observable for code review.
2. **`?? fallback` coalesce** — preferred when the undefined case
   has a safe default (e.g. `eventName.split('.')[0] ?? eventName`).
3. **`!` non-null assertion with `// reason:` comment** — only when
   the invariant is observable in the surrounding code (post
   `length > 0` check, fixed-length tuple modulo, regex required
   capture group). The comment must name the invariant.

### Lint + style guardrails

- **No `@ts-ignore` / `@ts-expect-error` without a `// reason:`
  comment.** The reviewer rejects unguarded escape hatches.
- **No `as any`** introduced to silence a strict-mode flag — that
  cosmetic cleanup is ENG-179c. New code uses explicit types or
  type guards instead.
- **Filter to narrow** for arrays of `T | undefined`:
  `.filter((x): x is T => x !== undefined)`.

## Design Constraints That Matter

- Fastify is embedded in Electron main for desktop mode. It is not a child process.
- tRPC is the primary application transport. New app flows should not introduce new REST surfaces.
- `/api/health` exists only as a compatibility endpoint.
- SSE remains separate from tRPC by design.
- Inventory is still tenant-wide, not site-owned. That matters for future transfer design.

## Client Surfaces

The same Electron + Vite bundle serves multiple UI variants as different
React routes, each tailored to a class of device. No code fork — the
business logic sits behind the tRPC client and is consumed identically
by every surface.

| Surface | Route | Typical device | Interaction | Status |
| --- | --- | --- | --- | --- |
| POS Desktop | `/sales` (default) | PC + keyboard + mouse | Dense tables, hover, shortcuts | **Shipped** |
| POS Touch | `/pos/touch` (planned) | All-in-one touch 15" (Elo, HP RP9) | Tiles ≥44px, on-screen keypad | Planned (Phase 6c — UI variants) |
| KDS (Kitchen Display) | `/kds?station=<id>` (planned) | TV 32-50" in kitchen, Raspberry Pi kiosk | Click/touch to advance ticket state | Planned (Phase 6b — restaurant) |
| Customer display | `/display/customer` (planned) | Second monitor facing the customer | Read-only live cart | Planned (Phase 6c) |
| Mobile waiter | `/pos/mobile` (planned) | Android tablet 10" portrait | Finger-scale, portrait layout | Planned (Phase 6c) |

See [UI-SURFACES.md](./UI-SURFACES.md) for deployment and authentication
details per surface.

## Deployment Topologies

Two deployment shapes are supported today; a third ("hybrid with central
server") is planned as part of Phase 10 / Stack Evolution (see
[STACK-EVOLUTION.md](./STACK-EVOLUTION.md)).

| Topology | Runtime | DB | Use case | Status |
| --- | --- | --- | --- | --- |
| **Embedded desktop** | Electron main + embedded Fastify | Local SQLite via better-sqlite3 | Single-tenant per install; offline-first | **Shipped — primary** |
| **Standalone server** | Node `packages/server` alone | Local SQLite or (future) libSQL | Dev, CI, test harness | **Shipped — secondary** |
| **Hybrid with central server** | Electron desktop + central Postgres/libSQL | Local SQLite + replicated Postgres | Franchises, consolidated BI, public API, mobile companion | **Planned (Phase 10)** |

For the hybrid topology:

- The desktop remains offline-first authoritative for its own tenant data.
- The central server receives `sync_outbox` diffs and materializes
  cross-site reports and public-API responses.
- A single codebase (`packages/server`) serves both roles: the Drizzle
  schema is dialect-neutral in principle; the migration to libSQL + an
  optional Postgres adapter is the α/β of the stack-evolution plan.

## External Integration Surface

| Integration | Channel | Owner | Phase |
| --- | --- | --- | --- |
| DIAN Proveedor Tecnológico (HKA / Facture / Gosocket) | HTTPS REST from main process | [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) | Phase 11 — P0 |
| ESC/POS thermal printer + RJ11 cash drawer | USB / network / serial from main process | [HARDWARE-POS.md](./HARDWARE-POS.md) | Phase 12 — P0 |
| Barcode scanner | USB HID keydown capture in renderer | [HARDWARE-POS.md](./HARDWARE-POS.md) | Phase 12 — P0 |
| Payment terminal (Bold, Wompi, Mercado Pago Point) | HTTPS / Bluetooth SDK from main process | [HARDWARE-POS.md](./HARDWARE-POS.md) | Phase 12 — P1 |
| GitHub Releases auto-updater | HTTPS from main process | Shipped | — |
| S3-compatible XML retention | HTTPS from main process or central server | [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) | Phase 11 |

Every integration goes through an **adapter pattern** (Port/Adapter) so
the domain layer stays vendor-neutral. New providers plug in without
changing sales, inventory, or audit code.

## Where To Look Next

- Project status and roadmap:
  [ROADMAP.md](./ROADMAP.md)
- tRPC transport details:
  [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
- Fiscal integration (DIAN): [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)
- Hardware peripherals: [HARDWARE-POS.md](./HARDWARE-POS.md)
- Module activation contract: [MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md)
- Stack evolution roadmap: [STACK-EVOLUTION.md](./STACK-EVOLUTION.md)
