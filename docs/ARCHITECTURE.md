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

Unauthenticated entry through `/c` returns directly to that surface after
login, without first mounting the dashboard. The return destination accepts
only the exact Companion path and its allowed roles, not arbitrary redirect
URLs. Ordinary logins retain their role/readiness default.

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
- Payment, hardware, and sync effects use dedicated durable outboxes. A
  fiscal-enabled completed sale first records a frozen emission intent in the
  sale transaction; the fiscal worker materializes that intent into the fiscal
  document and provider outbox atomically before delivery.
- Purchase and inventory-order stock mutations finish their tenant/site-scoped
  business rows, audit evidence, sync outbox rows, canonical replay result, and
  idempotency success in one `BEGIN IMMEDIATE` transaction. A crash or replay
  cannot commit stock without its authoritative synchronization evidence.
- Sale creation, draft completion, and normalized returns finish their domain
  rows, audit evidence, sync outbox rows, canonical replay reference, and
  idempotency success in the same `BEGIN IMMEDIATE` transaction. Fiscal-enabled
  completed sales also freeze their buyer, line, tax, locale, configuration,
  and numbering-resolution inputs into `fiscal_emission_intents` in that same
  transaction. Post-commit worker wake-up, provider delivery, realtime
  broadcast, and journal summaries remain explicit best-effort effects rather
  than part of the money and stock commit; an interrupted wake-up cannot erase
  the durable fiscal obligation.
- Inventory movements carry an explicit nullable site foreign key. Current
  writers always provide the authoritative site; migration backfills only
  provable sale, purchase, return, and initial-inventory relationships, leaving
  genuinely ambiguous historical adjustments or transfers unattributed.
- A blind physical count is a site-owned session with immutable exact signed
  book-balance, balance-revision, base-unit, and cost snapshots. Counting reads
  redact those fields until submission. Every live balance writer advances a
  business revision independently from sync transport metadata. Approval runs
  under a reserved SQLite writer, rejects quantity, revision, base-unit, or
  tracking-policy drift instead of rebasing, and commits physical-count
  evidence, discrepancy movements, balance changes, audit, sync intent, and the
  command result atomically. Aggregate counts cannot mutate lot or serial
  identity.
- Replenishment is a read projection, not an automatic stock writer. It compares
  minimum stock with available site stock plus still-unreceived quantities from
  draft, submitted, or partially received orders. An accepted suggestion creates
  only a purchase-order draft; explicit submission precedes the existing receipt
  transaction, and abandoning the draft has no stock or supplier-account effect.
- Lot-tracked purchase and order receipts require concrete batch rows whose base
  quantities reconcile exactly to the received line. Supplier returns and
  purchase voids debit only that frozen provenance and reject a current lot
  whose number, expiry, or unit cost no longer matches the receipt snapshot.
  Purchase detail distinguishes the unreturned receipt entitlement from what
  is physically returnable now: site balance for ordinary stock, exact sourced
  identities for serials, and still-present frozen batches whose current site,
  product, number, expiry, and cost still match the receipt. The UI offers only
  that projection, while the write transaction independently revalidates it
  under concurrency.
  Transfers freeze the exact source batch, status, expiry, cost, destination
  layer, and discrepancy so a move or reversal cannot substitute a different
  lot or reactivate non-vendable stock.
- Inventory transformation recipes describe global or site-owned expected
  inputs and weighted outputs. An execution freezes actual quantities, exact
  input-lot number/expiry/status, output identities, waste, cost allocation,
  both product cost bases before/after posting, actor, movements, audit, sync,
  and replay evidence in one write transaction. Non-lot inputs use the same
  `initialCost` basis consumed by inventory valuation; outputs update that
  basis and the distinct catalog `cost` atomically. Waste is evidence about
  already-consumed input, not another debit. Void succeeds only while every
  frozen input identity, output balance revision, both product costs plus their
  sync revision, and output lot remain untouched.
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

## Vertical profiles, quantity, and GS1 boundary

Hardware and butchery are operating profiles over the shared retail kernel,
not separate product/catalog databases. Applying either profile records the
tenant business type and changes only its server-owned surface-module patch.
It never creates or rewrites products, categories, units, stock, lots, serials,
AI settings, or integrations.

