# Consent-bound employee shift exchanges

Status: Accepted

## Decision

An employee shift exchange is a consent workflow over two exact, already
published operational shifts. It is not an in-place reassignment, a recurring
plan edit, proof of attendance, or a payroll adjustment. The requester chooses
an owned future shift and one eligible future shift owned by a different
employee. The request freezes both shift identifiers, versions and complete
operational fingerprints. The recipient must explicitly accept that exact pair,
and a manager or administrator who is not either participant must approve it.
No command silently rebases consent onto newer shift data.

At most one active request may claim a shift. Database-enforced claims prevent
A↔B and C↔A from progressing concurrently. A participant may reject or cancel
before approval; after acceptance, the recipient may withdraw that consent. A
stale or archived request may release its claims only after the writer proves
that it no longer represents a valid active exchange.

## Transaction and concurrency boundary

Create, respond and decide are critical Command Envelope operations. Each
completion revalidates the active authenticated actor, device session, tenant,
role and command identity. The immediate SQLite writer transaction checks both
frozen versions and fingerprints, employee and site ownership, future canonical
instants, absence, availability and overlap policy. A stale decision fails with a
safe conflict instead of applying to changed data.

Approval atomically cancels the two original shifts and creates two replacement
shifts with exchanged owners. Site, canonical start and end, business timezone,
status and private notes are preserved. Immutable links point from each original
to its replacement and back to the approved request. The original published-plan
occurrences remain unchanged, preserving what management originally published.
Schedule writes, request transition, claim release, private event, minimal audit,
local-only outbox and cached command result commit or roll back together.

The swap outbox is deliberately local-only. Remote application remains blocked
until a multi-device conflict model can preserve the same consent and exclusive
claim invariants.

## Read, UI and privacy boundary

Personal reads return only the authenticated employee's future shifts, bounded
peer candidates and requests in which that employee participates. Manager and
administrator reads use a separate bounded inbox and cannot be used as a generic
employee directory. Reads are tenant-scoped, keyset-paginated, limited to a
120-day future window and capped at 50 rows per page.

Generic projections omit shift notes, reasons, fingerprints, email, PIN and
compensation. Private transition reasons are available only from a lazy event
history to participants and authorized managers. Generic audit and local-only
sync contain identifiers, status and version only. The UI is keyed by tenant,
user and role so an account handoff unmounts private modal state.

Creating, accepting and approving require an explicit acknowledgement of the
exact displayed pair. The UI keeps that pair and its frozen versions visible
even when candidate pagination changes. Safe failures preserve the attempted
intent for correction but never update it to a newer server version. Participant
self-service is available from the user menu for every employee role; managerial
decisions remain in the permission-gated schedule workspace.

## Migration and validation

The additive migration creates private requests, exclusive active claims,
immutable events, replacement lineage and invariant triggers. It does not invent
historical exchanges or infer consent from existing assignments. Adoption and
upgrade tests cover fresh and historical plaintext and encrypted databases.
Regressions cover claim inversion, competing decisions, stale versions, changed
or archived shifts, revoked sessions, replacement reuse, rollback, replay and
SQLite contention.

The shared three-actor web/Electron journey creates the employees and shifts
through the UI, requests an exchange, accepts it in Spanish, approves it through
an independent manager, reloads the requester session, checks audit privacy and
reconciles the replacements, events, claims and outbox against SQLite. Electron
runs against the in-process Fastify server and encrypted SQLCipher database.
These checks do not prove labor-law compliance, physical macOS coverage, payroll
correctness or usability with real employees.

## Consequences

- Consent and publication history remain attributable and reviewable.
- Approval is more expensive than two simple updates, but cannot expose a
  partially exchanged schedule.
- Bounded projections and separate private history reduce accidental workforce
  data disclosure.
- A distributed exchange protocol is intentionally deferred rather than
  weakening correctness for offline multi-device writes.

## Alternatives rejected

- **Mutating both owners in place:** destroys the originally published schedule
  and can violate overlap triggers halfway through the operation.
- **Manager-only reassignment:** omits recipient consent and is not an exchange.
- **Auto-accepting newer versions:** makes consent ambiguous after schedule edits.
- **Publishing notes or fingerprints in generic audit/sync:** exposes private
  schedule details without an operational need.
