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
    src/db/         Drizzle schema + migrations + catalog seed
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

The current root router assembles 53 routers:

- Core: `health`, `auth`, `users`
- Tenant master data: `companies`, `sites`, `sequentials`, `locations`, `logos`
- Geography: `countries`, `departments`, `cities`
- Customer classification: `identificationTypes`, `personTypes`, `regimeTypes`, `clientTypes`, `commercialActivities`, `customers`
- Catalog: `categories`, `units`, `vatRates`, `products`, `providers`
- Procurement: `orders`, `purchases`
- Sales: `sales`, `cashSessions`, `quotations`
- Inventory: `inventory`, `transfers`
- Operations: `dashboard`, `sync`, `auditLogs`
- Fiscal and documents: `receiptTemplates`, `fiscalSettings`, `reports`
- Payments: `payments`, `paymentSettings`
- Peripherals and surfaces: `peripherals`, `surfaces`, `modules`, `events`, `observability`, `authority`
- Restaurant and delivery: `restaurantTables`, `restaurantSettings`, `kds`, `deliveryOrders`
- AI, locale, and misc: `ai`, `tenantLocale`, `customerLedger`, `setupReadiness`, `whatsNew`, `upload`

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

### Client state ownership (ENG-018b / ENG-171)

Server state lives in TanStack Query. Cross-cutting client state lives in Zustand stores (not React context) so a high-frequency provider re-render (auth/token refresh, cart updates) cannot cascade through unrelated consumers; components subscribe via selectors and only re-render on the slice they read.

- `useCartWorkspaceStore` / `useQuickCreateStore` — sales UI state (ENG-018b).
- `useModulesStore` (in `features/modules/ModulesContext.tsx`) + `useLocaleStore` (in `features/locale/LocaleProvider.tsx`) — effective modules + resolved tenant locale (ENG-171, migrated from context providers).

Because a Zustand store cannot run a tRPC `useQuery`, each store that mirrors server state is fed by a **sync hook** (`useModulesSync`, `useLocaleSync`) mounted once as a null-rendering host (`<ModulesSync />`, `<LocaleSync />`) inside `AuthProvider` + `TenantProvider` in `App.tsx`. The sync hook owns the query and any side-effects (e.g. the locale hook pushes to the `setActiveTenantLocale` formatter singleton and calls `i18n.changeLanguage`), and resets the store on logout. Consumer hooks (`useIsModuleActive`, `useModulesSnapshot`, `useResolvedLocale`) keep stable import paths + signatures so call sites do not change when state moves between context and store.

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

| Behaviour                | When to apply                                                                                                                                                                                                                 | Examples                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`cascade`**            | Parent-of-child relations where the child row has no meaning without the parent. Deleting the parent must atomically delete the children.                                                                                     | `sale_items.sale_id → sales`, `quotation_items.quotation_id → quotations`, `purchase_items.purchase_id → purchases`, `transfer_order_items.transfer_order_id → transfer_orders`, `fiscal_document_items.fiscal_document_id → fiscal_documents`, `sale_payments.sale_id → sales`                  |
| **`set null`**           | Optional pointers to context that may legitimately disappear. The nullable column stores the historical link; clearing it preserves the parent row's audit value.                                                             | `sync_outbox.device_id → devices`, `*.operation_event_id → operation_events`, `sales.last_reprinted_by → users`                                                                                                                                                                                  |
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
- **Table-recreation migrations + cascade (ENG-177c)**: a migration
  that recreates a parent table with cascade children (e.g. the `sales`
  rebuild that added `chk_sales_cash_session_or_draft`) MUST run under
  the connection-level `foreign_keys = OFF` bracket in `db/index.ts`
  (see "Database open path" step 5). Without it, the rebuild's
  `DROP TABLE` cascade-deletes the children. The bracket already covers
  every migration, so new rebuilds inherit the safety automatically.

## Optimistic concurrency — live-edit guard (ENG-177a)

User-edited catalogs carry an integer `version` column that the
matching `*.update` tRPC procedure bumps on every write. The client
round-trips the version it last read; the UPDATE pins it in the WHERE
clause (`... AND version = ?`) and sets `version = supplied + 1`. When
another tab or operator already saved, the stored version no longer
matches, the statement changes zero rows, and the procedure throws
`STALE_VERSION` (`CONFLICT`) via the shared
`packages/server/src/lib/optimisticVersion.ts::assertVersionedWriteApplied`
helper instead of silently clobbering the other edit. A single
better-sqlite3 UPDATE is atomic, so there is no read-then-write TOCTOU
window. The renderer's `onErrorToast` branch invalidates the cached
list/row on `STALE_VERSION` so the next edit loads the latest version.

