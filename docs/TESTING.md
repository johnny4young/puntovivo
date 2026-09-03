# Testing and Release Validation

This document describes the current validation contract. It is an operational
reference, not a future-work tracker.

## Required workspace gates

Run commands from the repository root.

| Changed area                                        | Required command                                |
| --------------------------------------------------- | ----------------------------------------------- |
| Shared contracts                                    | `pnpm run ci:shared`                            |
| React or browser application                        | `pnpm run ci:web`                               |
| Fastify, tRPC, database, or server services         | `pnpm run ci:server`                            |
| Electron main process or preload bridge             | `pnpm run ci:desktop`                           |
| Bounded critical browser contract                   | `pnpm run test:e2e:web:critical`                |
| Login, sales, inventory, import, or browser E2E     | `pnpm run test:e2e:web`                         |
| Long-shift renderer lifecycle or leak-sensitive UI  | `pnpm run test:e2e:web:soak`                    |
| Electron bootstrap, IPC, backup, or updater E2E     | `pnpm run test:e2e:electron`                    |
| Release automation                                  | `pnpm run ci:release`                           |
| Encrypted upgrade, downgrade, and restore rehearsal | `pnpm run rehearse:upgrade-recovery`            |
| One packaged desktop recovery rehearsal             | `pnpm run rehearse:packaged-recovery -- <args>` |

The workspace CI commands include type checking, linting, tests, dependency
audit, and the build or runtime measurements appropriate to that workspace.

## Integrated local qualification — 2026-09-01

The current hardening candidate passed the mandatory local qualification
matrix on macOS arm64 with Node 24.19.0, pnpm 11.7.0, Electron 43.4.1, and the
shared `better-sqlite3-multiple-ciphers` 13.0.3 Node-API prebuild. The optional
1 GiB backup-profile exception is recorded separately below:

- `ci:server`: 3,103 tests plus the 50,000-product search profile and bounded
  100,000-row audit verification/redaction profile;
- `ci:web`: 2,832 tests, production build, memory/bundle contracts, and
  nonce-owned Lighthouse runs for authenticated boot, dashboard, sales, and
  products;
- `ci:desktop`: 305 tests plus 62 policy/runtime tests, the 256 MiB
  streaming-backup profile, packaging and memory policies, and a real Electron
  launch/memory measurement;
- `test:e2e:web`: 119 browser journeys under four workers without retries,
  including the full retail-day, exact-lot transformation, and bilingual
  in-transit inventory-identity rejection round trips;
  `test:e2e:electron`: 13 real Electron journeys, including the same operation
  against the embedded Fastify server and isolated SQLCipher database;
- `ci:release`: 112 release-contract tests plus the encrypted upgrade/recovery
  rehearsal; and
- the repository audit, raw `pnpm audit --audit-level low` over 1,187 installed
  dependencies, setup check, and explicit Node/Electron native-runtime
  verifiers passed with no known package vulnerabilities.

The opt-in `perf:backup:release` profile did **not** reproduce its earlier
1 GiB RSS-growth result on this qualification run. Three candidate samples
grew by 106.84–112.44 MiB against the exact 96 MiB ceiling, although their
215–220.14 MiB absolute peaks remained below the independent 256 MiB ceiling.
The exact parent `dafb93c5` failed equivalently at +110.77 MiB/217.66 MiB on
the same host and dependency graph, while the final mandatory 256 MiB CI
profile passed at +33.44 MiB/139.88 MiB. This is therefore not evidence of a
PR8 backup regression, but it is an unresolved allocator/runtime calibration
or memory debt. The budget was not raised and this document does not claim
that the optional release profile is green.

This is local candidate evidence, not representative-machine Gate 5 evidence.
It does not prove signed clean installation, production-updater upgrade from
v1.10.0, or downgrade refusal on Sequoia, Tahoe, Windows, and Linux, and it does
not authorize moving the v1.11.0 rollout above 10 percent. Exact timings are
host-sensitive and remain in the command logs or ignored `.artifacts/` reports;
the committed performance budgets, rather than this machine's measurements,
remain the normative thresholds.

## Vertical profile and variable-measure contracts

Hardware and butchery reuse the retail transaction kernel but add explicit,
bounded configuration evidence:

- shared tests pin the six profile IDs, the five form-only product templates,
  unit-resolution failure without catalog mutation, the historical GS1 mapping,
  configurable/ignored prefixes, and the `0.001` operational UI floor;
- module-preset router tests apply hardware and then butchery with fresh command
  envelopes and compare every tenant category, product, and unit before and
  after, while preserving AI and integration settings outside the patch;
- scanner/parser/router tests cover default rows, typed prefix maps,
  overlapping/empty/out-of-range rejection, `gs1Scheme: none`, corrupt legacy
  rows, checksum policy, and different meanings for the same code at two sites
  without tenant leakage; scale kilograms require an explicit mass base unit,
  convert through its gram reference factor, and are rechecked against the
  product's whole/fraction/minimum/step policy before cart entry. Variable-
  measure codes cannot resolve a packaging barcode, and price-only labels fail
  closed for fractional products that require a weight payload. Missing active
  site disables embedded decoding rather than applying a tenant-global guess;
- sale, purchase, order, fraction-policy, alternate-unit, and cart regressions
  retain an exact thousandth rather than rounding it to a centesimal quantity;
  multiple weight labels accumulate, differently priced whole packages keep
  exact independent cart keys, and duplicate product/unit lines survive a real
  create→suspend→resume server round-trip. Money still rounds through the
  separate two-decimal contract;
- product-modal and peripheral-form tests require an explicit template click,
  active physical-unit resolution, positive mass conversion, Tier 2/Tier 3
  fallback, immediate confirmed-profile coherence, typed 20–29 role controls,
  and prevention of an empty prefix map. Omnibox regressions also prove that an
  existing customer tier is applied when Sales is not mounted while GS1 price
  overrides remain frozen. Checkout integration rejects an off-catalog price
  from a cashier without `sale_price_override`, rejects a grant after the exact
  price changes, consumes it once, emits the immutable override audit and
  repeats the same boundary for a frozen draft surfaced after resume. The
  server-owned preflight covers exact catalog prices, remote catalog drift,
  frozen drafts, and a foreign-tenant product probe; a component regression
  proves that its action remains visible even when local catalog metadata says
  the line is unchanged. A live isolated-browser smoke adds the line first,
  changes the persisted catalog afterward, and observes the server-required
  override action in the open cashier drawer with no client errors;

