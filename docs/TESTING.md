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

## Integrated local qualification — 2026-09-03

The restaurant-service candidate, including the identity, fiscal-recovery,
resumed-cart, Companion-entry, and real Electron logout corrections, passed the
mandatory local qualification matrix on macOS arm64 with Node 24.19.0,
pnpm 11.7.0, Electron 43.4.1, and the shared
`better-sqlite3-multiple-ciphers` 13.0.3 Node-API prebuild. Workspace and
performance gates ran sequentially. The optional 1 GiB backup-profile exception
is recorded separately below:

- `ci:server`: 3,256 tests plus the 50,000-product search profile and bounded
  100,000-row audit verification/redaction profile;
- `ci:web`: 2,971 tests, production build, memory/bundle contracts, and
  nonce-owned Lighthouse runs for authenticated boot, dashboard, sales, and
  products;
- `ci:desktop`: 308 tests plus 62 policy/runtime tests, the 256 MiB
  streaming-backup profile, packaging and memory policies, and a real Electron
  launch/memory measurement;
- `test:e2e:web`: 124 browser journeys under four workers without retries,
  including the full retail-day, exact-lot transformation, and bilingual
  in-transit inventory-identity rejection round trips, plus the restaurant
  module gate, 101-table search, structured service lifecycle, bilingual fiscal
  incident recovery, and Companion login without broad dashboard reads;
  `test:e2e:electron`: 14 real Electron journeys without retries, including the
  restaurant lifecycle against the embedded Fastify server and isolated
  SQLCipher database. Cashier handoffs invoke the visible logout action and
  require a successful server logout rather than clearing local credentials;
- `ci:release`: 112 release-contract tests;
- `rehearse:upgrade-recovery`: encrypted historical upgrade from 11 to 64
  migrations, idempotent second boot, downgrade refusal without database
  mutation, and isolated cross-key backup restore preserving 24 fingerprints;
  and
- the repository audit, raw `pnpm audit --audit-level low` over the installed
  dependency graph, setup check, and explicit Node/Electron native-runtime
  verifiers passed with no known package vulnerabilities. Setup artifacts were
  verified; its dev-server probes correctly reported stopped listeners after
  test teardown, not an active development stack.

The opt-in `perf:backup:release` profile measured on 2026-09-01 did **not**
reproduce its earlier 1 GiB RSS-growth result. Three candidate samples
grew by 106.84–112.44 MiB against the exact 96 MiB ceiling, although their
215–220.14 MiB absolute peaks remained below the independent 256 MiB ceiling.
The exact parent `dafb93c5` failed equivalently at +110.77 MiB/217.66 MiB on
the same host and dependency graph. The latest mandatory 256 MiB CI profile
passed at +26.33 MiB/134.73 MiB. This is therefore not evidence of a
PR8 backup regression; at that checkpoint it remained allocator/runtime
calibration or memory debt. The budget was not raised and those historical
samples remain failed evidence.

On 2026-09-04, the local backup candidate addressed payload allocation churn:
creation reads bounded 16 KiB chunks, while stored-entry extraction reuses one
256 KiB buffer and awaits every complete partial write before reusing bytes.
Three predeclared, sequential strict 1 GiB samples then passed with
32.88–33.55 MiB RSS growth and 140.72–142.88 MiB absolute peaks, below the
unchanged 96 MiB / 256 MiB ceilings. The command was
`pnpm --filter @puntovivo/desktop run profile:backup:release`. This is current
local evidence for that implementation, not a retroactive pass for older runs.

The same candidate passed 80 focused backup tests, the complete desktop gate
(334 runtime tests plus 62 policy tests, including the 256 MiB profile), and a
real Electron backup/restore smoke. Range-copy tests cover one-buffer ownership,
short reads/writes, EOF, invalid/no-progress I/O, and verifier failure. Archive
lifecycle tests cancel after real file data, require both descriptors to close,
and preserve the trusted destination after asynchronous and synchronous errors.
CRC, hash/MAC, size limits, atomic publication and legacy DEFLATE compatibility
remain enforced.

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

## Restaurant service contracts

Restaurant qualification treats the table workflow as a sale-backed state
machine rather than a screen-only feature:

- server integration tests open checks through real tRPC callers and Command
  Envelopes, then inspect the persisted sale, stock, audit, service, check,
  diner, course, round, line, modifier, and compatibility KDS rows. Fixed
  envelope replay must return the same sale and create each graph node once;