Create-product templates are explicit unsaved form operations available only
for the selected profile. They resolve an active existing unit with the required
physical dimension; a weighted template also requires its positive canonical
mass factor. They configure length/serial/lot or weighted/packaged-cut fields,
preserve the current price grid with safe Tier 2/Tier 3 fallback, and leave the
form untouched if the unit is absent or incompatible. A cut template does not
itself consume stock or create transformation evidence. Managers configure and
execute those inputs, outputs, yield, waste, remnants, and distributed costs in
the separate Inventory transformation surface defined by
[ADR-0018](./architecture/0018-lot-procurement-and-transformations.md).

The shared `0.001` constant is the smallest increment exposed by current
product, alternate-unit, sale-cart, purchase, and order controls. It is not a
server-wide lower bound: existing valid positive fraction policies remain
readable and enforceable. Quantity normalization stays independent from the
two-decimal monetary rounding contract.

For a 13-digit 2x barcode, product lookup reads the active keyboard-wedge
scanner under the authenticated tenant and active site. Its optional 20–29
prefix map determines weight, price, or ordinary-EAN behavior. The client sends
only the raw barcode, so it cannot override site semantics. Missing maps retain
the historical even-weight/odd-price layout; malformed active maps fail closed
to ordinary EAN lookup, while absence of an active site disables embedded
interpretation entirely. A weight payload requires an explicit mass base unit
and is converted from kilograms through that unit's gram reference factor before
the product fraction policy runs; unclassified, non-mass, or packaging-only
matches fail closed. Consecutive weight packages add their measured quantities.
A price payload is one whole-package unit price interpreted through the tenant's
normal tax/pricing mode: equal prices may share a line, different prices keep
independent identities through suspend/resume, and neither customer-tier
repricing nor the exact `sale_price_override` approval is bypassed. A cashier
must consume a manager grant bound to the complete financial snapshot;
manager/admin roles and manager-authored accepted quotations retain their
existing authority. Before the drawer exposes that action, the authenticated
checkout preflight rereads the tenant-owned unit catalog or the draft's frozen
price snapshots. This read-side hint closes stale renderer metadata but never
replaces the independent completion check. Non-2x lookups avoid the peripheral
read. Country scheme names currently share the generic five-digit SKU/five-digit
payload layout and do not certify any physical scale or national label
convention.

[ADR-0017](./architecture/0017-vertical-profiles-site-gs1.md) owns these
profile, template, precision, and scanner-authority decisions.

## Restaurant service boundary

A restaurant check is a sale draft with a normalized operational graph, not a
second order or pricing authority. One physical table owns at most one open
service; that visit may expose multiple independent checks plus service-scoped
diners and check-scoped courses, submitted rounds, lines, and frozen structured
modifiers. `sales` and `sale_items` continue to own money, tax, stock, payment,
cash-session, receipt, return, and fiscal behavior.

`restaurantServices.openCheck` writes the sale and complete restaurant graph in
the same `BEGIN IMMEDIATE` transaction as stock, audit, sync intent, canonical
replay state, and idempotency completion. Capacity is a ceiling, the first
check establishes guest count, and later checks must match it. Completion or
discard closes the associated check; the service closes only after its final
open check. Table movement and check split preserve sale/check coherence and
serialize their authorization reads with their writes. A whole, unshared
service can move to an empty active table while retaining its diners. A
normalized split stays at its current table; the system rejects implicit party
splitting or merging rather than copying a service-level guest count onto two
visits. The split transaction also repartitions header discount, tip and
service charge, rebuilds provisional tenders, and rejects indivisible loyalty
or store-credit state. A normalized check cannot detach into a free-text label.
Settlement verifies that every frozen sale item has exactly one operational
check line before the financial transition can commit.