The isolated running-target qualification on 2026-09-01 applied both profiles
through the authenticated UI, confirmed profile-specific templates, created and
reloaded MT and KG products at `0.001`, persisted the active-site scanner map,
and sent a real keyboard-wedge burst whose server lookup added `0.199 kg` to the
cart. The long administrative sequence reached the development rate limit
before its final lookup, so the final scan was repeated after cooldown as a
bounded continuation with zero browser client errors. Screenshots were retained
with the local task evidence. Physical scanner/scale certification, country-
specific label conformance, legal metrology, and production-line certification
remain outside that profile smoke. The profile smoke predates the separate
transactional transformation engine; its focused software evidence is described
below and does not turn a catalog template into an execution.

## Procurement command and movement-site contracts

The procurement boundary has focused regressions beyond ordinary router CRUD:

- fixed-envelope replays of purchase and order creation return the persisted
  canonical result and create exactly one aggregate/audit/header outbox effect;
  order-line outbox effects are present once per persisted line rather than
  duplicated by replay;
- a forced failure on the idempotency-success write rolls back purchasing,
  numbering, stock, movement, audit, and outbox rows together;
- a second SQLite connection holds `BEGIN IMMEDIATE` to prove
  `COMMAND_DATABASE_BUSY` is safe to present, leaves no partial reservation or
  domain write, and allows the exact same envelope to succeed once after the
  lock is released;
- an abandoned processing row stays owned before the 60-second lease boundary,
  can be reclaimed at the boundary, rejects completion by its stale owner, and
  cannot erase an owner that committed after the takeover reader's snapshot;
- renderer regressions prove concurrent clicks, automatic retries, and later
  user retries after transport-uncertain/busy outcomes reuse one envelope,
  while an explicit terminal server rejection closes that identity;
- migration `0050` upgrades a `0049` database, backfills only movements whose
  sale/cash-session, purchase, purchase-return, or initial-inventory site is
  authoritative, keeps ambiguous history nullable, and passes foreign-key and
  index checks; and
- inventory queries prove tenant-safe site filtering and the web regression
  proves operators can switch from the active-site view to all sites plus
  unattributed historical evidence.

## Exact lot procurement and transformation contracts

The lot-procurement matrix exercises direct purchase, order receipt, supplier
return, purchase void, immediate transfer, deferred transfer, discrepant
receipt, and transfer void using concrete batches rather than aggregate balance
shortcuts. It proves full-allocation requirements, purchase-provenance caps,
tenant/site isolation, expiry and quarantine preservation, frozen weighted
cost, supplier-return and purchase-void cost-drift rollback, exact
destination-layer reversal, replay, rollback, and movement/audit/sync
consistency. Replenishment tests also prove a lot-tracked shortage may create a
quantity-only draft while its later receipt still fails closed without physical
identity. Aggregate blind counts continue to reject lot and serial products.
Deferred-custody regressions dispatch the entire ordinary balance, then prove
stock, lot, and serial tracking cannot change merely because both sites now
read zero. Directly corrupted service metadata fails closed on transfer create,
receipt, and void without changing balances or lifecycle state; restoring the
ordinary inventory mode permits the same operation to complete exactly once.
Purchase-read regressions additionally drain ordinary stock, move a purchased
lot away, change one sourced serial to a foreign product, and return another
serial to prove `remainingQuantity` can remain positive while
`returnableQuantity` follows current physical evidence. Exact-lot
options are separately pinned to zero after tracking drift, transfer, void,
identity change, or blended-cost receipt, so a child allocation control cannot
contradict either its frozen provenance or fail-closed line budget.

The transformation matrix covers global and site-owned recipe lifecycle,
optimistic conflicts, stock-only product eligibility, exact recipe-line
matching, ordinary and multi-lot inputs, new output lots, primary/by-product/
remnant roles, multi-lot waste, last-cent cost allocation, fractional quantity,
insufficient and non-vendable stock, tenant isolation, concurrent replay,
transaction rollback, and guarded void before and after output consumption or
cost drift. A divergent-cost regression proves ordinary inputs are valued from
`initialCost`, each output updates `cost` and `initialCost` independently, the
inventory KPI/list uses the resulting basis, and an untouched void restores
both exactly. The web regressions create and edit recipes beyond the first
catalog page, preserve global scope, execute exact lots, display frozen detail,
surface read errors without contradictory empty states, hide internal
purchase-detail transport diagnostics, and build lot-aware purchase/transfer
payloads. Purchase detail and return-modal regressions label the physical
quantity explicitly and disable an exhausted lot instead of offering the
unreturned receipt quantity as stock. The detail-modal regression also pins a
zero freshness window so a close, inventory mutation, and reopen cannot reuse a
five-minute-old returnability snapshot; cached debit controls stay fail-closed
during the refresh.

The live browser journey creates two lot-tracked products, receives a concrete
supplier lot, and first opens the purchase while all four units are returnable.
It then keeps that query cached in the same SPA, executes a 4-to-3 recipe, checks
the frozen rows and balances directly in SQLite, asserts the output's persisted
dual cost and COP 10,000 valuation contribution, and reconciles the visible
tenant-wide KPI with the database. Before the five-minute global cache window
can expire, the journey switches through the live language control to Spanish
and reopens the same purchase by number. It requires a fresh read showing zero
returnable units, the preserved received quantity and expiry, the current lot
status, and no supplier-return action. It then reloads the UI and reopens the
transformation evidence. The Electron journey repeats the operator path through the
embedded server, signs out and back in, and proves both the lot/cost snapshot
and visible valuation remain available from the encrypted desktop database.
Both journeys fail on browser console, page, transport, or Electron process
errors.