- capacity, established guest count, active diner count, table site, module
  state, the 100-check/200-line/20-modifier request bounds, and the 1,000-line/
  4,000-modifier service projection bounds fail before a partial graph can
  commit. A rejected open proves sale, sequential, and stock rollback. Table
  catalog tests exercise stable pagination and atomically reject an active
  table beyond the per-site bound, including archived-row reactivation;
- multiple checks remain visible on one table. Completion and discard close
  only their check, and the service closes after the last open check.
  Same-table split tests preserve price tier, course, round, modifiers,
  compatible diner identity, stock, and tenant/site scope; they proportionally
  reconcile header discounts, tips, service charges, totals, and provisional
  payment rows, and reject indivisible loyalty/store-credit drafts. Table-move tests
  preserve the service and its diners for a sole account and reject source
  services with shared checks, occupied destinations, and implicit cross-table
  party allocation;
- a competing-resume regression drives two distinct command intents against
  one suspended sale and permits exactly one transition and one audit row.
  A separate two-cashier journey lists, resumes, re-parks and settles one
  normalized check at the same site while keeping unrelated retail drafts
  private; receipt and audit assertions distinguish the opener from the
  settlement cashier.
  Table archive/update regressions run their open-service guards under the same
  immediate writer lock. Module toggle and preset tests prove `dine-in` cannot
  be disabled while normalized or legacy table work remains;
- migration tests upgrade from the prior journal entry, adopt active-table
  drafts including rows that were already resumed, leave archived-table drafts
  and completed history untouched, default the compatibility modifier delta
  safely, verify foreign keys, preserve cancellation of cash-session-less
  historical drafts, and prove restart idempotency;
- Voice Ordering component tests exercise manual and voice entry, structured
  modifiers, notes, diner/course selection, duplicate-click suppression,
  command failure recovery, every open check, guest-count locking, full editor
  locking while the atomic open command is pending, capacity,
  module/session gates, loading/error/empty fail-closed states, EN/ES
  accessibility metadata, touch/mobile parity, and every inventory, product,
  movement and serial projection invalidated after a committed reservation.
  Traditional POS tests cover generic parking plus explicit table selection
  without silently using table capacity as party size. POS Touch tests freeze
  the selected price tier, lock the entire ticket during settlement, and prove
  late product hydration cannot enter the settled or following ticket.
  Draft-panel tests pin active-site filtering, complete server pagination,
  page reset/clamping across site and result-count changes, explicit recovery
  of an actor's active claim, and ownership-aligned discard controls.
  Table-page tests prove literal server-side search, a complete bounded
  floor-map query, and recovery after archiving the only row on a final page.
  Route coverage proves Mobile Waiter
  cannot mount without both its surface module and `dine-in`. Resume tests
  cover local hydration failure, compensating re-suspension, actor-lock
  enforcement against the stale creator, fresh retail claim recovery, atomic
  actor-global parking before logout, device-local parking before staff switch,
  device-generation fencing of the prior cashier, in-transaction session
  invalidation rollback, disabled-module rejection across legacy table routes,
  stale-session registration takeover rejection, global device-binding cleanup
  after logout/password rotation, preservation after failed logout/auth expiry,
  actor isolation, transaction rollback, and an honest warning when
  compensation also fails. Migration
  coverage proves legacy active drafts are parked without fabricating an owner;
- the local Playwright browser journey creates a physical table through the
  administrative UI, opens a two-diner check from Mobile Waiter with a seat,
  course, kitchen note and priced modifier, verifies the frozen SQLite graph,
  reloads it, resumes the draft in the standard till, settles it, and confirms
  that the final check and service close. The corresponding Electron journey
  repeats that lifecycle against the sandboxed renderer, in-process Fastify
  server and an isolated encrypted database. Both assert a clean client error
  channel and retain open/settled screenshots. These journeys prove the
  implemented English UI path; EN/ES copy parity remains covered by component
  and locale-contract tests rather than being misrepresented as a bilingual
  live-operator trial. Unit and in-memory integration tests do not substitute
  for these running-target gates.

