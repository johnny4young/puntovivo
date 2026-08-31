# Puntovivo Architecture

Puntovivo is a local-first modular monolith. The browser and Electron renderer
share one React application; Fastify and tRPC own business APIs; SQLite is the
operational authority. In Electron, the Fastify server runs in-process inside
main rather than as a child process.

![Puntovivo architecture](./architecture.svg)

Source diagram: [architecture.mmd](./architecture.mmd).

## Repository map

| Path              | Responsibility                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | React application, routes, role/module gates, user workflows, i18n, and browser tests.                                      |
| `apps/desktop`    | Electron lifecycle, sandboxed window, preload bridge, updater, local peripherals, encrypted storage, and backup operations. |
| `packages/server` | Fastify host, tRPC routers, application services, persistence, workers, fiscal, sync, payments, and tests.                  |
| `packages/shared` | Cross-workspace contracts such as roles, money, and approval types.                                                         |
| `e2e`             | Browser and Electron end-to-end journeys.                                                                                   |
| `scripts`         | CI, release, performance, setup, migration, and runtime guards.                                                             |

## Runtime shape

```text
React renderer
  -> tRPC client
    -> Fastify /api/trpc
      -> authenticated tenant/site context
        -> role and site guards
          -> application services
            -> Drizzle + SQLite transaction
              -> audit, journal, and outbox evidence
```

The browser target connects to a standalone Fastify process. The Electron
target imports `@puntovivo/server` directly into main and serves the same tRPC
surface to its renderer.

## API and application boundaries

- `/api/trpc` is the canonical application API.
- `/api/health` remains a compatibility and operational health endpoint.
- `/api/realtime/*` carries server-sent events over the canonical Bearer
  access session. Browser and local-authority renderers use streaming `fetch`;
  Store Hub clients use a fixed-endpoint main-process relay. The server
  revalidates `sessionVersion` before each heartbeat so logout, device
  revocation, and disabled users or tenants close existing streams.
- Routers validate input, authorize the actor, enforce tenant/site scope, and
  delegate non-trivial rules to application or service modules.
- Server tests call `appRouter.createCaller(...)` against in-memory SQLite;
  they do not allocate HTTP ports.
- Every operation accepting a site identifier validates that the site belongs
  to the active tenant.

### Companion boundary

`/c` is an installable read-only surface, not a smaller copy of the manager
application. Admin, manager, and viewer call one module-gated
`companion.snapshot` procedure. Its tenant-timezone read model contains only
bounded totals, twelve recent anonymous sale references, aggregate attention,
and integrity-verified day-close signer metadata. Cashier is excluded.

The `companion` SSE collection carries only an invalidation scope and timestamp;
it never carries customer, line, site, or sale totals. The older detailed
`sales` collection remains manager/admin-only for compatibility. A generated
service worker is registered only by the production HTTP(S) Companion route
and precaches an exact content-versioned shell allowlist. `/api/*` is always
network-only. Going offline resets the authenticated snapshot cache, so
reconnect must complete a new read before operational cards reappear.

## Persistence invariants

- Drizzle migrations are the only schema-change path.
- Every business query is tenant scoped. Site-owned workflows add site scope.
- Money is stored and validated under the shared rounding contract.
- Sale completion requires an active cash session for tenant, site, and
  cashier.
- Versioned mutable resources use compare-and-swap updates and report conflicts
  rather than silently overwriting concurrent edits.
- Fiscal, payment, hardware, and sync effects use dedicated durable outboxes.
- Purchase and inventory-order stock mutations finish their tenant/site-scoped
  business rows, audit evidence, sync outbox rows, canonical replay result, and
  idempotency success in one `BEGIN IMMEDIATE` transaction. A crash or replay
  cannot commit stock without its authoritative synchronization evidence.
- Inventory movements carry an explicit nullable site foreign key. Current
  writers always provide the authoritative site; migration backfills only
  provable sale, purchase, return, and initial-inventory relationships, leaving
  genuinely ambiguous historical adjustments or transfers unattributed.
- The operation journal and audit log preserve who changed sensitive state and
  which effects committed.
