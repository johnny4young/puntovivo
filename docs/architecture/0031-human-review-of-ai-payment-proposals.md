# Human review of AI payment proposals

Status: Accepted

## Context

A provider statement can match several local payment-outbox rows by amount,
rail, and time even when no exact reference is available. The deterministic
reconciliation pass previously treated a model's tie-break as permission to
set a row to `settled`. A model response is neither provider evidence nor a
human authorization to change a money-related state. Statement imports also
advance their cursor after a successful pass, so an in-memory suggestion would
be lost after a crash or restart.

## Decision

The model can create only a durable, tenant-scoped **pending proposal**. The
proposal stores the exact settled statement, every candidate, the recommended
outbox row, model confidence and explanation, and the AI-call audit id. A
canonical statement fingerprint makes exact replay idempotent. Pending
proposals reserve their selected outbox row from later reconciliation passes;
a partial unique index allows at most one pending proposal per outbox row;
re-importing the same statement does not call the model again. Rejected
proposals preserve the evidence and do not silently re-open on replay.

Only an administrator can approve or reject the proposal through the payments
tRPC router. The read API also permits managers, but the current Operations
route exposes Payment Health only to administrators; manager access to that
page is not part of this change. The admin UI shows the provider and POS
amounts, currencies, references, transaction IDs,
all candidates, discrepancies, and a warning that the model has not confirmed
payment. Approval requires the administrator to acknowledge checking the
provider's settled record. A screenshot or model explanation is never treated
as settlement evidence.

Before a model recommendation is persisted, every candidate is re-read in
a SQLite write transaction. If a worker claims a candidate during model latency,
or another pending statement reserves the same outbox row, the import fails and
its cursor remains unchanged for replay. Deterministic matching also uses a
conditional update so a later statement cannot overwrite an existing provider
transaction or settle a pending-proposal row.

Approval re-reads the proposal and selected outbox row in one SQLite write
transaction. It fails closed if either tenant scope, recommendation, immutable
snapshot, provider transaction id, amount, currency, rail, charge kind,
`approved` status, or unclaimed worker state has changed. A previously settled
row with the same provider transaction id also blocks approval. A
compare-and-swap update changes only `payment_outbox`, then marks the proposal
approved and writes both outbox and proposal audit records in the same
transaction. It does not rewrite `sale_payments` or completed sales. An exact
repeat of the same decision returns without a second state change or audit
record; the opposite decision conflicts.

The proposal path currently covers settled **charge** statements with an
unclaimed, approved candidate and a nonempty provider transaction id. Other
cases stay ambiguous for manual provider review rather than broadening a model's
authority. Live provider fetching and AI tie-break wiring remain separate
activation gates; this decision does not activate them.

## Consequences

- The operator must review ambiguous statements instead of relying on an
  autonomous tie-break, even if the model reports high confidence.
- The proposal table and evidence survive worker cursor advancement, restart,
  rejection, and exact import replay.
- A stale proposal remains visible and requires rejection or a new reviewed
  provider record; the system never repairs a mismatch by silently settling a
  different outbox row.
- Manual provider override remains an independently authorized admin action,
  but it cannot make an AI proposal an automatic decision.

## Alternatives rejected

- **Keep the model result only in the pass response:** the import cursor would
  advance and discard the review task.
- **Auto-settle above a confidence threshold:** self-rated confidence is not
  provider proof or an authorization policy.
- **Write the result into completed sales or tenders:** that would mutate
  accounting history when only outbox reconciliation is at issue.
- **Retry a rejected recommendation automatically:** this would erase a human
  decision and create repeated billable calls for the same statement.

## Verification

The in-memory router and matcher tests cover no AI-side settlement, proposal
persistence and exact replay, tenant and role isolation, stale amount and
claimed-row conflicts, concurrent model-latency changes, pending-outbox
uniqueness, immutable provider transactions, idempotent review, atomic audit, and unchanged sale
accounting. UI tests cover evidence, both locales, manager read-only access,
and the explicit approval gate. Server and web CI plus live running-target
review remain mandatory before promotion.