The durable kitchen contracts are owned by `kds.test.ts`,
`kds-configuration.test.ts`, `kds-worker.test.ts`, `kds-upgrade.test.ts` and
`kds-migration-adoption.test.ts`. They exercise sale/kitchen atomicity, observed
versions, tenant/site scope, legacy evidence and crash recovery without turning
an at-least-once invalidation into another preparation ticket.
`e2e/web/kds-durable.spec.ts` drives configuration and structured ordering through
UI, reconciles persisted snapshots/events, covers EN/ES reload and proves that a
second already-open kitchen receives configuration without reloading. The same
journey performs an axe AA scan, disconnects real browser networking, requires
preparation controls to be disabled with no queued writes, and resumes from
persisted state after reconnect. The Electron restaurant journey also configures
routing, prepares/recalls/resends a ticket, reloads and settles without another
cooking ticket. These are software contracts; physical screen/printer delivery
and human kitchen trials remain external evidence.

Fiscal integration coverage proves that fresh and resumed completed sales
insert one frozen emission intent before the Command Envelope result commits.
A restart test stops before the post-commit hook, mutates buyer and catalog
labels, then verifies that worker recovery materializes and accepts exactly one
document using the sale-time snapshots and advances numbering once. A separate
crash test reclaims a stale `materializing` claim. Migration coverage proves
`0063` adds an empty intent table without fabricating obligations for historical
sales. Additional regressions use the real Colombian mock to recover void and
partial-return credit notes after a failed post-commit claim, preserve the
original buyer/currency/locale, and keep normalized return obligations visible
at cash close. Dependency waiting does not exhaust transient retries. Fractional
fresh/draft discounts use exactly the transactional gross-first rounding.
Operations tests cover tenant-scoped intent listing, audited admin-only recheck,
safe reasons, and access beyond the first twenty rows. A bilingual real-browser
incident journey rechecks a blocked obligation, verifies its unchanged payload
and single audit entry in SQLite, and reloads the visible blocked state without
inventing a fiscal document. Its fixture models an already-committed sale bound
to a cash session and movement; it is not evidence of provider acceptance.

Companion's real-browser journey starts at its protected entry, checks that
login and relogin never request broad dashboard/operations/day-close queries,
and proves offline clearing plus SSE refresh after the manager signs a close.
Cart regressions additionally require authoritative refresh for existing
same-device and remote-device claims without duplicating the workspace.

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
hybrid semantic candidate pool without contacting an AI provider. On the same
catalog, the manager kitchen-routing
procedure covers literal SKU/name searches, first/deep keyset pages, and sparse
configured-only rules, asserting exact ids, cursors, and current rule projections.
Kitchen reads must satisfy the existing substring-search p95 ceilings; the
profile does not introduce a looser budget for the joined query. Pharmacy
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

## Reservation, delivery and signed inbox regression contracts

The fulfillment suites distinguish operational intent from financial authority:

- `reservations.test.ts` and the restaurant sale suites cover table capacity,
  overlap, explicit reservation version/party binding, legacy entry points and
  eligibility rechecks under the writer.
- `deliveryOrders.test.ts` covers strict transitions, courier/reason validation,
  sale ownership, refunded-sale rejection, replay and transactional rollback.
- `external-orders.test.ts` covers signed ingress, nonce/event identity, reordered
  cancellation, local catalog acceptance and explicit financial reversal.
- `external-order-upgrade.test.ts` migrates historical databases and reopens both
  plaintext and SQLCipher files while preserving sealed credentials and exact
  inbox/receipt/nonce/transition evidence. A second real SQLite connection holds
  the writer to exercise safe failure and exact retry after lock release.
  `delivery-upgrade.test.ts` preserves
  legacy delivery fields without invented provenance.
- `external-order-simulator-cli.test.ts` executes the actual CLI against a
  loopback endpoint. A successful HTTP status must include a valid receipt for
  the submitted event/order; arbitrary JSON and another order's receipt fail.
- Web `delivery.spec.ts`, `reservations.spec.ts` and `external-orders.spec.ts`
  drive real UI and API paths and reconcile their own isolated SQLite records.
  Connector credentials originate in the UI; the sandbox client sends exact signed
  events over HTTP. The fractional fixture declares both step and minimum. The
  mobile assertion checks visible layout bounds after resize, not only document
  overflow (clipped content can otherwise produce a false green). Reservation
  overlap is rejected through the real lazy-loaded error dictionary. Sale-detail
  navigation is one-shot and must not reopen the dialog after reloading.
  Saving a future reservation selects its local day and clears incompatible
  queue filters. The next-day journey verifies visibility, a real overlap
  rejection, and exactly one reservation with no sale created by booking.