The table-state read batches each graph layer under tenant/site scope and
returns every open check. Voice Ordering and the traditional POS require that
authoritative state before opening another check and fail closed while it is
unavailable. Table-catalog search is a literal server-side filter applied
before stable pagination; the administrative floor map reads the separate,
bounded complete active catalog. Creation or reactivation beyond 500 active
tables per site is rejected rather than truncating an operational view. Legacy
create-then-suspend clients and migration `0058` normalize
only facts that can be proven from table-backed rows still in draft state,
including a draft currently resumed by an operator; they do not invent diners,
courses, rounds, or completed history. Migration `0059` allows an
honest cash-session-less historical draft to be cancelled without weakening
the session requirement for completed or voided sales. The suspended-sales
panel pages through the complete recoverable result set and scopes it by both
cash-session and physical-table site. An explicit site lets a cashier take over
an open normalized check there; generic retail drafts remain owner-only. Draft
transitions derive inventory provenance only from durable session, table, and
service anchors, and a stock-managed draft with no verifiable site fails closed
instead of crediting the operator's currently selected site.

Fresh retail drafts and resumed restaurant checks record the authenticated
actor and registered terminal in nullable `sales.resumed_by` and
`sales.resumed_device_id`. Suspend, complete, and discard enforce the actor
claim unless a manager or administrator uses the audited override. A graceful
logout invalidates all actor sessions and parks every actor claim; a staff
switch affects only the current terminal and parks only that device's claims.
Draft update, audit, sync intent, and authentication mutation share one
`BEGIN IMMEDIATE` transaction. Each device also records its active user and a
monotonic identity generation. Critical sale transactions revalidate that
generation and the JWT session version as their final in-transaction write, so
a concurrent switch or logout either parks a command that committed first or
forces a stale command to roll back. No client-supplied draft-id list crosses
the renderer or Store Hub boundary. Ordinary renderer restarts retain the
owner-keyed workspace. If local storage disappears or authentication expires,
the actor's active server claim remains visible as an explicit recovery item
and can be rebound to the registered terminal. Failed remote logout preserves
that local workspace and the Store Hub sealed credential. Recovery is never a
global process-start sweep that could interrupt another terminal.

Recovering a server draft always fetches its current snapshot, even when this
terminal already owns the claim. The server makes an unchanged claim a semantic
no-op for audit and sync effects. The renderer preserves the workspace ID but
replaces its frozen lines, customer and price tier, clearing stale selection
and undo history. Ownership alone never proves freshness after another
terminal splits or reassigns a restaurant check.

Ordinary device registration is idempotent only while the registered terminal
still belongs to the same active actor. A stale but otherwise valid token
cannot reclaim a terminal after a staff switch. Deliberate identity handoff
uses the switch transaction, which parks the prior device claims before it
advances the device generation. Logout and password rotation clear every
active device binding for the revoked actor and advance each generation; the
next login must explicitly register the terminal again.

Module deactivation and preset application refuse to hide any open restaurant
service or table-linked draft while holding the same immediate writer used for
the settings update. Legacy sales routes also reject every new physical-table
assignment inside their sale transaction while `dine-in` is disabled. Mobile
Waiter requires both its surface module and
`dine-in`; Voice Ordering similarly requires POS Touch plus `dine-in`. After a
resume commit, the renderer compensates failed local hydration by restoring the
original suspension; if restoration also fails, it explicitly warns against
recreating the sale.

KDS submission now joins the sale writer: frozen preparation, dispatch decisions,
ordered events and the durable invalidation outbox commit together. Configurable
site stations and product/category routing apply only to future submissions.
Splits, moves and voids update operational state without rewriting or duplicating
food already sent. Observed-version CAS protects kitchen transitions; recall and
resend retain ticket identity. [ADR-0021](./architecture/0021-durable-kitchen-preparation.md)
defines the bounded read, legacy adoption and at-least-once notification contracts.
The current restaurant UI still lacks a manager-authored modifier catalog:
free-form positive modifier prices are bounded and frozen, but not yet
policy-authorized per catalog entry.

## Reservation and external fulfillment boundary

Reservations and delivery logistics are operational aggregates, not alternate
sale systems. Arrival holds a table without creating a sale; seating binds an
explicit reservation version inside the first real check transaction. Delivery
uses a strict versioned lifecycle and never silently charges or refunds a sale.
[ADR-0022](./architecture/0022-reservation-fulfillment-boundary.md) defines these boundaries.