- Signed day-close evidence and fiscal snapshots are immutable.
- Completed sales freeze customer, site, cashier, product-name, product-SKU,
  company identity/contact, customer tax-ID, ordinary receipt template layout,
  logo source, and receipt locale. Separate version markers distinguish
  deliberately empty sale-time identity or presentation fields from
  pre-migration rows, which retain current-row compatibility fallback. A sale
  completed without an active template remains on the legacy renderer even if
  a template is configured later.

## Local storage and recovery

Packaged Electron databases use SQLCipher. The database key is obtained through
Electron secure storage and never crosses into the renderer. Node and Electron
share the target platform's bundled better-sqlite3 v13 Node-API binary. Runtime
preflights execute a SQLCipher probe under Node or Electron, and desktop
packaging prunes every non-target native binary before signing.

Backups are encrypted bundles with integrity inspection. Creation checkpoints
the WAL first, derives passphrase keys asynchronously through a bounded scrypt
queue, and streams the database into a same-directory atomic ZIP. Restore
validates the bounded central directory and local records before extracting
known regular-file entries into private temporary files; duplicate, unknown,
traversal, symlink, overlapping, truncated, oversized, or integrity-mismatched
content fails closed before publication. The v2 bundle names, key derivation,
hashes, MAC, and legacy deflate readability remain stable. Scheduled snapshots,
restore drills, backup-protection status, and S3-compatible cloud-vault upload
all remain main-process capabilities.

## Product search boundary

Interactive literal search resolves indexed exact SKU/barcode lanes first,
then a tenant-scoped FTS5/BM25 shortlist, and uses a bounded `LIKE` scan only
as a compatibility fallback for text that the tokenizer cannot represent.

Semantic search is a hybrid reranker rather than a second catalog scan. It
unions exact matches with a high-recall OR-token FTS shortlist, falls back to
substring candidates only when FTS returns none, and enforces a hard ceiling
of 200 candidate ids. Only those tenant-owned rows whose stored vector uses
the active embedding model are decoded and cosine-scored in JavaScript. Thus
request memory and CPU are bounded independently of catalog size. Invoice and
voice matching retain an explicit all-tenant embedding loader because they are
separate batch workflows; interactive routes must never call that loader.

New vectors use the portable, versioned `PVEC` float32 BLOB; legacy JSON rows
remain readable until explicit catalog regeneration replaces them. This avoids
another native extension while reducing the retained 200-vector pool's storage
and decode cost. The current Ollama default is the corpus-selected 768-dimension
`embeddinggemma`; OpenAI retains `text-embedding-3-small`. Equal dimensions do
not imply compatible embedding spaces, so model changes require regeneration.
[ADR-0011](./architecture/0011-product-search-vectors.md) owns the codec,
benchmark, market comparison, and extension-adoption trigger.

## Price-tier boundary

Products expose a three-price grid for their base unit. Each alternate unit
assignment carries its own `price`, `price2`, and `price3`; an unset alternate
tier is stored as zero and resolves to that assignment's Tier 1 price rather
than to the product's base-unit price. The shared price-tier contract is used
by browser and server code so fallback behavior cannot diverge by surface.

Customer selection and price application are deliberately separate actions.
Selecting a customer validates identity and availability but never rewrites an
open cart or quotation. The operator must explicitly apply Tier 1, 2, or 3 in
Sales, POS Touch, or the quotation editor. Sale completion resolves the final
customer once under tenant scope, then reuses that canonical result for credit,
loyalty, persistence, and audit behavior. Modern sales clients also send the
ticket's explicit tier; the server freezes it on the sale header and uses that
snapshot as the price-override reference. Legacy clients that omit the field
retain their prior behavior by inheriting the resolved customer's default.

Every completed sale item freezes the three catalog prices that were available
for its selected unit. Drafts also freeze the selected header tier; suspend and
resume preserve it, and completion rejects a stale client tier rather than
silently reclassifying prices. Override evaluation uses that frozen tier and
grid, so changing a draft's customer cannot erase a real override or manufacture
one from later catalog edits. Migration `0049` backfills open legacy drafts from
their tenant-owned attached customer while leaving settled history at the
conservative retail default. Quotations store the explicitly selected tier as
document metadata alongside their frozen line prices.

## Normalized line-tax boundary