Canonical focused evidence is
`packages/server/src/__tests__/lot-procurement-transfers.test.ts`,
`packages/server/src/__tests__/inventory-transformations.test.ts`, the existing
purchase/order/count suites, and the corresponding purchase, order, transfer,
lot-editor, and transformation component tests, plus
`e2e/web/inventory-transformations.spec.ts` and
`e2e/electron/inventory-transformation.spec.ts`. Migration `0056` is covered
by new-database, historical-upgrade, foreign-key, index, journal-parity, and
legacy-adoption gates. The deliberately narrow purchase-only adoption shape
pins `0056` only when every lot, return, transfer, and transformation target is
absent; a mixed or partially materialized database keeps the migration pending
and fails closed rather than claiming an incomplete schema.
[ADR-0018](./architecture/0018-lot-procurement-and-transformations.md) owns the
durable boundary and its honest external limitations.

## Quotation conversion and supplier-payable contracts

Quotation conversion tests exercise the real sale transaction rather than a
status-only shortcut. Server regressions pin accepted and unexpired state, ISO
instant comparison, tenant/site/customer/tier/currency and exact-line parity,
unit-snapshot migration, rollback on drift, and one winner under concurrent
conversion. The browser journey accepts a quote, opens its term-locked POS,
charges it once, proves inventory was debited once, reloads, and reads the
authoritative linked sale.

Supplier-payable tests pin explicit opening balances, completed-purchase links,
two-decimal money, tenant-calendar dates and ordering, full allocations, the equation
`invoices - payments - credits = outstanding`, aging, statement ordering,
cash-payment drawer reconciliation, supported sync draining, Command Envelope
replay and rollback, role guards, and tenant isolation. The
live manager journey registers an invoice and opening amount, allocates a credit
and payment oldest-first, reaches zero, reloads the account, and reconciles the
SQLite totals. It never receives supplier CRUD controls.

`scripts/e2e-baseline-cleanup.test.mjs` protects repeatability of those journeys:
restrictive AP and quotation-sale children plus their AP sync rows are removed
before disposable E2E parents, while template users, operator data, and other
tenants remain intact. Each isolated E2E tenant also starts without queued sync
work or unresolved conflicts: otherwise an old outbox row whose disposable
entity was deleted would be auto-pushed into a false conflict during the next
journey. Promotion rules, restrictive sale-line snapshots, audit rows, and
logical expiry-suggestion links are pruned before their disposable product,
customer, or actor. The reset is tenant-scoped, idempotent, and covered against
cross-tenant deletion. This fixture cleanup is not a production deletion path.

## Live UI requirement

Every user-facing change also requires a running-target smoke. The smoke must:

1. navigate to the affected surface;
2. assert the user-visible result or persisted round trip;
3. check browser console and uncaught page errors;
4. capture a screenshot when visual behavior changed;
5. exercise Electron as well when the change crosses the preload or main
   process boundary.

Component tests alone do not prove route mounting, bundled localization,
client-cache invalidation, or backend round trips.

## Current end-to-end boundaries

The browser suite covers the critical retail money path and administrative
journeys, including authentication, role gating, sales, normalized returns,
voids,
purchases, inventory transfers, cash sessions, imports, approvals, loss
prevention, staff attendance, variants, serials, and day-close sign-off.

The normalized-return server matrix separately proves successive partial
quantities, last-cent tax and tender reconciliation, exact lot/serial recovery,
credit-balance reduction, store-credit issuance, exchange linkage, concurrent
last-unit protection, idempotent replay, tenant/site isolation, and migration
compatibility. The browser and Electron refund journeys select the remaining
lines through the real return composer and then verify restored stock and
immutable actor/reason audit evidence after re-authentication. A separate live
browser regression creates a card sale, converts its payment rows into the
supported legacy shape, records the required provider reference through the
composer, verifies the normalized external allocation in SQLite, and reloads
the refunded ticket. Provider-side card refund execution is not implied by
those tests.

The promotions and customer-value matrix exercises versioned draft, active,
paused, and archived rules; tenant/role isolation; product, category, site,
customer, quantity, and UTC-window targeting; exclusive and combinable
precedence; manual-first pricing; stale fingerprints; legacy clients;
manager-approved FEFO expiry conversion; and pharmacy fail-closed behavior.
Separate server journeys pin whole-point pricing, insufficient and concurrent
last-balance rejection, mixed loyalty/store-credit tenders, draft completion,
successive returns, void-once restoration, and ledger/materialized-balance
parity. The live browser journey configures the feature, activates a targeted
promotion, charges points + store credit + card, checks frozen SQLite evidence,
reloads EN/ES history, returns the ticket with external provider evidence, and
reconciles both customer-value ledgers back to their opening balances.

The pharmacy integration matrix exercises Colombia and unsupported-country
policy, OTC/prescription/controlled classification, effective employee
authorization, encrypted-evidence authentication, duplicate and expired
references, deterministic partial consumption, bounded fragmented-evidence
selection aligned with the 200-id sale contract, concurrent reuse rejection,
tenant/site isolation, lot FEFO, expiry, quarantine, cold-chain incidents,
recalls across purchase and transfer provenance, exact returns, destruction,
supplier return, business-date changes, migration adoption, and 50,000-product
search. Component coverage pins profile lock reasons, checkout subject changes,
external evidence approval refresh, and manager/admin PII boundaries. Live web
and Electron smokes prove representative UI to tRPC to SQLite/SQLCipher round
trips and reload persistence; they do not replace legal review, physical
hardware, registry providers, or a production pharmacy pilot.

`operator-journeys.json` is the executable index for eleven shift-defining
journeys: first sale, suspended cart, split tender, manager approval, refund,
blind cash close, signed day close, purchase receiving, inter-site transfer,
secure operator switching, and one full retail day. Each entry owns an exact Playwright file/title
and declares its role, language, viewport, interaction, and continuity
coverage. `scripts/check-operator-journeys.mjs`, invoked by `ci:web`, fails when
an indexed test disappears, its title drifts without updating the contract, a
required journey is removed, or the matrix loses a required operating variant.
The contract indexes real flows; it does not replace their browser execution.