- Electron `external-orders.spec.ts` and `reservations.spec.ts` exercise
  connector-to-checkout/delivery and reservation-to-table-service against the
  in-process backend, without direct writes to the encrypted runtime DB. The
  reservation journey navigates back within the SPA before reloading: a full
  navigation alone can hide a missing post-commit cache invalidation.
- Fulfillment failures use a route-loaded dictionary, not the synchronous
  bootstrap error packs. The delivery queue loads create/detail workflows only
  when requested; the account-menu approval workflow is also lazy. Bundle ceilings
  remain fixed, and the full manager-approval journey verifies its EN/ES actions.

Run these focused suites while developing, then all applicable workspace gates,
complete web/Electron suites and recovery qualification. Passing focused cases
alone is not a full candidate verdict or real-provider certification. The signing
simulator and its limits are documented in [External orders](./EXTERNAL-ORDERS.md).

## Effective employment terms and private evidence

Employment qualification separates administrator compensation from the minimal
assignment projection available to managers:

- `employment-contract.test.ts` and `employment-contract-storage.test.ts` cover
  explicit money, half-open effective periods, immutable compensation, overlap
  rejection across sites, archived-site corrections, active actor rechecks and
  atomic private events, safe audit, local-only outbox and completion fences.
- `employment-contract-upgrade.test.ts` upgrades both plaintext and encrypted
  historical databases without inventing salaries or modifying attendance. Real
  SQLite writer contention leaves no partial contract; two subsequent boots
  preserve records and pass foreign-key and integrity checks.
- `workforce.test.ts` covers tenant and role boundaries, bounded keyset reads,
  private history, safe manager projections, replay and reservation failures.
  A real idempotency-storage trigger exercises the error boundary outside the
  command decorator, not only resolver failures.
- `employee-schedule-commands.test.ts` exercises schedule create/update/cancel
  with real completion, audit and outbox storage faults, crash-after-commit replay,
  competing devices, SQLite writer contention and authority/clock changes before
  the writer. Cancellation preserves history and rejects stale no-op versions.
  Viewer workers remain unable to access manager scheduling APIs.
- Attendance visibility uses the same worker-targeting policy for list, filters,
  corrections and exports. `employee-attendance.test.ts` asserts that changing a
  worker to viewer does not hide historical hours from authorized administrators
  or managers; it still rejects viewer report access and manager targeting of
  administrators. The historical-role-change journey in
  `e2e/web/employee-shifts.spec.ts` changes the role through Users, verifies both
  authorized roles, downloads all historical CSV rows and reloads in Spanish
  without rewriting raw attendance. This does not grant viewer clock-in rights.
- `EmploymentPanel.test.tsx`, `employmentTypes.test.ts` and audit summary tests
  cover raw blank amounts, explicit zero, hidden monthly costing, stale versions,
  duplicate confirmation, exact cents, escaping, role handoff and dirty editor
  retention through failed context refreshes and changed tenant currency.
- The shared journey in `e2e/shared/employment-journey.ts` runs from both
  `e2e/web/employment.spec.ts` and `e2e/electron/employment.spec.ts`. It creates
  users and employment evidence through the UI, replaces and ends terms, inspects
  frozen history, voids a correction, reloads in Spanish and signs in as manager.
  The manager must never request private contracts or see compensation controls.
  The browser wrapper also reconciles the persisted contract versions and events.
  Consecutive user creation must start with blank identity and initial password.
  The manager creates, edits and cancels a viewer worker's shift, reloads the
  cancelled history in Spanish and verifies the active navigation state. Browser
  SQLite reconciliation asserts the final version and three minimal local-only
  outbox events without employee notes.
- `e2e/web/schedule-recovery.spec.ts` induces a tenant-scoped real SQLite failure
  in EN and ES, verifies safe copy and retained form values, then compares the
  exact command envelopes across retry. It reconciles one durable shift, audit
  and local-only outbox after reload. Its continuous issue tracker excludes only
  the single deliberately failed request; other failures still reject the test.

Electron's explicit single-frame axe transport uses the same WCAG tags and
severity as the browser helper. It refuses child frames before and after the
scan rather than silently excluding them; `accessibility-execution.spec.ts`
proves that serious violations still fail and embedded frames are rejected.
Normal browser audits retain their multi-frame execution path.