Products, sale items, quotation items, and fiscal-document items may carry one
to four ordered, unique tax components. Catalog definitions store kind
(`iva` or `inc`), rate, and stable key; sale, quotation, and fiscal child rows
add the frozen taxable and rounded tax amounts. Every row is tenant owned.
Product selection resolves only active rates owned by the current tenant. Sale
and quotation writes use the stored product component definitions and require
any optional client component ids to match their canonical order. A legacy
numeric override remains valid only when it is unchanged or matches an active
tenant-owned rate of the same single tax kind; it cannot replace a
multi-component definition. Legacy clients that omit the component array
receive one component built from the existing summary columns.

The old `taxRate`, `taxKind`, `vatRateId`, and `taxAmount` columns remain a
read-compatible summary while clients migrate: the primary component supplies
the kind and rate id, and the rate/amount columns hold the combined totals.
Migration `0047` deterministically backfills one component for every historical
product, sale line, quotation line, and fiscal line. Component allocation uses
the shared inclusive/exclusive tax split and `roundMoney`; any rounding residue
is assigned deterministically so component amounts equal the frozen line and
header totals exactly.

Fiscal creation recomputes the rounded IVA and INC line totals and requires
their sum to equal the frozen sale header inside the same write transaction
that creates the document, enqueues its outbox item, and advances numbering.
Receipt renderers expand the legacy `taxTotal` layout token into distinct IVA
and INC rows from the immutable components. Fiscal creation copies the sale
components into its own snapshot in the document transaction, so credits,
reprints, exports, and provider adapters do not depend on mutable catalog data.

The Colombia mock adapter may serialize the frozen `unitMeasureCode` as the
UBL 2.1 quantity `unitCode`. Its output is deliberately labelled a local,
unsigned, untransmitted and non-certified draft. It is not a provider,
authority response, certification artifact, or production transmission path.
Colombia can preserve IVA and INC on the same line in that local draft. Mexico
and Chile currently reject combinations their draft serializers cannot
represent instead of silently dropping a component.

## Audit-chain freshness boundary

In packaged Electron, each tenant audit chain has two authorities that must
agree: the SQLite `audit_chain_heads` row and a versioned envelope sealed by
`safeStorage` outside the database. The external envelope stores a confirmed
counter/head plus an ordered set of pending reservations. Audited writes reserve
every candidate that can exist before the next transaction-boundary settlement;
the observed committed database head selects the valid prefix and discards any
rolled-back suffix. A write reserves the next counter before advancing its
transactional database head, includes that counter in the
head HMAC, advances the database head through a versioned compare-and-swap, and
confirms the external state only after commit. Startup recovery accepts only
the confirmed point or an exact pending candidate created around that boundary;
rewind, disappearance, or any other divergence after adoption fails closed.

Verification starts from the persisted head and follows the chain-hash index
backwards in bounded pages, selecting only canonical hash fields. Large walks
hash in a short-lived worker and yield between pages. One in-flight verifier is
shared per tenant/database and administrator starts are rate limited, but no
integrity verdict is cached across calls: the head, counter, version, adoption
date, and row count are reread before success. Privacy redaction rewrites the
chain inside the caller's all-or-nothing write transaction with temporary
tables rather than materializing all history in JavaScript.

Rows created after a tenant's adoption date must be chained. Remote sync apply
of `audit_logs` is explicitly rejected because one database-wide chain cannot
honestly merge device histories without a device-aware model. ADR-0012 owns
this trust boundary and its crash-state reasoning. The server accepts an
optional `AuditAnchorStore`; a standalone deployment that supplies only the
HMAC key retains linkage checks but must not claim external rewind detection.

## Electron security boundary

The main window uses `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. Renderer code cannot read files, spawn processes, open native
sockets, or import Node modules.

Every desktop capability follows:

```text
renderer -> contextBridge wrapper -> ipcRenderer.invoke
         -> validated ipcMain.handle -> main-process capability