The retail-day journey is the cross-module reconciliation proof. Through the
live browser it performs a blind count and approval, creates/submits/receives a
replenishment draft, opens attendance and cash, suspends a two-unit cart across
reload, charges it, returns one unit after a manager handoff, records and settles
the supplier invoice, transfers one unit to another site, closes the cashier and
day, reloads again, and verifies the final per-site and aggregate SQLite-backed
stock. Separate live packs keep the same retail core qualified for food-style lot
tracking, serialized purchase/sale/return/transfer provenance, and Size x Color
variant-child sales. Those packs do not claim lot-aware physical counting,
automatic ordering, or external supplier reconciliation.

Schema v3 also selects live aggregate UX evidence for product creation, first
sale, signed close, stock receiving, and operational recovery. The referenced
Playwright journeys must assert the current route, a concrete first usable
control, and the browser-emitted `observability.reportTaskMeasurement` payload,
including expected backtracks and validation/recovery errors. The E2E helper
observes the real tRPC request rather than relying on the persistence query, so
the proof still runs when a tenant has opted out of storing aggregate metrics.
These deterministic signals catch broken route mounting, inaccessible first
actions, lost validation feedback and recovery loops; they do not claim a
moderated usability study or real Windows NVDA coverage.

The same contract selects one executable journey for each shift-critical area
under `criticalE2E`: first sale for selling, exact manager approval for control,
immutable signed day close for closing, and discrepant inter-site transfer for
stock. Those four tests carry the `@critical` Playwright tag and run serially
through `pnpm run test:e2e:web:critical`. The contract checker keeps the subset
at four or fewer, rejects missing area coverage or tag drift, and prevents a
fifth tagged journey from silently expanding the CI budget. Push and pull-
request web CI runs this bounded subset after `ci:web`; the complete browser
suite remains the local requirement for any affected login, sales, inventory,
import, or browser flow.

The opt-in `test:e2e:web:soak` contract keeps one authenticated renderer alive
instead of reloading between journeys. After five warmup cycles it exercises
product creation/details, sales history, route transitions, and their query
lifecycles for 30 measured cycles. Each checkpoint forces Chromium GC and
records used JS heap plus live document, DOM-node, and event-listener counts;
only final-minus-baseline retained growth is gated, because a transient peak is
not a leak. The same running-target proof closes the purchase OCR dialog while
upload persistence is deliberately held in flight and asserts that its exact
Blob preview URL is revoked before the late response completes. The normal 117-
test browser suite excludes `@long-shift-soak`; `ci:web` still runs the pure
growth comparator and the command/budget contract.

The operational recovery contract is defined in
`packages/shared/src/operational-readiness.ts`. It covers synchronization,
fiscal delivery, receipt hardware, electronic payments, encrypted backup, and
desktop updates. `scripts/check-operational-readiness.mjs`, invoked by the web
CI gate, fails when any service loses its explicit owner, response target,
threshold, runbook anchor, recovery route, or exact executable drill title.
The Operations browser smoke verifies that the same contract is visible in
English and Spanish and that recovery actions reach the owning surface. It
also inserts a real declined payment outbox incident, retries it as an
administrator, verifies the audit event and non-failure status, and confirms
that the invalidated attention count falls in the browser. The same drill proves
that aggregate task measurement records one `recover_operation` success with a
succeeded recovery outcome. This pins the signal → action → mutation → measured
outcome → refreshed queue loop rather than navigation alone.

The Electron suite launches the real desktop runtime and validates the
renderer sandbox, embedded server, authenticated application boot, encrypted
backup creation, cloud-vault write, scheduling, and restore readiness. Ten
target-agnostic operator journeys run against either the development bundle or
a packaged desktop application: first sale, suspended cart, split tender,
manager approval, blind cash close, signed day close, refund, and purchase
receiving, inter-site inventory transfer, and secure staff handoff. The manager
approval journey keeps the exact cashier checkout mounted while a different
eligible manager presents a fresh PIN, then proves one-use grant consumption
and correlated immutable request, approval, and consumption audit evidence. The
signed-close journey verifies the stored PDF response and proves that the
signer and evidence hash remain immutable after a renderer reload and fresh
authentication. The refund journey proves the normalized return composer,
direct manager authority, visible inventory restoration, and immutable
actor-and-reason audit evidence after re-authentication. The
purchase-receiving journey proves the completed receipt
details, exact aggregate and site stock effects, and immutable actor-attributed
receipt evidence after a fresh authentication. The transfer journey proves an
exact source debit, in-transit custody, a discrepant destination receipt, the
resulting aggregate and per-site stock, and immutable actor-attributed
create/receive evidence after a fresh authentication. The staff-handoff journey
proves that an administrator can enroll a cashier PIN and yield the same
terminal without leaking privileged route access, while the selected cashier
survives renderer reload and the actor/target audit row remains available after
fresh authentication.
Node-side Electron tests additionally pin Store Hub URL policy, OS-keychain
sealing, owner-only credential-envelope permissions, refresh rotation after an
app restart, rejected-session cleanup, exact-token IPC registration, and the
fixed-destination API proxy's header/path restrictions. They also enumerate all
13 db/sync channels behind an Electron-free session-first core, prove the
device-id setter cannot persist before login, and pin the locale/device-read
pre-login exceptions. The live Electron smoke clears main-process session state
under an authenticated renderer, then requires localized re-entry UI with no
raw invoke error or expected-error main-process diagnostic before returning to
login. Shared, web, server,
and Electron tests also pin incremental SSE framing, Authorization-bearing
fetch, Store Hub refresh-and-retry, bounded reconnect with `Last-Event-ID`,
stream cleanup, and `sessionVersion` revocation. The web E2E suite opens the
real KDS stream, verifies its Bearer header, revokes that session, and observes
the canonical login redirect after server revalidation. Its observer uses an
independent API cookie jar so the second principal cannot inherit the browser
operator's refresh cookie and accidentally cross the intended CSRF boundary.

The Companion journey uses an isolated module-enabled tenant and two
principals: a manager signs the current close while an already-connected viewer
receives a payload-free invalidation and reloads verified metadata. The same
journey pins mobile EN/ES chrome, explicit offline concealment, mandatory
network refresh on reconnect, logout cache clearing, and a mobile screenshot.
Build tests inspect the generated service worker and reject API caching or
missing shell assets.