The signed external inbox authenticates source intent and durably deduplicates
events/nonces. An explicit local-price review then accepts the request through
the original parked-sale kernel. Source cancellation requests block checkout and
fulfillment but require an operator's ordinary discard/return path to reverse
commercial effects. Credential management and inbox projections are tenant/site-
scoped; the graphs remain local-only. [ADR-0023](./architecture/0023-signed-external-order-inbox.md)
defines the signature, sealed-key, replay and commercial authority contracts.

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
The global sales omnibox applies the active workspace tier through the same cart
pipeline even when the Sales page is not mounted. A GS1 package price is marked
as an explicit frozen override, so a coincidental match with a catalog tier
cannot silently reprice it.

Every completed sale item freezes the three catalog prices that were available
for its selected unit. Drafts also freeze the selected header tier; suspend and
resume preserve it, and completion rejects a stale client tier rather than
silently reclassifying prices. Override evaluation uses that frozen tier and
grid, so changing a draft's customer cannot erase a real override or manufacture
one from later catalog edits. Migration `0049` backfills open legacy drafts from
their tenant-owned attached customer while leaving settled history at the
conservative retail default. Quotations store the explicitly selected tier as
document metadata alongside their frozen line prices.

## Promotions and customer-value tenders

Promotions are server-owned pricing rules, not renderer calculations. A modern
checkout requests an authoritative quote and sends its fingerprint and total
back with the sale command. Completion re-resolves the same tenant, site,
customer, catalog, quantity, time-window, and lot facts inside the write
boundary; any drift rejects the checkout instead of silently changing its
price. Legacy clients that never request a quote keep their previous
unpromoted total, and accepted quotations preserve their already frozen terms.

Manual discounts remain the loss-prevention input. Active promotions apply to
the remaining line value in deterministic priority/specificity order, and each
applied rule is frozen separately from the effective compatibility discount.
Expiry suggestions have no pricing effect until a manager explicitly converts
one; the resulting rule applies only when FEFO can satisfy the whole line from
its still-sellable source lot. Pharmacy profiles reject that conversion.

Loyalty and store credit are first-class internal payment methods. The server
prices whole loyalty points from enabled tenant settings, reads balances under
tenant scope, and writes the sale payment, source-linked ledger movement,
materialized balance, sync intent, and command completion in one immediate
transaction. Returns restore the exact consumed source and remove earned points
proportionally; voids do the same exactly once. A legitimate return may expose
already-spent loyalty debt, but a later redemption or negative adjustment
cannot deepen it. Accounting exports and day close classify both tenders as
customer liabilities rather than external cash.
[ADR-0016](./architecture/0016-server-authoritative-promotions-and-customer-value.md)
owns the complete boundary.

## Quotation conversion and supplier-payable boundary

An accepted quotation becomes a sale only through `sales.create`. The renderer
may hydrate a dedicated POS workspace, but it cannot alter the quoted customer,
site, price tier, quantities, unit snapshots, prices, discounts, currency, or
tax components. Required serial identities remain a fulfillment input. The
server re-reads and verifies every frozen term inside the same
`BEGIN IMMEDIATE` transaction that completes the sale, then advances the quote
to `converted` and inserts the unique immutable `quotation_sale_links` row.
Manual conversion without a sale is not a supported transition. Historical
lines whose base unit could not be proven during migration remain readable but
fail closed at conversion.

The renderer mirrors that boundary in the cart store rather than relying only
on disabled controls: generic updates, undo, repricing, scanners, quick-create,
and the global sales omnibox cannot mutate resumed or quotation-backed
workspaces. Accepted quotations expose one narrow mutation for physical serial
selection. A quick-created customer attachment is scoped to the exact editable
workspace that requested it, so switching tickets cannot attach it to another
sale.

Purchasing inventory and supplier debt are separate facts. A completed
purchase may be linked to one explicit supplier invoice, but no migration or
read path infers payable debt from purchase history. Charges live in
`provider_payable_invoices`; historical amounts use the explicit
`opening_balance` kind. Payments and credits are immutable sources that must be
allocated in full to open invoices in their creation transaction. The account
equation is therefore charges minus allocated payments and credits, with aging
derived from each frozen due date rather than mutable supplier terms.