- **Versioned today**: `products`, `customers`, `providers`,
  `categories`, `tenant_locale_settings`. `sequentials` is excluded by
  design — it is an atomically incremented operational counter reached
  through an upsert, not a two-tab edit surface.
- **`tenant_locale_settings`** is an upsert keyed by `tenant_id`: the
  fallback resolver returns a virtual `version = 0` when no row exists,
  and the first save stores the real row at `version = 1` so a second
  tab that also loaded the fallback is rejected instead of overwriting
  the first save. The input `version` remains optional for legacy/no-row
  clients; the guard bites whenever a divergent explicit version is
  supplied. The version is surfaced on the resolved-locale DTO
  (`ResolvedLocale.version`) so the admin card can round-trip it.
- **Layer distinction vs ADR-0004**: this is the _mutation-layer_ guard
  for concurrent online edits against the same authoritative embedded
  DB. It is complementary to — not a replacement for — the _sync-layer_
  conflict policy in
  [`architecture/0004-conflict-policy.md`](./architecture/0004-conflict-policy.md),
  which reconciles offline cross-device edits by `updatedAt` with an
  auto-LWW audit trail (ENG-064). Catalogs are auto-LWW at the sync
  layer and `STALE_VERSION`-guarded at the live-edit layer.
- **Pinned by** `packages/server/src/__tests__/optimistic-version.test.ts`
  (happy-path increment, stale rejection leaving the row intact, the
  credit-limit audit still firing on a versioned customer update,
  tenant-scoped existence, and the locale first-save stale-fallback path).

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
   migrations folder. Legacy DB adoption seeds only the squashed
   baseline marker in `__drizzle_migrations`; newer migrations remain
   pending and still run on any adopted DB whose target tables exist.
   Partial legacy/test DBs that lack a target table entirely may mark
   that specific migration as an absent-target no-op, because there is
   nothing to rewrite. **FK-safe rebuild bracket (ENG-177c):** the
   migrate call is wrapped in connection-level `foreign_keys = OFF`
   → migrate → `foreign_keys = ON`. SQLite cannot `ALTER TABLE ADD
CHECK`, so a constraint change recreates the table (CREATE
   `__new_<t>` / INSERT…SELECT / DROP / RENAME); drizzle-orm runs every
   migration inside one `BEGIN`/`COMMIT`, and `PRAGMA foreign_keys` is a
   no-op inside a transaction, so an in-migration toggle cannot protect
   the `DROP TABLE` from firing ON DELETE CASCADE on child rows.
   Disabling enforcement at the connection level _before_ the
   transaction is the only lever that preserves data (verified
   empirically). After restoring enforcement, a `PRAGMA
foreign_key_check` aborts the boot if any orphaned reference exists,
   so a botched rebuild surfaces loudly instead of corrupting silently.
6. **Catalogue seed** (ENG-002 Step 3): `seedCatalogs(db)`.

### Schema-enforced cash-session invariant (ENG-177c)

`sales` carries `chk_sales_cash_session_or_draft`
(`CHECK (cash_session_id IS NOT NULL OR status = 'draft')`). The rule
that every committed sale is bound to a cash session is enforced in
application code (`requireActiveCashSession` + the in-tx
`assertCashSessionStillOpen`, ENG-042/055); this constraint pins it at
the storage layer so a raw write, a future sync path, or a bug cannot
persist a `completed` / `cancelled` / `voided` sale with a null session.
Drafts are exempt by design. It is purely additive — both `sales` INSERT
sites already bind a session today (even for drafts), so no row violates
it. Adding it is the motivating example for the FK-safe rebuild bracket
above. Pinned by
`packages/server/src/__tests__/sales-cash-session-constraint.test.ts`. 7. **Optional default-data seed.**