The launch-import journey also pins service-item semantics end to end: the
preview exposes the stock-tracking column and rejects opening stock for a
service, the accepted row persists as a service, inventory and procurement
pickers omit it, and the normal sales search still offers it. Server tests pin
the matching write-side invariant by rejecting a service before either a
purchase or an inventory order header is created.

Price-tier regressions are split across the shared, server, and web suites.
Shared tests own base/alternate-unit fallback; server tests own tenant-safe
customer resolution, frozen three-price sale snapshots, draft completion,
quotation persistence, and legacy migration/backfill; web tests prove that
customer selection does not silently reprice and that an explicit action
updates Sales, POS Touch, and quotation drafts. Any change to these visible
flows still requires the running-target smoke described above, including a
persisted quotation or completed-sale readback.

Quotation checkout tests also attack renderer bypasses: direct Zustand writes,
quick-created products, barcode/global omnibox additions, undo and tier changes
cannot alter locked commercial terms. Serial selection remains the only narrow
quotation mutation, and a quick-created customer is attached only to the
editable workspace that requested it rather than whichever ticket opens the
payment drawer next.

Normalized line-tax regressions pin the one-to-four-component boundary. Server
tests cover tenant-owned active rates, uniqueness and the database position
ceiling, unrelated product updates, Colombia IVA + INC inclusive/exclusive
rounding, sale/quotation/fiscal snapshots, legacy migration backfill,
tenant-scoped privacy export, header parity, receipt expansion, and the honest
unsigned Colombia UBL draft. MX/CL tests require fail-closed rejection for a
combination their serializers cannot preserve. Web tests cover component form
state and IVA/INC browser-receipt output from one line. Visible product changes
still require a running-target smoke that saves and reloads both components,
completes the sale, and verifies separated receipt evidence. These tests do not
claim provider transmission, certification, or authority conformance.

The server and desktop CI gates also consume
`perf-budget.json::operationalProfile`: the server measures a maximum-size
launch-product preview/commit; desktop tests time an encrypted 5,000-row backup
round trip and enforce a bounded recovery queue; the Electron runtime gate
checks boot elapsed time together with main/renderer memory. See
`PERF-BUDGETS.md` for thresholds and the packaged-artifact boundary.

Server CI additionally runs the isolated product-search scale contract after
coverage and the store profile. It grows one tenant to 1,000, 10,000, and
50,000 products with a pharmacy profile on every row, then pins relevance,
tenant isolation, FTS/profile cardinality, indexed query plans, and p95 for
exact SKU and sanitary registration, selective and broad retail/pharmacy FTS,
and compatibility substring searches. It also profiles the bounded 200-id
hybrid semantic candidate pool without contacting an AI provider. Pharmacy
profile-build time has its own 1,000/10,000/50,000-row elapsed budgets, reusing
the existing catalog-build ceilings and unchanged 35% host tolerance instead
of hiding the new write phase inside the absolute timeout. The profile is
intentionally separate from the parallel coverage pool; see `PERF-BUDGETS.md`
for its samples and baselines.

Product-vector selection also has retained, non-network CI evidence. Corpus and
evaluator tests pin 36 representative products, 24 graded neutral LATAM and
cross-language queries, fail-closed vector-map validation, and retrieval metric
math. Codec/storage tests pin the versioned little-endian `PVEC` envelope,
legacy JSON compatibility, corrupt-payload rejection, float32 recall/error, and
the production 200-candidate boundary. The evidence-binding test rejects drift
between the corpus SHA, selected Ollama default, retained reports, and codec
contract. Re-running providers remains an explicit operator benchmark because
CI must not need Ollama or cloud credentials. See `PERF-BUDGETS.md` and
[ADR-0011](./architecture/0011-product-search-vectors.md).

## Hardening evidence map

The current product hardening baseline is represented by durable, executable
contracts rather than by a standalone manual checklist:

| Quality boundary                          | Canonical evidence                                                                                                                                           | Gate                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Operator Deck adoption                    | `scripts/check-operator-deck-adoption.mjs` and its regression tests                                                                                          | `ci:web`                                                                   |
| Shift-defining operator journeys          | `operator-journeys.json`, its four tagged critical flows, eleven indexed browser journeys, and the ten target-agnostic Electron ports                        | `ci:web`, `test:e2e:web:critical`, `test:e2e:web`, and `test:e2e:electron` |
| Accessibility and adaptive layouts        | `e2e/web/a11y.spec.ts`, `assistive-technology.spec.ts`, `navigation-responsive.spec.ts`, and `payment-drawer-responsive.spec.ts`                             | `test:e2e:web`                                                             |
| Dense data behavior                       | `e2e/web/design-system-scale.spec.ts`, including the 1,000-row bounded table contract                                                                        | `test:e2e:web`                                                             |
| Same-renderer retained memory             | `e2e/web/long-shift-soak.spec.ts`, its pure growth comparator, and `perf-budget.json::longShiftSoak`                                                         | `ci:web` contracts plus opt-in `test:e2e:web:soak`                         |
| Migration journal integrity               | `migrations-parity.test.ts`, `migration-tracking.test.ts`, and `scripts/ensure-migrations-bundled.mjs`                                                       | `ci:server` plus `ci:desktop`                                              |
| Query plans and store/search/audit scale  | `perf-store-profile.test.ts`, `perf-product-search-profile.test.ts`, `perf-audit-chain-profile.test.ts`, `perf-trpc-latency.test.ts`, and `perf-budget.json` | `ci:server`                                                                |
| Promotions and customer-value liabilities | `promotions.test.ts`, `customer-value-tenders.test.ts`, and `e2e/web/retail-promotions-loyalty.spec.ts`                                                      | `ci:server`, `ci:web`, and `test:e2e:web`                                  |
| Vertical profiles and site GS1 semantics  | shared profile/template/GS1 tests, module/catalog-safety tests, thousandth sale/procurement tests, barcode authority tests, and live UI evidence             | `ci:shared`, `ci:server`, `ci:web`, and `test:e2e:web`                     |
| Exact lot procurement and transformations | exact lot purchase/return/transfer and transformation server suites, UI payload/detail regressions, migration `0056`, and ADR-0018                           | `ci:server`, `ci:web`, `ci:desktop`, plus live web/Electron smoke          |
| Product vector/model selection            | `product-embedding-evidence.test.ts`, `vector-codec.test.ts`, retained corpus/reports, and ADR-0011                                                          | `ci:server` plus operator benchmarks                                       |
| Desktop continuity and recovery           | `recovery-rehearsal.test.ts`, the encrypted recovery rehearsal, and the Electron runtime memory/launch gate                                                  | `ci:desktop` plus `rehearse:upgrade-recovery`                              |
| Packaged encrypted recovery               | `packaged-recovery-rehearsal.test.ts`, `run-packaged-recovery-rehearsal.mjs`, and candidate evidence validation                                              | `ci:desktop`, `ci:release`, plus the full manual desktop matrix            |
| Recovery ownership and executable actions | `packages/shared/src/operational-readiness.ts`, `scripts/check-operational-readiness.mjs`, and `e2e/web/operational-readiness.spec.ts`                       | `ci:web` plus `test:e2e:web`                                               |
| Authenticated realtime continuity         | shared SSE parser tests, server SSE tests, Electron Store Hub tests, and `e2e/web/realtime-auth.spec.ts`                                                     | workspace CI plus `test:e2e:web`                                           |
| Companion least-privilege PWA             | `companion-snapshot.test.ts`, generated-worker contracts, and `e2e/web/companion.spec.ts`                                                                    | `ci:server`, `ci:web`, and `test:e2e:web`                                  |
| Quote conversion and supplier accounts    | atomic router tests, `e2e/web/quotations.spec.ts`, `e2e/web/provider-payables.spec.ts`, and the child-first baseline cleanup contract                        | `ci:server`, `ci:web`, `ci:shared`, and `test:e2e:web`                     |
| Exact shortcuts and live task regressions | canonical shortcut/role tests, schema-v3 task measurement contracts, and `e2e/web/shortcuts.spec.ts`                                                         | `ci:web` and `test:e2e:web`                                                |
| Full dependency-graph advisories          | `scripts/run-dependency-audit.mjs` plus pnpm's low-severity registry audit                                                                                   | each workspace CI gate; every advisory still fails closed                  |
| Exact dependency-override lifecycle       | `config/exact-overrides-policy.json` and `scripts/check-exact-override-policy.mjs`                                                                           | `ci:shared` rejects missing, stale, duplicate, or expired review metadata  |
| Runtime dependency reachability           | production graphs rooted at web, server, and desktop plus `config/runtime-dependency-reachability.json`                                                      | audit output classifies vulnerable installed versions by artifact path     |

This map proves that the local development and automated validation baseline
remains covered. It does not replace the multiplatform packaging, signing,
provider certification, physical-device, or controlled-pilot evidence required
for release readiness.

Exact registry overrides are reviewed as explicit, temporary exceptions rather
than permanent lockfile decoration. The policy binds both selector and target,
requires an owner, rationale, removal criteria, and category-specific deadline,
and fails closed after 14 days for regression ceilings, 30 days for security or
deprecation floors, and 90 days for compatibility pins. A review removes an
unneeded override or refreshes its evidence and deadline only after
`pnpm run ci:audit` plus the applicable runtime gate pass. Local `file:`
replacements are maintained workspace packages and are not version-pin debt.

Audit scope is derived from paths, never from a package name or its declared
development scope. The audit wrapper obtains pnpm's complete advisory report,
then builds production graphs from the web bundle, standalone server, and
packaged Electron roots. Findings are matched to the vulnerable installed
version before being labelled runtime-reachable, not-runtime-reachable, or
unknown. The Electron contract explicitly pins the shipped
`@puntovivo/desktop → electron-updater → js-yaml` path and rejects Electron
Forge in the desktop production graph. Every low-or-higher advisory fails CI,
including tooling-only findings, and registry, JSON, graph, or version
ambiguity fails closed.

A not-runtime-reachable label is still not permission to ignore an advisory on
its own: it is a conservative manifest-graph result. It is now the
precondition for the one legitimate exception, an expiring disposition
recorded in `config/audit-dispositions.json` and described in
[SECURITY.md](./SECURITY.md). The audit refuses a disposition whose advisory it
classifies as runtime-reachable or unknown, whose package does not match, or
whose review date has passed, and it fails when a disposition outlives the
advisory it covers. The bundle/import and packaged-artifact argument remains a
recorded human claim bounded by the review deadline rather than an automated
proof, because the audit runs before any build exists to inspect.

## Release-candidate additions

Automated gates are necessary but not sufficient for a desktop release. A
release candidate also needs:

- manual package validation on Linux, macOS, and Windows;
- signing and notarization verification where credentials are available;
- clean install and upgrade from the previous production version;
- database migration and downgrade-refusal checks;
- backup and restore rehearsal using production-equivalent data volume;
- printer, drawer, scanner, and terminal checks for every supported device;
- review of known limitations in `PROJECT-STATUS.md` and the release notes.

The manual **Build Desktop** workflow accepts only a complete 40-character
candidate commit SHA. Every selected platform checks out that exact commit. A
full build clears the package output, creates the platform installer, runs the
full packaged-runtime smoke (including native-module structure), runs a
packaged-renderer first-login journey, executes encrypted recovery inside the
packaged Electron binary, and uploads:

- the exact `Puntovivo-<version>-<os>-<arch>` installer;
- its blockmap when electron-builder emits one;
- the matching `latest*.yml` update feed;
- `packaged-recovery-<os>[-<mac-generation>]-<short-sha>.json`;
- `candidate-evidence-<os>[-<mac-generation>]-<short-sha>.json`.