Every payable write uses the command envelope and commits its row, allocations,
audit event, sync outbox effects, and canonical replay result atomically.
Managers and administrators may operate this ledger; supplier create, edit,
delete, and category management remain administrator capabilities on a separate
route. [ADR-0013](./architecture/0013-quotation-conversion-and-supplier-payables.md)
owns the durable rationale and migration boundary.

## Normalized return and exchange boundary

A completed sale is immutable. Each partial or full return is a new aggregate
whose header, selected lines, tax components, original-tender allocations,
lot provenance, and serialized identities freeze the evidence used for that
operation. The planner subtracts all earlier normalized returns before offering
remaining quantities, then derives proportional money only from the original
sale snapshots through `roundMoney`. It never re-reads current catalog prices
or tax configuration to rewrite history. Legacy full-ticket return rows remain
readable, but no detailed child evidence is invented for them.

The aggregate must reconcile exactly to its frozen payment destinations. Cash
changes the currently open drawer only at the original sale site; a credit-sale
portion reduces the same customer balance; external tenders require an operator
reference. Store-credit issuance requires the original sale customer and posts
one immutable movement to the tenant/customer/currency account with a
compare-and-swap balance update. Store credit is not yet a checkout tender.

Stock restoration is equally evidence driven. A return restores only the exact
lot quantities and serial identities frozen on the selected sale lines. A
catalog tracking-mode change fails closed. Returning quantity never makes an
expired, quarantined, or otherwise non-vendable lot sellable; only a
still-valid depleted lot may become active again.

An exchange is a unique audited link from one normalized return to an
independently completed replacement sale. The replacement uses the normal sale
rules and, when the original sale has a customer, must retain that customer.
Return domain rows, inventory/customer effects, audit, the version-2 sync
aggregate, independent mutable-resource outboxes, and command completion commit
atomically. Fiscal emission, realtime notification, and journal presentation
run after commit and still need an explicit repair queue before they can be
claimed as self-healing. The sync payload is durable local intent, not evidence
of complete causal convergence between devices.

[ADR-0014](./architecture/0014-normalized-sale-returns-and-store-credit.md)
owns this boundary and its compatibility rules.

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
For completed sales, that document transaction is driven by a durable
`fiscal_emission_intents` row created with the sale. The worker claims intents
with compare-and-swap, recovers stale claims after a process exit, and creates
the document, component snapshots, consecutive advance, and provider outbox in
one transaction. Product labels prefer the immutable sale-item name and SKU
snapshots; live catalog labels are consulted only for historical rows that lack
them. Migration `0063` is additive and intentionally does not invent intents
for historical completed sales.

Voids and normalized partial returns also insert credit-note intents in their
business transaction. Materialization references the original immutable fiscal
buyer, currency and provider contract, not a live customer or a country inferred
from presentation locale. Certified/unknown providers require accepted original
evidence; registered mock/draft providers may reference their already-generated
local draft without claiming authority acceptance. Waiting for that original
evidence is a bounded polling dependency, not an exhausted transient retry.
Operations exposes paginated metadata-only inspection and audited admin recheck;
recheck preserves the frozen payload and never adopts replacement configuration.

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
Hardware and butchery profiles reuse those module gates, while their catalog
templates remain explicit and form-only; profile selection itself is never a
catalog migration.

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
- product search vector storage and model selection;
- audit-chain external freshness;
- quotation conversion and supplier payables;
- vertical profiles, operational quantity precision, and site-authoritative
  GS1 decoding;
- exact lot procurement and inventory transformations;
- pharmacy policy, sealed evidence, professional authorization, recall, and
  regulated lot custody;
- normalized restaurant services, checks, diners, rounds, modifiers, and their
  sale-backed lifecycle.

## Related references

- [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
- [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md)
- [DESKTOP_RUNTIME_GUIDE.md](./DESKTOP_RUNTIME_GUIDE.md)
- [SECURITY.md](./SECURITY.md)
- [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)
- [HARDWARE-POS.md](./HARDWARE-POS.md)
- [TESTING.md](./TESTING.md)