```sh
pnpm run test:e2e:web e2e/web/employment.spec.ts e2e/web/accessibility-execution.spec.ts --workers=1
pnpm run test:e2e:electron e2e/electron/employment.spec.ts
```

These are employment evidence and regular-time costing contracts, not legal
validation of a labor agreement, statutory payroll, or a substitute for the
complete release qualification matrix.

### Operational employee absences

The absence contracts use real router callers and isolated SQLite databases.
`employee-time-off.test.ts` covers bounded manager-safe employee options, tenant
and role isolation, explicit approval, no self-approval, frozen calendar intervals,
reciprocal cross-site scheduling exclusion, stale versions, fault rollback and
same-command replay. `employee-time-off-upgrade.test.ts` covers additive adoption
without inferred leave and preserves approval/cancellation through plaintext and
encrypted restarts. DST cases include Santiago's skipped midnight.

`e2e/web/time-off.spec.ts` and `e2e/electron/time-off.spec.ts` share the same real
manager request/approve/cancel journey, including private history, original
approval after cancellation, Spanish reload and accessibility assertions. The
manager phase asserts that no administrator-only employee-directory request is
sent. `e2e/web/time-off-recovery.spec.ts` injects an event-insert failure only for
its isolated test tenant, checks the exact safe EN/ES error, proves rollback,
then retries the same envelope and verifies one persisted result after reload.
Only the precisely correlated injected failure is allowed in client diagnostics.

These checks are not evidence of statutory leave entitlement, payroll compliance,
medical-record handling, human usability testing or physical macOS qualification.

### Effective recurring employee availability

- Pure availability tests cover real-minute admission, repeated/skipped DST time,
  midnight/week boundaries, adjacent slots and explicit unavailable periods.
- Router tests use real SQLite writers for tenant/role checks, reciprocal schedule
  admission, version conflicts, storage-fence rollback, replay, lost responses,
  competing commands and schedule changes during paged preflight. Upgrade tests
  cover plaintext and encrypted databases without inventing employee preferences.
- Web component tests exercise date-effective forms, empty-week acknowledgement,
  bounded manager employee selection, private history, staff handoff, EN/ES safe
  errors and command identity retained after outcome-uncertain failures.
- `e2e/shared/availability-journey.ts` drives the real web and Electron UI: a manager
  creates a Sunday overnight policy, rejects an out-of-policy shift, schedules an
  allowed shift, creates an effective successor, voids it explicitly and reads
  private history after Spanish reload. The web wrapper reconciles the two policy
  rows, four events, unchanged shift and privacy-minimal local-only outbox in SQLite.
- `e2e/web/availability-recovery.spec.ts` injects a tenant-scoped event-write fault,
  asserts rollback and safe EN/ES copy, then verifies the same command envelope
  produces exactly one decision after retry and reload. Expected HTTP errors are
  matched to the exact deliberately failed request; unrelated diagnostics fail.

These scenarios are local operational evidence, not automatic schedule publication,
statutory availability rules, leave entitlement, payroll approval or a human pilot.

### Recurring schedule drafts and explicit publication

- Generator tests cover bounded cadence, ISO Monday anchors, DST gaps/repeats,
  overnight real-hour limits, stable rule/date identity and overlap rejection.
- Router and migration tests cover atomic multi-shift publication, immutable
  snapshots, exact event actor attribution, shared-DB read coherence, stale
  versions, absence/availability changes during admission, writer contention,
  replay, rollback and encrypted/plaintext historical adoption without backfill.
- React tests cover draft editing, explicit acknowledgement, preservation of
  displayed versions after failures, pending-action locks, staff handoff,
  site-owned pagination, bounded preview and fail-closed private read errors.
- `e2e/shared/schedule-plans-journey.ts` drives the same manager lifecycle in web
  and Electron: create a two-shift draft, regenerate it, publish explicitly,
  reload the operational schedule, reject a conflicting publication, discard
  that draft and reload the frozen evidence in Spanish. It also switches back
  to an administrator to inspect the privacy-minimal audit summaries in EN/ES.
- The web wrapper reconciles plan versions, five immutable events, two exact
  occurrence/shift links, actual scheduled duration, minimal audit and local-only
  sync rows against SQLite. The intentionally rejected publication permits only
  its exact HTTP conflict and associated browser diagnostic; other errors fail.
