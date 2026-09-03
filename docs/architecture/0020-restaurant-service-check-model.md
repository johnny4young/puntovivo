# 0020 — Restaurant service and check model

> Status: Accepted
> Date: 2026-09-03

## Context

The original restaurant path reused a generic sale draft and then suspended it
in a second command. That left an interruption window between stock debit and
table visibility, represented only one convenient draft per table in some read
surfaces, and had no durable structure for a visit with multiple checks,
diners, preparation courses, submitted rounds, or priced modifiers.

A restaurant check still participates in the ordinary sale, inventory, tax,
payment, cash-session, receipt, return, and audit rules. Creating a parallel
order aggregate with independent prices or quantities would let the dining-room
view drift from the sale that is eventually paid.

## Decision

### Sale-backed operational graph

- `sales` and `sale_items` remain the financial and inventory authority. The
  restaurant tables add operational metadata; they do not duplicate totals,
  tax, stock, payment, or fiscal state.
- One physical table may own at most one open `restaurant_service`. A service
  represents one contiguous visit and may expose up to 100 simultaneous open
  `restaurant_checks`, each backed by exactly one sale draft.
- Diners belong to the service, while courses, rounds, and operational lines
  belong to a check. A check line references exactly one frozen sale item and
  may reference one diner, course, and submitted round.
- Up to 20 unique structured modifiers may be frozen per line. Their
  non-negative per-unit delta is included in `sale_items.unit_price`, while
  `restaurant_modifier_amount` preserves the aggregate delta so draft
  completion can distinguish a legitimate modifier from an unauthorized price
  override.
- The unpaginated table projection is bounded to 1,000 open lines and 4,000
  modifiers across the service. New checks fail closed at that ceiling instead
  of allowing an authenticated client to grow an unbounded response.

### Atomic opening and lifecycle

- `restaurantServices.openCheck` is the preferred opening command for Voice
  Ordering, Mobile Waiter, and table-linked traditional POS flows. It runs
  through the Command Envelope and one `BEGIN IMMEDIATE` sale transaction that
  writes the sale, stock, table service, check, diners, courses, round, line
  metadata, audit, sync intent, canonical replay reference, and idempotency
  completion together.
- Table identity, active site, dine-in module state, capacity, established
  guest count, active diner seats, check and projection bounds, and modifier
  shape are revalidated under the writer lock. Sale pricing is resolved and
  frozen by the shared sale kernel. A table capacity is a ceiling, not a
  default party size; every check joining an existing service must use its
  established guest count.
- Completing or discarding the sale settles or cancels its check in the same
  sale transaction. The service closes only after its last open check closes.
- Moving a normalized check is allowed only when it is the sole account of its
  service and the target table has no draft or open service. The writer moves
  the service row itself together with the sale table, preserving diner
  identity instead of manufacturing a second visit. A normalized split stays
  at its current table because service-level diners cannot be divided or
  merged without an explicit party reassignment; it preserves price tier,
  course, round, modifier, and compatible diner identity. Legacy splits remain
  readable through the existing sale path.
- Suspend, resume, move, split, complete, and discard serialize their
  authorization reads with their writes so two devices cannot publish stale
  transition evidence or lose a sync-version advance.
- Every fresh retail draft and every resumed check records the authenticated
  actor plus registered terminal as the durable server-side claim. Suspend,
  complete, and discard enforce that actor claim unless a manager or
  administrator uses the existing audited override. Logout invalidates all of
  the actor's sessions and therefore parks every actor claim; staff switch
  rotates only the current terminal and parks only claims from that device.
  Both paths share the immediate identity transaction, and the client never
  transmits a private list of draft ids as cleanup metadata.
- A same-service split partitions the frozen header discount, tip, and service
  charge proportionally, recomputes both totals, and replaces provisional
  payment rows inside the same transaction. Drafts carrying loyalty or store
  credit fail closed because those customer-value ledger references cannot be
  divided without inventing evidence.
- `modules.setActive` and `modules.applyPreset` reject disabling `dine-in`
  while any open service or table-linked draft exists. The operational probe
  and settings update share the same immediate writer reservation.

### Compatibility and read boundary

- Existing create-then-suspend clients remain supported. When dine-in is
  active, suspending a table-linked legacy draft creates only the normalized
  structure that can be proven from the sale. Migration `0058` follows the
  same conservative rule: it adopts active-table rows still in draft state,
  including rows with a cleared suspension flag, without inventing diners,
  courses, rounds, or completed history. A historical draft
  attached to an archived table remains a legacy draft that an authorized
  operator can move or discard; the migration never silently reactivates its
  table or creates hidden service state.
- Migration `0059` permits a cash-session-less historical draft to become
  `cancelled`, while preserving the storage rule that completed and voided
  sales require a cash session. It never invents a register assignment.
- Migration `0060` introduces the nullable actor claim. Migration `0061`
  introduces its nullable device scope and conservatively parks every legacy
  active draft whose owner cannot be proven; it preserves creator history and
  never fabricates `suspendedBy`.
- `restaurantServices.getTableState` is tenant/site scoped and loads the graph
  with bounded batched queries rather than one query per check. Table catalogs
  expose every open check; table lists paginate deterministically within a
  maximum of 500 active rows per site instead of silently truncating them.
  Literal name search runs on the server before pagination, while the floor map
  uses a separate bounded query for the complete active catalog. The singular
  legacy draft field remains only as a compatibility projection.
