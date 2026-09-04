# ADR-0023: Signed external order intent and local sale authority

Status: Accepted

## Context

An external order is a request from another system, not evidence that this store
has accepted prices, reserved goods, collected payment or issued a fiscal document.
Retries, reordered cancellations and a lost response must not duplicate those effects.

## Decision

### Authentication and durable identity

The generic `sandbox_v1` contract enters through the existing tRPC transport at
`externalOrders.receive`. It has no bearer session or caller-supplied tenant/site.
A random connector ID locates one enabled, site-owned credential. HMAC-SHA256 v1
binds a domain separator, connector ID, integer Unix-millisecond timestamp, nonce
and the exact UTF-8 event body (at most 64 KiB). The five-minute signature window
and connector/tenant/site/module state are rechecked under the immediate writer.

The credential is 32 cryptographically random bytes encoded as canonical base64url.
An administrator creates or rotates it explicitly. AES-GCM storage binds the
ciphertext to tenant and connector identity; neither plaintext nor ciphertext is
returned by projections, command replay results or audit records. The standalone
runtime can use `PUNTOVIVO_EXTERNAL_ORDER_KEY`, a separate stable 64-hex wrapping
key; otherwise the existing webhook/database key source applies. This never
relaxes mandatory production database encryption. Changing the wrapping source
is not a credential migration. Connector rotation invalidates the previous
signing key immediately without deleting durable receipts.

A transaction stores order intent, immutable event receipt, transport nonce,
versioned transition and minimal local operation outbox together. The same event
ID must keep the same body hash. Exact transport retries return the original
acknowledgment; a fresh signed nonce can retry the same event after state advances.
Nonce retention lasts through signature validity; event receipts remain durable.
A cancellation arriving before creation stores a tombstone that a later create
cannot reopen. A source create never writes a sale, payment, inventory or fiscal row.

### Explicit commercial acceptance

Managers/admins review local products resolved from owned active base-unit SKUs,
local currency, tax components, prices and quantity policy. Provider totals are
shown only for comparison. A quote fingerprint binds the inbox version and local
catalog inputs; changing it clears UI consent. The operator must confirm local
pricing before acceptance. Pending accept/reject controls cannot race from the UI.

Acceptance calls the existing fresh-sale kernel with an internal-only reference.
The immediate sale writer repeats the owned catalog/line/totals check, creates
one suspended draft, reserves its goods, enqueues configured kitchen work, binds
the inbox version, records audit/outbox and completes the original command fence.
There is no create-then-link gap. A pending tender plan is not a received payment.
The existing suspended-sale workflow owns resumption, cash-session authorization,
settlement and fiscal behavior. External acceptance cannot authorize a price
override or treat a source's paid claim as local payment evidence.

### Cancellation and recovery

An unaccepted intent may be rejected by an operator or cancelled by its source.
A source cancellation after acceptance becomes `cancel_requested`, blocking draft
checkout and delivery advancement. It does not refund, release inventory or void
a sale. An operator discards an unpaid draft or explicitly reverses a paid sale
with existing audited commands, then resolves any remaining cancellation request.
Draft discard/void participates in the same local cancellation transaction.
External-linked drafts cannot be split into untracked independent checks.

Unexpected storage failures map to a safe stable API code. Because failure can
follow the original commit, the renderer retains the original command envelope
for an outcome-uncertain retry. Cross-tenant/site reads remain guarded, including
the minimal linked-sale status projection. These aggregates are local-only until
sync can preserve their complete authorization, receipt and commercial graph.

## Consequences

The operator can configure connectors, review/reject requests, rotate/disable
credentials and reach the linked draft or sale from the application. Missing
wrapping configuration fails closed with an actionable message. No sender is
implicitly trusted to change local prices, collect funds or issue refunds.

This is a generic sandbox adapter, not compatibility or certification for a real
aggregator. Vendor-specific signatures, mapping, acknowledgment rules, retention
requirements and reconciliation require separate evidence before live adoption.

## Alternatives rejected

- Treating signed data as a sale/payment: authenticity is not commercial authority.
- In-memory deduplication: restart would erase the evidence needed to prevent replay.
- Automatically undoing payments on cancellation: the source has no local refund authority.
- Returning a stored signing key: administrators rotate rather than retrieve credentials.
- Parsing arbitrary simulator responses with `response.json()`: a timeout does not cap memory.

## Verification

Migrated SQLite tests cover MAC/body tampering, nonce/event conflicts, concurrent
duplicates, cancellation tombstones, authorization and late-write rollback.
Historical plaintext and SQLCipher restarts preserve sealed credentials and exact
receipt/event/nonce state, with no invented orders. Real web journeys use the UI
for connector management and checkout, signed HTTP for source events, and
read-only SQLite for stock/payment reconciliation. The operator simulator refuses
redirects and consumes at most 64 KiB of response bytes before JSON parsing.
Electron, full candidate gates and any real-provider qualification remain separate
requirements; focused tests do not substitute for them.