**Where the key comes from.** Electron main
(`apps/desktop/src/main/index.ts`) calls
`getOrCreateDbKey(getDbKeyDir(DB_PATH), safeStorage)` from
`apps/desktop/src/main/db-key-store.ts` BEFORE `createServer`. The
key is sealed at `<userData>/data/.dbkey.enc` via Electron's
`safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret /
gnome-keyring / KWallet); Linux `basic_text` is rejected even when Electron
reports encryption as available. The standalone `dev:server` reads
`process.env.PUNTOVIVO_DB_KEY` instead — when unset, the legacy
cleartext path stays in effect. The renderer never sees the key:
the Chromium sandbox bars all Node access (ENG-004), and the normal status,
backup, and query paths expose metadata or encrypted files only. The sole
exception is the explicit admin recovery action described below, which reveals
the key only after a warning so a cross-device restore remains operable.

**ENG-167b (2026-06-11) — migration + cross-device restore.** The
desktop boot now runs `migrateCleartextDatabase()`
(`apps/desktop/src/main/db-migrate-encryption.ts`) between key
resolution and `createServer`: a pre-Step-1 cleartext `local.db`
(detected by its readable SQLite header — a SQLCipher file encrypts
page 1) is WAL-checkpointed, copied to a temporary
`.pre-encryption.bak`, encrypted in place via `PRAGMA rekey`,
integrity-verified, and the `.bak` deleted; a failed verification
restores the original and aborts the boot. The dev-shared
`DATABASE_URL` route is excluded. Restores of bundles from another
device prompt for the source key and REKEY the staged file to the
local key before the swap (`provide-restore-key` /
`get-backup-encryption-key` IPC; threat model in
[SECURITY.md](./SECURITY.md)). The only ENG-167 remainder is the
operator-run cross-OS matrix through
[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml).

**ENG-129e (2026-07-14) — non-secret protection status.**
`get-backup-protection-status` is admin-gated in main and reports SQLCipher
readiness plus the platform key provider without resolving or returning the
key. The Company backup card distinguishes OS-keychain protection,
launcher-injected development keys, and degraded/unattested providers.

**ENG-136a (2026-07-14) — scheduled snapshot ownership.** Electron main owns a
tenant-keyed, device-local schedule store plus the timer that creates daily or
weekly SQLCipher backup bundles. Managed destinations live below
`userData/backups/<tenant>`; custom destinations come only from Electron's
native directory picker. The preload exposes narrow admin-gated status,
configuration, destination-picker, and run-now calls. A shared FIFO operation
queue serializes scheduled snapshots with the existing manual backup and
restore paths, and app shutdown drains the queue before closing the embedded
server. This keeps path access and database lifecycle authority out of the
sandboxed renderer while preserving cross-platform Node path semantics.

## Future Data Topology Direction

The strongest forward path is:

1. keep SQLite as the local/offline database
2. introduce dialect-neutral repository and migration boundaries
3. formalize a remote-authority sync contract
4. support remote SQLite or PostgreSQL depending on deployment mode

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

| Workspace         | `strict` | `noUncheckedIndexedAccess` | `exactOptionalPropertyTypes` | `noImplicitOverride` |
| ----------------- | -------- | -------------------------- | ---------------------------- | -------------------- |
| `packages/server` | ✅       | ✅ (ENG-179a)              | ✅ (ENG-179b)                | ✅ (ENG-179b)        |
| `apps/web`        | ✅       | ✅ (ENG-179a)              | ✅ (ENG-179b)                | ✅ (ENG-179b)        |
| `apps/desktop`    | ✅       | ✅ (ENG-179a)              | ✅ (ENG-179b)                | ✅ (ENG-179b)        |

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

### `exactOptionalPropertyTypes` (ENG-179b, 2026-05-28)

The flag changes how the compiler matches `{ foo?: T }`: pre-flag a
caller could pass `{ foo: undefined }` and it would type-check;
post-flag the compiler rejects that because "field absent" and "field
present with value undefined" are no longer the same. Catches:

- Mutation builders that spread a partial state into a shape the
  consumer expects to be exactly-typed (`{ envelope: ctx.envelope }`
  where `ctx.envelope` is `Envelope | undefined`).
- tRPC routers destructuring a Zod-decoded `input` and forwarding the
  resulting fields into service helpers whose declared signatures used
  bare `?` optionals.
- Test fixtures with `{ data: undefined, isLoading: true }` standing in
  for a tRPC query result whose `data?` field is shape-strict.

Fix patterns the codebase uses (default to Patrón A unless the
consumer genuinely needs an exact-shape distinction):

1. **Widen target — Patrón A**: declare the optional field with an
   explicit `| undefined` so the type accepts both "absent" and
   "present-but-undefined":
   ```ts
   interface KdsHookContext {
     log?: Logger | undefined;
   }
   ```
   Use this for >95% of sites. Simpler, less invasive, preserves
   runtime semantics.
2. **Conditional spread — Patrón B**: when the consumer's type is
   third-party / immovable (e.g. Electron `HeadersReceivedResponse`,
   strict-shape DTOs that reject extra keys) and you cannot widen the
   target, omit the field instead of passing `undefined`:
   ```ts
   callback(
     details.responseHeaders === undefined ? {} : { responseHeaders: details.responseHeaders }
   );
   ```
   Lives at the call site only — the type stays narrow for everyone
   else.

i18next interop carve-out: utility helpers that take a `t` function
parameter use `import type { TFunction } from 'i18next'` rather than a
hand-rolled `(key: string, options?: …) => string` shim. The branded
generic overloads in `TFunction` do not structurally match a widened
options signature under exactOptional, so the explicit import keeps the
call sites assignable without per-namespace casts.

### `noImplicitOverride` (ENG-179b, 2026-05-28)

The flag requires every subclass method that overrides a parent to
carry the `override` keyword. Catches typos in the override chain —
when someone renames the parent's method, the subclass silently stops
overriding instead of failing the compile.

Fix is mechanical: add `override` before the field / method modifier.
The codebase has one class-component hot spot (`AppErrorBoundary`'s
React 19 lifecycle methods) plus the Electron `BrowserWindow` event
handler subclasses. No call-site impact, zero runtime change.

### `no-explicit-any` → error + structural cleanup (ENG-179c, 2026-05-28)

The final ENG-179 landing promotes `@typescript-eslint/no-explicit-any`
from `'warn'` to `'error'` in all three ESLint configs
(`packages/server`, `apps/web`, `apps/desktop`) and clears the remaining
`as any` debt.

- **Production `as any` floor**: under 5 in production code. The only
  remaining production exemption is the outbox kernel
  (`packages/server/src/lib/outbox/kernel.ts`): Drizzle's
  `insert` / `select` / `update` builders reject a _parametric_
  `SQLiteTable`, so the unavoidable cast is isolated to a single
  documented `type AnyBuilder = any` consumed by three boundary helpers
  (`insertInto` / `selectAll` / `updateOf`); every call site is otherwise
  fully typed. Seeds (`db/seed-mega/historical-*.ts`) and test fixtures
  are exempt **with a documented `-- reason:`** on the disable directive.
- **Exemption convention**: every `eslint-disable-next-line
@typescript-eslint/no-explicit-any` carries a trailing
  `-- reason: <why>`; a bare disable is a review reject.
- **Typed critical-command context**: the nine
  `(ctx as unknown as { envelope?: ... })` double-casts that the
  sales / cashSessions / inventory routers used to read the
  `commandEnvelope` middleware's injected fields are replaced by a single
  exported `CriticalCommandContext` type plus one documented boundary
  helper, `asCriticalCommandContext(ctx)`, in
  `trpc/middleware/commandEnvelope.ts`. tRPC does not propagate the
  middleware's context override to downstream resolvers (its idempotency
  cache short-circuit returns a value that did not flow through `next()`,
  collapsing `$ContextOverridesOut` inference back to the base context),
  so the narrowing lives in one named place instead of nine inline casts.
- **`types/` module split**: `apps/web/src/types/index.ts` (~1000 LOC)
  was split into `types/domain.ts` (business entities), `types/ui.ts`
  (enums / unions / response wrappers, zero deps), and `types/api.ts`
  (home for `inferRouterOutputs` DTOs). `index.ts` is now a re-export
  shim kept for one release so the ~142 existing `@/types` import sites
  resolve unchanged; the conservative split deferred a wholesale
  hand-written-DTO → `inferRouterOutputs` migration because the domain
  models are also consumed by the offline / IndexedDB layer. The
  receipt-renderer DTOs (`RenderSaleItem` / `RenderTender`) were already
  exported from the server with no web duplicate, so that AC item closed
  as a no-op.

### Lint + style guardrails

- **No `@ts-ignore` / `@ts-expect-error` without a `// reason:`
  comment.** The reviewer rejects unguarded escape hatches.