- Cashier, manager, and administrator roles may read tables and open checks.
  Administrator authority owns table-catalog mutations; manager or
  administrator authority remains required for table transfer and check split.
- A cashier requesting one explicit tenant-owned site may list, resume, re-park
  and settle an open normalized check there even when another cashier opened
  it. Generic retail drafts remain owner-only. The normalized check preserves
  `openedBy`; the receipt and completion audit identify the settlement actor.
- The UI fails closed when the authoritative table catalog or service state is
  loading or unavailable. It never replaces an unknown table with free text.
  The suspended-sales panel is scoped to the active site using both cash-session
  and physical-table ownership, and pages through the server's full result set;
  a site-less legacy draft remains visible only as an explicit recovery case.
- Suspend, table move, completion, and discard cross-check site provenance from
  the draft's persisted cash session, physical table, and normalized service.
  A destination or current UI site never establishes origin; stock-managed
  drafts without consistent durable evidence fail closed.
- Once resume commits, local hydration is a separate failure boundary. The
  renderer removes partial local state and re-suspends the same sale with its
  original table/label. If that compensation fails, copy instructs the
  operator not to recreate the sale.
- A graceful identity change also closes that boundary through the durable
  claim. Ordinary restarts retain the owner-keyed local workspace. If local
  storage is missing or authentication expires, `sales.listDrafts` exposes the
  actor's still-active claim as an explicit recovery item and `sales.resume`
  rebinds it to the registered terminal. A failed remote logout keeps the local
  recovery workspace and Store Hub sealed credential instead of deleting the
  only path back to reserved stock. Recovery is operator-initiated; no global
  startup sweep interrupts another terminal.
- Mobile Waiter is usable only when both `mobile-waiter` and `dine-in` are
  active. Voice Ordering has the equivalent `pos-touch` plus `dine-in` gate.

### KDS boundary

- Opening a table-linked sale still invokes the existing KDS enqueue hook after
  the sale transaction commits. The hook is idempotent and best effort, uses
  the compatibility `main` station, and cannot roll back an accepted order.
- Durable station routing, immutable post-submit void/re-fire tickets, and
  guaranteed recovery from a process exit between sale commit and enqueue are
  not provided by this decision. They remain a separate product boundary and
  must not be inferred from the normalized service graph.

## Consequences

- A successful open-check response cannot leave stock debited without a
  discoverable check, and replay returns the original sale rather than opening
  another check.
- Multiple parties are not silently merged merely because they choose the same
  physical table. An operator must resolve a guest-count conflict explicitly.
- A table move never copies the full guest count onto two simultaneous
  services. Shared checks must first be settled or cancelled, and cross-table
  bill splits remain unavailable until the UI can capture an explicit diner
  reassignment.
- Restaurant totals, taxes, loyalty, receipts, returns, and cash reconciliation
  continue through the proven retail sale kernel.
- Settlement requires exact one-to-one coverage between frozen sale items and
  restaurant check lines; missing or repointed metadata blocks completion.
- Existing table drafts remain readable, but incomplete legacy history is
  represented as unknown rather than fabricated.
- The current UI exposes one structured modifier editor per line even though
  the server model supports a bounded list. The editor also accepts a bounded
  free-form positive price delta; there is not yet a manager-authored modifier
  catalog or per-modifier authorization policy. These are honest UI/policy
  limitations, not different persistence contracts.

## Alternatives rejected

- **Keep create plus suspend as the primary flow:** a crash between commands
  can debit stock without making the order discoverable at its table.
- **Create a second restaurant price/order aggregate:** duplicates the sale
  authority and creates reconciliation drift at payment and return time.
- **Treat one table as one bill:** cannot represent independent checks or show
  every account already open for a party.
- **Infer diners and rounds during migration:** turns absent historical facts
  into false operational evidence.
- **Allow a normalized check to detach to free text:** leaves the service graph
  pointing at a physical table while the sale says otherwise.
- **Claim KDS durability from a post-commit hook:** hides the precise crash
  window that a durable ticket outbox must close.

## Verification evidence

- `packages/server/src/__tests__/restaurant-services.test.ts`
- `packages/server/src/__tests__/restaurant-tables-router.test.ts`
- `packages/server/src/__tests__/sales-park-and-reprint.test.ts`
- `packages/server/src/__tests__/kds.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/restaurants/__tests__/VoiceOrderingScreen.test.tsx`
- `apps/web/src/features/sales/SalesModals.restaurant.test.tsx`
- `apps/web/src/features/sales/useSalesFlows.test.tsx`
- `e2e/web/restaurant-service.spec.ts`
- `e2e/electron/restaurant-service.spec.ts`
- `scripts/e2e-baseline-cleanup.test.mjs`
- migration `0058_demonic_solo.sql`
- migration `0059_slimy_silver_centurion.sql`
- migration `0060_bent_masque.sql`
- migration `0061_wakeful_jack_murdock.sql`

The live web and Electron smokes prove UI-to-tRPC-to-database round trips,
reload persistence, the selected table's open check, settlement, screenshots,
and a clean client error channel. Component and locale-contract tests cover
EN/ES copy plus keyboard/touch semantics; a bilingual human trial is not implied.
Kitchen routing/recovery evidence belongs to the separately durable KDS
boundary.
