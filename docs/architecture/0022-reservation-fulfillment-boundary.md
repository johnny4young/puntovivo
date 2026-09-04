# ADR-0022: Reservation and fulfillment boundaries

Status: Accepted

## Context

Restaurant reservations and delivery logistics are operational aggregates, not alternate sale systems.

## Decision

### Reservations

Reservations carry an explicit site, optional table, party size and UTC-normalized planned interval. The UI labels the device time zone used to edit that interval. The interval is half-open: a booking ending at 19:00 does not conflict with one starting at 19:00. Creation and reassignment check active owned tables, capacity and overlaps while holding SQLite's immediate writer. Unassigned bookings do not claim capacity.

The lifecycle is `booked → arrived → seated`, with explicit `cancelled` and `no_show` terminal alternatives. No-show is an operator decision allowed only after the planned start; there is no automatic timer or inferred attendance. Cancellation and no-show require an operator reason. Booked details can be replaced using an expected version; arrivals must be explicitly cancelled rather than silently reassigned to another party.

Arrival requires an empty table. It does not create a sale, reserve merchandise, collect a deposit or send kitchen work. An arrived party keeps its table hold until seated or cancelled, even after its planned end. Outstanding arrivals remain visible in the reservation list outside the selected date window. Future bookings do not guarantee an occupied service will finish on time and cannot evict it.

The first real check consumes an explicitly selected arrived reservation id and version. Matching tenant, site, table and party size are revalidated in the sale transaction. The reservation's `serviceId`, seating event, audit evidence, local operation outbox and sale graph commit together. There is no implicit name/table-based association and no empty-sale placeholder. A seated reservation remains historical evidence after its service closes; financial corrections use existing sale commands.

All table-entry paths enforce reservation holds, including legacy `sales.create`, later legacy suspension and table moves. Current occupancy eligibility uses the actual clock under the writer, not a timestamp frozen before asynchronous sale preflight. Existing open services may continue until explicitly settled; scheduling does not rewrite their financial timestamps.

### Delivery

A manual delivery is explicitly a logistics quote. It never creates a payment, stock deduction or sale. A sale-backed delivery reads immutable sale-line snapshots and the authoritative total inside its writer. Site ownership derives from the sale's owned cash session. Completed status alone is insufficient: refunded headers or any return ledger exclude creation and forward fulfillment transitions. Explicit cancellation remains possible and never voids or refunds the sale.

The strict chain is `accepted → preparing → dispatched → delivered`; each nonterminal state may instead become cancelled. Dispatch requires a courier; cancellation requires a reason. Every mutation is versioned and replay-safe. Terminal states cannot reopen. Legacy rows retain unknown currency/provenance rather than deriving fictional history from current tenant settings.

### Evidence and transport

Both domains write immutable versioned events and minimal audit facts in the same command transaction, finishing the Command Envelope fence last. Recipient names, contact numbers, delivery addresses and free-text notes are excluded from the audit/outbox projection. Operational read endpoints remain role-, module-, tenant- and site-scoped.

The operation outbox is local-only. Remote application is blocked until a complete aggregate codec can preserve scheduling, ownership, event and service/sale invariants. An outbox row is not evidence that cross-device synchronization is supported.

## Consequences

Operational changes cannot silently manufacture financial evidence. Reservations may
require explicit operator resolution when a previous party stays longer than planned.
These checks protect a single local authority database; they do not assert that a
remote scheduling provider has accepted or reconciled the booking.

## Alternatives rejected

- Creating empty draft sales on arrival: falsely reserves a commercial identity before an order exists.
- Inferring the party from table or guest name: ambiguous under retries and overlapping edits.
- Checking table holds only on suspension: the earlier legacy sale may already reserve stock and enqueue kitchen work.
- Reusing a frozen fiscal timestamp for eligibility: asynchronous preflight may cross the booking start.

## Verification

The reservation and restaurant-service integration suites drive real migrated SQLite
through tRPC, including duplicate commands, conflicting versions, isolated tenants,
legacy entry points, stale preflight clocks and rollback at the completion fence.
Real web journeys cover explicit seating through traditional Sales, Mobile Waiter
and POS Touch. Historical delivery rows survive both plaintext and SQLCipher
upgrade. Full candidate and Electron qualification remain separate requirements. These checks are local evidence, not hardware or external-provider certification.