- Both wrappers preserve screenshots, and axe checks the real draft and persisted
  preview. New tenants enter administrator setup at `/company`; successful plan
  decisions open a persisted preview that must be closed before tab navigation.
- Electron runs the manager lifecycle and administrator audit as separate
  actor-owned fixtures with the default 100-request HTTP cap still enabled.
  Concatenating every setup, role switch and reload rapidly can saturate that cap;
  the split is functional coverage, not an aggregate traffic-budget qualification.
- `global-rate-limit-transport.test.ts` preserves the default cap, IP isolation,
  mutation rejection and `Retry-After`, and checks a decodable tRPC error rather
  than Fastify's incompatible string-valued error. The client transport regression
  verifies a throttle neither retries the request nor expires an active token.
  This does not claim auth-bootstrap recovery during a saturated reload.

Recurring plans do not establish worked hours, payroll approval, legal compliance,
physical macOS compatibility or human usability qualification.

### Consent-bound employee shift exchanges

- `employee-shift-swaps.test.ts` covers exact published-shift versions, requester
  ownership, recipient consent, independent approval, active claims, conflicting
  final decisions, archived or revoked actors, absence and availability admission,
  atomic replacement lineage, replay, writer contention and private evidence.
- `employee-shift-swaps-upgrade.test.ts` and the shared workforce-adoption matrix
  cover fresh and historical plaintext and SQLCipher databases. Adoption creates
  no requests, claims or replacement shifts and remains stable across restarts.
- React tests keep the employee self-service route distinct from manager schedule
  authority, require explicit frozen-pair acknowledgement, reset private state on
  staff handoff and preserve safe EN/ES conflict messages.
- `e2e/shared/shift-swap-journey.ts` executes the same three-actor journey in web
  and Electron. A cashier requests an exact pair, the recipient accepts in Spanish,
  and an independent administrator approves before the requester reloads the final
  version. The web wrapper reconciles both cancelled originals, two replacements,
  actor-attributed immutable events, released claims and three local-only outbox
  rows directly in SQLite. Generic audit and sync evidence contains neither the
  private reason nor schedule notes or the frozen fingerprint.

An exchange is an operational scheduling decision, not proof of employee consent
under local labor law, collective-agreement compliance or payroll treatment.

### Explicit planned-versus-actual reconciliation

- `employee-attendance-reconciliation.test.ts` keeps an ended plan in
  `needs_review` until a manager records an explicit attended or no-show outcome.
  It covers correction-aware variance, exclusive attendance claims, immutable
  private events, frozen plan snapshots, stale versions, early no-show rejection,
  tenant/role boundaries, local-only sync and database integrity triggers.
- `employee-attendance-reconciliation-upgrade.test.ts` and
  `workforce-migration-adoption.test.ts` cover fresh and historical plaintext and
  SQLCipher databases, repeated restart, ciphertext verification and the rule that
  migration never invents a plan-to-clock relation.
- `labor-costing.test.ts` prices only the exact half-open report window, splits
  contract date boundaries in the frozen timezone, handles DST and crossing breaks,
  preserves contract gaps and mixed currencies, rejects overlapping terms, and
  converts unsafe row or aggregate money into explicit unavailable evidence. A
  property test proves adjacent windows partition the same attendance without
  double counting.
- `PlanActualPanel.test.tsx` covers explicit evidence/reason input, no-show without
  an attendance identity, administrator-only regular operational cost, safe-range
  overflow and invalidation of the weekly schedule after a plan becomes immutable.
  `TeamSchedulePage.test.tsx` verifies reconciled shifts expose historical evidence
  without edit or cancel actions.
- `e2e/shared/attendance-reconciliation-journey.ts` drives administrator-created
  employees, hourly terms and plans, employee clock-in/out, an attended decision,
  a previous-week no-show, frozen schedule controls, Spanish reload, generic audit
  privacy and a manager view without compensation. The browser wrapper verifies
  both reconciliations, the closed raw clock, private actor-attributed events,
  contract amount, minimal audit and local-only sync directly in SQLite. The same
  UI journey runs against Electron's sandboxed renderer, in-process Fastify server
  and encrypted database.

The cost projection is deliberately labelled regular operational evidence. It is
not statutory payroll: it does not calculate overtime or holiday premiums,
benefits, taxes, withholding, social-security contributions or legal approval.
