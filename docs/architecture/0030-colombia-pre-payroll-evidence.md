# Colombia pre-payroll evidence and approval boundary

Status: Accepted

## Decision

Puntovivo provides an administrator-only Colombia pre-payroll workspace for
preparing, reviewing, and approving traceable internal evidence. It is not a
statutory payroll engine, an electronic-payroll transmitter, a PILA operator, or
legal/accounting certification. User-visible copy and exported data must retain
that boundary.

Employee payroll profiles are private, effective-dated records separate from
operational employment assignments. A profile correction ends or voids the
prior evidence and appends a successor/event; it never overwrites history.
Periods are half-open business-date windows of at most 31 days and must fit
inside one reviewed policy version. A regular run is unique per period.
Adjustment runs reference an approved original run and cannot silently generate
a second automatic salary; corrections require explicit reviewed concepts.

Every calculation creates a new immutable revision. A run advances monotonically
from `draft` to `reviewed` to `approved`, and approval freezes one exact complete
revision. Approved rows cannot be edited or deleted. Later corrections are new
adjustment runs, not mutation of approved evidence.

## Calculation authority and failure policy

The server derives the authoritative employee set from every non-voided payroll
profile and employment assignment whose effective intervals intersect the
period. It clips each employee to the common active interval and fails closed on
missing, ambiguous, cross-site, cross-country, or non-intersecting evidence. An
inactive employee remains part of a historical period when their effective
evidence overlaps it.

Hourly attendance is loaded as one bounded transaction snapshot, including
approved corrections, breaks, and reconciliations. Open, overlapping, or
oversized evidence blocks the employee or run instead of manufacturing hours.
Monthly amounts, reviewed contribution bases, withholding, benefit review, and
manual concepts remain explicit operator inputs. Monetary intermediates use the
shared two-decimal `roundMoney` contract.

Preparation returns a deterministic authority token over the exact run,
employee, profile, contract, attendance, correction, reconciliation, and policy
evidence shown to the administrator. Recalculation recomputes that token inside
the immediate write transaction before inserting any revision. A changed source
or employee set is a visible conflict; stale preparation never writes a
plausible result.

The Colombia policy registry is effective-dated and freezes its source URLs,
review timestamp, rates, thresholds, legal status, and explicit limitations in
each calculation revision. A period that crosses a policy transition or lacks a
reviewed policy is rejected. The current policy remains transitional and cannot
be described as a final legal determination.

## Privacy, transaction, and synchronization boundary

All profile, period, run, recalculation, review, and approval writes use the
Command Envelope. Actor authority, active tenant, business clock, domain rows,
private lifecycle event, privacy-minimal audit projection, and command result
commit or roll back together. Private reasons, identification data,
contribution entities, account suffixes, attendance detail, and calculation
source snapshots are omitted from generic audit and command-journal payloads.

Payroll tables are deliberately absent from the generic synchronization outbox.
Remote apply and multi-device replication remain blocked until encryption, key
exchange, conflict ownership, retention, and provider handoff have an explicit
reviewed contract. The schema reserves a constrained `sandbox_v1` provider-job
shape for compatibility testing, but no provider submission is exposed as a
shipped operational capability.

Reads are administrator-only, tenant-scoped, optionally site-scoped through the
shared tenant-site guard, keyset-paginated, and bounded. Run revisions and events
are capped; the UI clears private editor state after commit, cancellation, and
subject changes.

## Migration and validation

The additive migrations create normalized profiles, periods, runs, revisions,
employee results, source links, concept lines, lifecycle events, and constrained
provider-job storage. They do not invent historical payroll evidence. Immutable
and tenant-scope triggers protect direct SQLite paths. Transitional table
rebuilds use narrowly scoped legacy rename behavior and recreate the affected
external trigger so fresh, partially adopted, plaintext, and SQLCipher databases
converge on the same structure.

Unit and integration tests cover policy transitions, exact rounding, profile and
period overlap, tenant/site/role isolation, idempotent replay, stale versions,
atomic rollback, partial-period employees, exact authority tokens, overlapping
attendance, batched hourly evidence, immutable approval, and adjustment terms
frozen from the approved source. A shared Playwright journey drives the same
UI-to-tRPC-to-SQLite-to-reload lifecycle in Web and Electron, checks EN/ES and
accessibility, and verifies that generic evidence does not contain private
review material.

## Consequences

- Administrators must resolve every displayed blocker and explicitly review each
  contribution decision; Puntovivo does not infer missing legal facts.
- Historical evidence remains attributable even when current profiles,
  contracts, users, or policies change.
- A complete internal revision can support review and accounting handoff, but it
  is not permission to pay, file, or transmit statutory payroll automatically.
- Multi-device payroll and real provider compatibility remain unavailable rather
  than weakening privacy or silently choosing a conflict winner.

## Alternatives rejected

- **Calculate directly from the current employee list:** omits hires, exits, or
  inactive workers whose relationship overlaps the historical period.
- **Trust a UI-prepared employee array:** permits profile, contract, attendance,
  or policy changes between review and commit.
- **Edit an approved run:** destroys the evidence needed for audit and later
  correction.
- **Sync private payroll through the generic outbox:** lacks an acceptable key,
  retention, and conflict contract for sensitive employment data.
- **Describe configured rates as certified compliance:** automated tests cannot
  replace legal review, provider validation, PILA, DIAN, or a real payroll pilot.