- **`@typescript-eslint/no-explicit-any` is `'error'`** (ENG-179c) in
  every workspace. New `as any` requires a documented
  `-- reason:` exemption and is only acceptable at a genuine type-system
  boundary (e.g. a third-party generic the compiler cannot express);
  prefer explicit types or type guards.
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

| Surface               | Route                         | Typical device                           | Interaction                         | Status                           |
| --------------------- | ----------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------- |
| POS Desktop           | `/sales` (default)            | PC + keyboard + mouse                    | Dense tables, hover, shortcuts      | **Shipped**                      |
| POS Touch             | `/pos/touch` (planned)        | All-in-one touch 15" (Elo, HP RP9)       | Tiles ≥44px, on-screen keypad       | Planned (Phase 6c — UI variants) |
| KDS (Kitchen Display) | `/kds?station=<id>` (planned) | TV 32-50" in kitchen, Raspberry Pi kiosk | Click/touch to advance ticket state | Planned (Phase 6b — restaurant)  |
| Customer display      | `/display/customer` (planned) | Second monitor facing the customer       | Read-only live cart                 | Planned (Phase 6c)               |
| Mobile waiter         | `/pos/mobile` (planned)       | Android tablet 10" portrait              | Finger-scale, portrait layout       | Planned (Phase 6c)               |

