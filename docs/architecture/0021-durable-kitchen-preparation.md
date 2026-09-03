# ADR-0021 — Durable kitchen preparation

- Status: Accepted
- Date: 2026-09-03
- Supersedes: the post-commit KDS boundary in ADR-0020

## Context

A sale could commit before the old best-effort kitchen hook ran. A process exit
in that interval lost preparation work, and rebuilding a ticket from a mutable
sale could change food already being prepared. Split checks and table moves
also need to change delivery ownership without duplicating preparation.

## Decision

### One transactional submission

The sale writer creates the kitchen header, frozen preparation lines, dispatch
decisions, ordered events and durable invalidation outbox before committing.
The existing sale Command Envelope retains ownership of request idempotency,
audit and fiscal boundaries. No post-commit KDS enqueue is required.

A dispatch is unique per tenant and source sale item, including an explicit
exclusion. Re-suspending, completing, changing routing or splitting a submitted
line therefore cannot send that food twice. New lines/rounds create new tickets
rather than replacing a submitted snapshot. Disabled KDS does not invent
kitchen work for ordinary sales.

Preparation freezes product name, quantity/unit, note, round, course, diner
label and modifier names/quantities. Prices, tender details, customer records
and pharmaceutical evidence are excluded. Operational ownership, current table
and preparation state are stored separately. Check splits and table moves
update that ownership without changing original preparation or ticket identity.
A void becomes an immutable event and terminal line state, not a deleted ticket.

### Configuration and bounded reads

Managers/admins configure site-owned stations and product/category rules through
`kds.*` tRPC procedures. A product rule overrides its category; absent rules
inherit the default `main` station. Exclusion is explicit. Invalid/inactive or
foreign station targets fail closed; configuration changes affect future
submissions only. The default station cannot be deactivated; configured routing
or unfinished work also prevents deactivation.

All reads and writes scope tenant/site. Station keys are immutable. Updates
require an observed version, and rule replacement also checks observed rule
identity so delete/recreate cannot defeat concurrency control. Configuration
mutations and audit share one immediate write transaction.

There are at most 64 stations per site, 200 unique lines per submission and
512 KiB per preparation snapshot. Routing target lookup uses bounded keyset
pages and escaped literal search. Board reads prioritize unfinished work and
return a bounded page with an explicit truncation warning. Malformed or oversized
tickets become read-only integrity errors without hiding healthy tickets.

The board displays its active site, saved station ordering and frozen ticket
station names. Both queue and station metadata refresh every 30 seconds; manual
refresh fetches both. Order SSE accelerates queue invalidation but is not the
only freshness mechanism. Offline or failed queue reads disable preparation
mutations instead of queuing actions against stale state.

### Versioned preparation and notification delivery

Whole-ticket and individual-line transitions require the generation actually
shown to the cook. The immediate transaction validates ownership and snapshot
integrity, performs compare-and-swap updates, and appends audit/event/outbox
records atomically. Concurrent or repeated actions cannot silently overwrite
later preparation. Whole-ticket ready is derived from non-voided line state.

Recall reopens existing preparation; resend creates a notification event for the
same ticket, not new food. The outbox uses the shared claim kernel with KDS-local
claim-token fencing around delivery/completion. A bounded worker recovers stale
claims, isolates malformed payloads, yields between tenant batches and drains
on shutdown. It starts only when the server listens, including the backend
embedded in Electron's main process.

SSE delivery is at least once. A crash after broadcast and before completion can
repeat an invalidation, which is safe because clients reread persisted state.
Delivery acknowledgement means the local realtime broadcaster accepted the
invalidation, not that a physical kitchen screen or printer received it. Board
polling/reconnect remains necessary. This is not a hardware delivery guarantee.

### Historical evidence

Migrations add normalized state while keeping existing `items_json` bytes and
legacy ticket identity. Strict, bounded lazy adoption records its origin once,
without creating a new cooking notification. Invalid legacy evidence is retained
and shown as unverified; it is never partially cooked or silently repaired.
Restart/replay cannot adopt or dispatch an existing line twice.

## Alternatives rejected

- Post-commit enqueue: preserves the loss window after sale acceptance.
- Rebuilding a ticket on every sale edit: changes already-submitted preparation.
- Resend by inserting another ticket: duplicates food instead of notification.
- Optimistic UI writes without observed generations: loses concurrent progress.
- Treating SSE acknowledgement as physical delivery: overstates local evidence.

## Verification and limits

Backend tests cover submission rollback, stable dispatches, routing, line/header
CAS, split/move/void, poisoned snapshots, tenant isolation and worker recovery,
including process termination after claim. Configuration tests exercise role
boundaries, literal search, keyset pagination, replacement identity and audit
rollback. UI tests exercise rich snapshots, locale, offline/stale controls and
configuration permissions. Live browser journeys cover setup, structured orders,
preparation, recall/resend, SQLite reconciliation, reload and a second display.

See [testing](../TESTING.md) for executable journeys and qualification evidence.
This decision does not introduce station printers, a manager-authored modifier
catalog, reservations or external delivery integrations. Physical kitchen trials
and signed-install/platform hardware evidence remain separate gates.