The evidence manifest binds the candidate SHA to the exact package version,
platform, architecture, actual host OS version, stable support target, artifact
names, byte sizes, SHA-256 checksums, and matching update-feed reference. macOS
evidence uses distinct Sequoia and Tahoe filenames so a Tahoe result cannot be
reported as Sequoia compatibility. It also recomputes the installer SHA-512 and
size and requires them to match the values electron-updater will enforce.
Collection fails if the checkout differs from the requested SHA, the expected
installer/feed is missing, the feed points at another version, its integrity
metadata differs from the installer, or the packaged structure, runtime, or
renderer smoke did not pass. It also fails unless the packaged recovery report
belongs to the same SHA, version, platform, and architecture and passes every
recovery check described below. The renderer journey is required on Linux,
macOS, and Windows. It proves the secure custom renderer origin, preload
bridges, embedded API access, first-run authentication, and the data-backed
post-login landing. It uses a random per-run SQLCipher key plus a temporary
Chromium credential store so UI automation does not depend on runner keychain
prompts; the separate runtime smoke keeps exercising the normal OS-key-store
startup path. This exact-name contract prevents stale local output from being
reported as current evidence.

Distribution trust is now measured rather than declared. On macOS the collector
runs the host's own tooling against the packaged bundle — `codesign --verify
--deep --strict`, `xcrun stapler validate` and `spctl --assess` — and records
one of four verdicts plus the per-check evidence:

- `trusted` — signed, notarized, and accepted by Gatekeeper.
- `signed-not-notarized` — a valid signature without a stapled ticket. This is
  what the manual workflow produces, because it ad-hoc signs so the runtime
  smoke can launch the app and never loads release signing credentials.
- `untrusted` — the signature did not verify, or the tooling could not answer.
  A tool that is absent is recorded as unknown and never counted as a pass.
- `unsupported-platform` — Linux and Windows, whose trust models this collector
  does not assess. It is reported as its own state so it cannot be mistaken for
  either a pass or a failure; verify those hosts separately with the Windows
  signature verifier before accepting a candidate.

The verdict is reported, not enforced: an untrusted manual build is the expected
outcome and must not fail evidence collection. Only `trusted` on every required
platform clears the release gate, and reaching it requires the release workflow
with real Developer ID material — ad-hoc signing remains validation-only.

Run `pnpm run rehearse:upgrade-recovery` for the database migration item. It
builds a verified v1.7.0 encrypted fixture with two tenant graphs, upgrades it
through the current migration journal, verifies a second idempotent boot, and
launches the historical build contract in an isolated process to prove that a
downgrade is refused without modifying the database. It then adds
current-schema attendance, approval, privacy, staff, and serialized-inventory
sentinels; creates a production-format encrypted ZIP; extracts it into a
separate installation directory; rekeys the staged database to a fresh
installation key; and boots the restored database through the real server.

The report proves historical and current-domain fingerprints, tenant
separation, device-identity preservation, key separation in both directions,
source-database immutability, bundle size/hash, snapshot time, and elapsed
backup/restore time. The command writes the sanitized report under the ignored
`.artifacts/recovery-rehearsal/` directory; retain it with release-candidate
evidence. The report must never contain either SQLCipher key, credentials,
device identifiers, absolute paths, or raw business rows.

### Packaged encrypted recovery evidence

The full manual **Build Desktop** workflow runs the recovery-only mode of the
actual packaged executable on every selected operating system. It does not run
the source-level Node rehearsal and does not open the operator's database. The
host wrapper creates isolated temporary storage, launches the package with an
explicit recovery authorization flag, validates the resulting report, copies
only that sanitized report into `out-builder`, and removes the temporary
installation.

The immutable `retail-annual-medium-v1` profile represents one active retail
location for a year: 2,500 products, 10,000 customers, 365 closed cash
sessions, 50,000 completed sales, 150,000 sale lines, and 50,000 payment rows.
The package must:

1. create the current schema from its bundled migrations and seed the full
   profile into a SQLCipher database;
2. create and integrity-check the production ZIP backup format;
3. reject an unrelated encryption key without changing the valid snapshot;
4. reject a ZIP whose encrypted database entry was truncated;
5. restore and rekey into a separate installation, then boot that copy through
   the packaged server graph;
6. fingerprint every representative business row before and after restore;
7. prove the original database byte hash is unchanged after the recovery;
8. record the app version, database schema version, platform, architecture,
   recovery time, and snapshot age without paths, keys, credentials, device
   identities, or business rows.

For a package already built on the current host, run:

```bash
pnpm run rehearse:packaged-recovery -- \
  --against-packaged apps/desktop/out-builder \
  --candidate-sha "$(git rev-parse HEAD)" \
  --output .artifacts/packaged-recovery/current-platform.json
```

A local pass proves only that package and host. Cross-platform readiness still
requires one fresh full workflow run for Linux, macOS, and Windows against the
same 40-character SHA. Do not copy a report between platforms or translate a
source-level rehearsal into packaged evidence.

The most recent retained cross-platform proof is manual workflow
[run 31264233582](https://github.com/johnny4young/puntovivo/actions/runs/31264233582)
from 2026-08-08 against the released candidate
`c6aebb8ee27e1f6f73e593cbd0a4ff117fd8a567` (app `1.10.1`, database schema
`35`). Linux x64, macOS arm64, and Windows x64 each passed package creation,
the native/runtime and first-login renderer smokes, and all nine encrypted
recovery checks over the 262,865-row profile. The downloaded manifests were
revalidated against their actual installer, update-feed, and recovery-report
hashes; each rejected a wrong key and corrupt bundle, preserved the source
database, and booted the restored copy. These are validation-only manual
candidate artifacts: they prove runtime and recovery behavior, not release
signing, notarization, certification, or a production recovery-time commitment.
The macOS job ran on Tahoe 26.5.2 arm64. It does not replace a separate
Sequoia run or the representative-machine clean-install, real-updater upgrade,
and downgrade-refusal checks required before rollout promotion.

## Representative-machine Gate 5

Gate 5 is deliberately outside GitHub-hosted CI. Each distributed platform and
support target needs its own manifest; a candidate passes that target only when
one representative machine retains hash-bound evidence for all of these
observations against the same session UUID, platform, architecture, observed OS
version, app version, and complete candidate SHA:

1. install the signed candidate into a fresh, isolated OS profile with no prior
   Puntovivo user data, launch it, and capture the observed version;
2. install the previous supported signed release in another isolated profile,
   create a deterministic canary, receive the candidate through the production
   `electron-updater` path, relaunch, observe the candidate version and update
   history, and export the same canary before and after;
3. attempt the previous supported signed installer and retain its visible
   refusal plus byte-identical closed/checkpointed encrypted database snapshots
   from before and after the attempt. Regressive normal/rollback appcast policy
   is covered by deterministic updater tests; manual emergency-install recovery
   remains a separate operator exercise;
4. run all Electron journeys from a standalone interactive terminal against a
   completely clean checkout of that exact candidate; and
5. have a release-operator role independently review distinct clean-install,
   upgrade, and downgrade captures.

Do not perform any of these steps against an operator's production profile.
Use a disposable OS account or disposable machine image and close Puntovivo
before copying the encrypted database. Retain the raw captures and databases
locally under the ignored `.artifacts/` tree; the sanitized manifest contains
only basenames, byte counts, hashes, bounded host labels, observations, and a
non-personal reviewer-role label.

The external Electron command refuses non-interactive shells and any CI,
Codex, XCTest, dynamic-library injection, or dirty-worktree signal. That is an
evidence boundary, not a workaround for failing tests:

Generate one fresh correlation id with `node -p "crypto.randomUUID()"` and use
that exact UUID in both the external command and the Gate 5 draft:

```bash
pnpm run test:e2e:electron:external -- \
  --candidate-root /absolute/path/to/clean-candidate-worktree \
  --packaged-app /absolute/path/to/the/installed/signed/Puntovivo.app \
  --session-id 018f6f8c-4e5b-7a21-8abc-1234567890ab \
  --output .artifacts/gate5/macos-sequoia/external-electron.json