```

Preload wrappers stay narrow and declarative. Business data normally flows over
tRPC; IPC is reserved for desktop-only lifecycle, storage, updater, backup,
printing, and local-device capabilities.

For the single production `BrowserWindow`, the main process also retains the
currently verified access token in memory only. A renderer reload can request
that token through the narrow `session.resume` channel; main re-verifies it
against the active authority before returning it and clears the singleton when
it is expired, stale, or no longer belongs to the registered identity. The
token is never written to disk and remains absent from session diagnostics.

Database and sync IPC methods are constructed through an Electron-free handler
core that resolves the tenant from that verified main-process session before
validation or persistence can run; renderer tenant hints are compatibility
inputs only and never control scope. Workstation-settings writes and the
server-issued device-id setter use the same authorization primitive. The
pre-login locale update remains structurally separate because it must translate
the login window, tray, and updater before authentication. The read-only device
id is needed to complete login; read-only workstation presentation preferences
contain no tenant or business data. Node tests enumerate every authenticated
db/sync channel and pin those bounded pre-login exceptions. Expected stale-session
failures cross the main/preload wire as a closed error envelope instead of a
rejected `ipcMain.handle` call; preload recreates the renderer rejection without
Electron's internal invoke wrapper or a main-process stack diagnostic.

## Desktop update boundary

Downloaded update history and install authorization are separate states. The
schema-v2 history may show a completed version and SHA-512 identity after an
app restart, but the install action remains disabled until electron-updater
reconfirms that same artifact in the current process. The highest installed
version is independently sealed through `safeStorage` and advances
monotonically; the client rejects every feed candidate below that floor even
when the mutable remote policy calls it a rollback.

The appcast is therefore allowed to request staged promotion, never emergency
downgrade. Recovery to an older binary is a separately delivered manual
installer operation with explicit operator approval and database protection.
This local policy does not prove platform signing, a production updater round
trip, or representative-machine downgrade refusal; those remain Gate 5
evidence.

## Sync and Authority Node

The local database remains authoritative. `sync_outbox` records eventual
replication work and conflict policy without making network availability a
precondition for a local sale. Runtime modes are:

- `device_local` — one installation owns its local authority;
- `site_hub` — a LAN-accessible authority for a store;
- `hub_client` — a terminal that submits commands to the store hub and may use
  a local hardware bridge.

In Electron `hub_client` mode, authentication renewal is a main-process
capability rather than a renderer cookie flow. Main performs login, refresh,
staff switching, and logout against the configured hub; proxies renderer
`/api/*` traffic only to that fixed destination with an explicit request-header
allowlist; seals the rotating refresh and CSRF values with `safeStorage`; and persists the envelope with
owner-only file permissions (`0600` where supported and the per-user OS ACL on
Windows). The renderer receives only the short-lived access token and
response-shaped API results; it never receives the renewable cookies or a
general-purpose network primitive. Desktop IPC
registration accepts that token only when it exactly matches the grant
currently held by the main-process hub session, so it never attempts to
validate a remote-hub signature with the embedded local server secret. Packaged
clients require an HTTPS hub URL; development permits HTTP only on a loopback
address.

The sync kernel is implemented, but it is not a promise of hosted, offline
multi-master cloud replication. Public readiness and known operational gaps are
listed in [PROJECT-STATUS.md](./PROJECT-STATUS.md).

## Module and UI architecture

Routes are lazy loaded and protected by authentication, role, site, and module
state. Server and web share the role contract. TanStack Query owns server
state; Zustand or component state owns client-only interaction state. Visible
copy lives in bilingual locale namespaces and Spanish uses neutral Latin
American `tú` forms.

Global keyboard navigation and application actions come from one canonical
shortcut registry containing keys, scope, roles, and optional route. The
listener, role-shaped shortcut sheet, command-palette hints, navigation links,
and `aria-keyshortcuts` consume that registry. A visible control advertises a
shortcut only when that exact action is currently addressable; page-scoped and
editable-field collision rules remain enforced by the listener.

Vertical modules may exist without being part of the retail production wedge.
Inactive modules must not add navigation, permissions, or operational noise.

## Durable decisions

Architecture Decision Records in [architecture/](./architecture/README.md)
own decisions that future changes must preserve:

- local-store authority;
- command envelope;
- outbox taxonomy;
- conflict policy;
- sync payload contract;
- local data security;
- module activation;
- Authority Node runtime modes;
- money storage and validation;
- labor overtime evidence;
- audit-chain external freshness.

## Related references

- [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
- [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md)
- [DESKTOP_RUNTIME_GUIDE.md](./DESKTOP_RUNTIME_GUIDE.md)
- [SECURITY.md](./SECURITY.md)
- [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)
- [HARDWARE-POS.md](./HARDWARE-POS.md)
- [TESTING.md](./TESTING.md)