See [UI-SURFACES.md](./UI-SURFACES.md) for deployment and authentication
details per surface.

## Deployment Topologies

Two deployment shapes are supported today; a third ("hybrid with central
server") is planned as part of Phase 10 / Stack Evolution (see
[STACK-EVOLUTION.md](./STACK-EVOLUTION.md)).

| Topology                       | Runtime                                    | DB                                 | Use case                                                  | Status                  |
| ------------------------------ | ------------------------------------------ | ---------------------------------- | --------------------------------------------------------- | ----------------------- |
| **Embedded desktop**           | Electron main + embedded Fastify           | Local SQLite via better-sqlite3    | Single-tenant per install; offline-first                  | **Shipped — primary**   |
| **Standalone server**          | Node `packages/server` alone               | Local SQLite or (future) libSQL    | Dev, CI, test harness                                     | **Shipped — secondary** |
| **Hybrid with central server** | Electron desktop + central Postgres/libSQL | Local SQLite + replicated Postgres | Franchises, consolidated BI, public API, mobile companion | **Planned (Phase 10)**  |

For the hybrid topology:

- The desktop remains offline-first authoritative for its own tenant data.
- The central server receives `sync_outbox` diffs and materializes
  cross-site reports and public-API responses.
- A single codebase (`packages/server`) serves both roles: the Drizzle
  schema is dialect-neutral in principle; the migration to libSQL + an
  optional Postgres adapter is the α/β of the stack-evolution plan.

## External Integration Surface

| Integration                                           | Channel                                   | Owner                                            | Phase         |
| ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ | ------------- |
| DIAN Proveedor Tecnológico (HKA / Facture / Gosocket) | HTTPS REST from main process              | [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) | Phase 11 — P0 |
| ESC/POS thermal printer + RJ11 cash drawer            | USB / network / serial from main process  | [HARDWARE-POS.md](./HARDWARE-POS.md)             | Phase 12 — P0 |
| Barcode scanner                                       | USB HID keydown capture in renderer       | [HARDWARE-POS.md](./HARDWARE-POS.md)             | Phase 12 — P0 |
| Payment terminal (Bold, Wompi, Mercado Pago Point)    | HTTPS / Bluetooth SDK from main process   | [HARDWARE-POS.md](./HARDWARE-POS.md)             | Phase 12 — P1 |
| GitHub Releases auto-updater                          | HTTPS from main process                   | Shipped                                          | —             |
| S3-compatible XML retention                           | HTTPS from main process or central server | [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) | Phase 11      |

Every integration goes through an **adapter pattern** (Port/Adapter) so
the domain layer stays vendor-neutral. New providers plug in without
changing sales, inventory, or audit code.

## Where To Look Next

- tRPC transport details:
  [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
- Fiscal integration (DIAN): [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)
- Hardware peripherals: [HARDWARE-POS.md](./HARDWARE-POS.md)
- Module activation contract: [MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md)
- Stack evolution roadmap: [STACK-EVOLUTION.md](./STACK-EVOLUTION.md)