```

`--candidate-root` lets the current tooling orchestrate a historical release
checkout without modifying it; `--packaged-app` makes Playwright drive the
installed signed candidate through the packaged CDP path rather than launching
the development Electron bundle. On the representative host, place both signed
installers, the three distinct captures, before/after canary exports,
before/after encrypted database snapshots, and `external-electron.json` in one
session directory. Create `draft.json` in that directory with the final report
fields plus an `artifactFiles` object whose ten values are basenames:

```json
{
  "schemaVersion": 1,
  "outcome": "passed",
  "sessionId": "018f6f8c-4e5b-7a21-8abc-1234567890ab",
  "candidateSha": "0123456789abcdef0123456789abcdef01234567",
  "candidateVersion": "1.11.0",
  "previousVersion": "1.10.0",
  "startedAt": "2026-08-28T09:00:00.000Z",
  "completedAt": "2026-08-28T11:00:00.000Z",
  "environment": {
    "platform": "darwin",
    "architecture": "arm64",
    "osVersion": "15.7.1",
    "supportTarget": "macos-15-sequoia-arm64",
    "machineProfile": "retail-register-apple-silicon"
  },
  "probes": {
    "cleanInstall": {
      "freshUserData": true,
      "installedVersion": "1.11.0",
      "firstLaunchSucceeded": true
    },
    "upgrade": {
      "fromVersion": "1.10.0",
      "offeredVersion": "1.11.0",
      "installedVersion": "1.11.0",
      "transport": "production-auto-updater",
      "updateHistoryRecorded": true
    },
    "downgrade": {
      "attemptedVersion": "1.10.0",
      "attemptMethod": "previous-signed-installer",
      "policyMode": "normal",
      "downgradeRefused": true,
      "refusalKind": "installer-refused"
    }
  },
  "artifactFiles": {
    "candidateInstaller": "Puntovivo-1.11.0-mac-arm64.zip",
    "previousInstaller": "Puntovivo-1.10.0-mac-arm64.zip",
    "cleanInstallCapture": "clean-install.png",
    "upgradeCapture": "upgrade.png",
    "upgradeCanaryBefore": "upgrade-canary-before.json",
    "upgradeCanaryAfter": "upgrade-canary-after.json",
    "downgradeCapture": "downgrade-refusal.txt",
    "downgradeDatabaseBefore": "downgrade-before.db",
    "downgradeDatabaseAfter": "downgrade-after.db",
    "externalElectronE2e": "external-electron.json"
  },
  "review": {
    "outcome": "approved",
    "reviewerRole": "release-operator",
    "reviewedAt": "2026-08-28T11:05:00.000Z",
    "notes": "Captures and immutable before/after pairs reviewed on the representative host."
  },
  "failureCode": null
}
```

Collect hashes from actual files, then independently re-read every file and
require a passing reviewed manifest. The validator also parses the external
Electron report and pins it to the same session UUID, SHA, version, exact OS,
platform, architecture, and Gate evidence window:

```bash
pnpm run collect:gate5-evidence -- \
  --input .artifacts/gate5/macos-sequoia/draft.json \
  --output .artifacts/gate5/macos-sequoia/gate5-manifest.json

pnpm run validate:gate5-evidence -- \
  --evidence .artifacts/gate5/macos-sequoia/gate5-manifest.json \
  --artifacts-dir .artifacts/gate5/macos-sequoia \
  --candidate-sha 0123456789abcdef0123456789abcdef01234567 \
  --candidate-version 1.11.0 \
  --previous-version 1.10.0 \
  --support-target macos-15-sequoia-arm64
```

Important v1.11.0 limitation: source-level migration, sealed-floor unit tests,
and deterministic updater E2E do **not** prove that the signed v1.10.0 → v1.11.0
pair upgrades or that a representative machine refuses the previous signed
installer. Gate 5 needs that observed updater round trip and visible refusal
with unchanged database bytes. No such approved v1.11.0 manifest is retained
today, so its rollout remains at 10 percent.

If any recovery check fails, the host wrapper copies the bounded failure report
before returning non-zero, and the artifact step still uploads it with the
workflow logs. Promotion remains blocked. The package never swaps the source
database, so the immediate rollback is to keep distributing the last trusted
release and preserve the original encrypted database plus its last known-good
backup. The operator should classify the stable `failureCode`, reproduce against an
isolated copy on the failing OS, and escalate database-integrity, wrong-key,
or source-mutation failures before another candidate is built. No failing
candidate may be promoted by rerunning only the successful platforms.

## Failure reporting

Record the exact command, runtime, operating system, failing test, and whether
the failure came from project code or the execution environment. Do not report
a gate as passing when it was skipped, interrupted, or replaced by a narrower
test.
