# Explicit attendance reconciliation and operational cost

Status: Accepted

## Decision

Planned attendance and observed clock evidence remain separate immutable facts.
The system never infers an attended shift or a no-show from time overlap alone.
An authorized manager or administrator records an explicit, versioned decision
that links one published scheduled shift either to one attendance shift for the
same employee or to a `no_show` outcome. A past unreconciled plan is displayed as
`needs_review`; it does not become a no-show automatically.

The first decision freezes the scheduled-shift identifier, version, employee,
site, UTC endpoints and business timezone. Later revisions change only the
outcome or attendance link. Raw clocks, breaks and correction snapshots are not
rewritten. Reads apply the newest immutable attendance correction while keeping
the frozen plan for comparison. One attendance shift can belong to at most one
planned shift. Evidence from another site is permitted for the same employee but
is visibly marked as a site mismatch.

## Transaction, privacy and sync boundary

Recording or revising a decision is a manager/admin Command Envelope operation.
The immediate SQLite writer revalidates current actor authority, tenant, exact
plan version, attendance employee, time proximity and exclusive attendance
claim. Projection, private reasoned event, privacy-minimal audit, local-only
outbox and command completion commit or roll back together. Reconciled plans
cannot later be edited or deleted; append-only event and source-identity triggers
also protect direct SQLite paths.

Generic list, audit and outbox projections omit event reasons, employee notes,
clock details and compensation. Candidate evidence is same-employee, bounded to
20 nearby rows and excludes attendance claimed by another plan. Manager reads
are tenant-scoped, role-filtered, keyset-paginated and limited to 31 days per
request. The UI navigates seven-day windows with a 366-day history bound and a
120-day future bound; these are product navigation limits, not retention claims.
Remote reconciliation apply is blocked until there is a distributed ownership
model for the exclusive plan/attendance relationship.

## Operational labor cost boundary

Only administrators can request the regular operational cost projection. It
combines correction-aware attendance with explicit effective-dated employment
terms. Each attendance interval is clipped to the half-open requested report
window before pricing, preventing adjacent reports from counting a long shift
twice. Work is split at frozen contract-timezone boundaries, including daylight
saving transitions, and break overlap is subtracted from each segment exactly
once. Mixed currencies remain separate.

Missing terms, a monthly contract without an explicit costing rate, invalid or
overlapping boundaries and unsafe money ranges remain visible as unavailable
time or unavailable currency totals. They never become zero, select an arbitrary
rate, expose a believable partial aggregate or crash the endpoint. The projection
does not calculate statutory overtime premiums, benefits, taxes, deductions or
electronic payroll. It is not a payroll result and cannot approve compensation.

## Migration and validation

The additive migration creates the reconciliation projection and private event
ledger with indexes, foreign keys, checks and invariant triggers. It does not
invent historical outcomes. Fresh and historical plaintext and SQLCipher boots,
repeated restarts, migration stability, foreign-key checks and integrity checks
must preserve that absence of backfill.

Tests cover explicit attended/no-show decisions, revision, correction-aware
metrics, stale versions, future no-shows, claimed evidence, cross-tenant and role
probes, immutable SQLite paths, report-window partitioning, DST boundaries,
cross-boundary breaks, missing and overlapping terms, mixed currencies, money
overflow and administrator-only costing. Browser and Electron journeys validate
the user-visible round trip; they do not prove labor-law or payroll compliance.

## Consequences

- Supervisors must review ambiguous attendance rather than accepting a heuristic.
- Frozen plan history remains attributable even when clock evidence is corrected.
- Cost reports may show unknown time or an unavailable total; this is preferable
  to a financially plausible but unsupported value.
- The local-only relationship is intentionally conservative until multi-device
  conflict ownership can preserve exclusive claims.

## Alternatives rejected

- **Infer attendance from overlap:** can bind the wrong clock record and silently
  create no-shows when evidence is late or corrected.
- **Mutate the schedule or raw clock:** destroys the independent facts needed for
  audit, disputes and later corrections.
- **Choose one overlapping contract:** turns corrupt or unsupported terms into an
  arbitrary financial result.
- **Use monthly salary as an hourly divisor:** encodes an unvalidated statutory
  assumption and makes unknown costing look authoritative.
