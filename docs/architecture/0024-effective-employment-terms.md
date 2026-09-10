# ADR-0024: Effective employment terms and private evidence

Status: Accepted

## Context

An employee's job, site and agreed compensation can change without changing
application permissions. Overwriting the current wage destroys the evidence needed
to explain a past cost estimate. A missing monthly hourly equivalent is unknown,
not zero, and cannot justify inventing a statutory salary divisor.

## Decision

### Effective dates and corrections

Employment terms are explicit, tenant-owned records with business-calendar
half-open intervals: the start is included and the end is excluded. A null end is
open-ended. One employee cannot hold overlapping active terms across sites.
The record freezes its business time zone and currency. Job positions do not
grant roles; employees with viewer access can have employment assignments.

Create, end, replace and void execute through the command envelope and an
immediate SQLite write transaction. The writer rechecks the active administrator,
tenant, employee and site authority, version and interval constraints. Audit,
minimal local outbox and command completion commit together. Role guards precede
replay; a safe error boundary also wraps command reservation/recovery failures.

A replacement closes the predecessor on the new start and creates its successor
for the same employee, preserving the original exclusive end and time zone.
Historical compensation remains unchanged. Ending or voiding a record retains
private before/after events with author, reason and operation identity. An archived
site can have historical terms ended or voided, but cannot receive new terms.
Voiding erroneous terms never deletes their evidence or rewrites attendance.

### Privacy and transport

Administrators alone can read compensation, full records and private event history.
Managers receive a separate explicit assignment projection, excluding administrator
employees and all compensation, currency, private reasons and authors. Queries are
tenant-scoped, and supplied sites are validated. Lists and history use bounded
keyset pages rather than unbounded client-side filtering.

General audit and local-only outbox carry lifecycle kind, identity, site and version,
never the private terms or reasons. Remote application of employment contracts is
blocked. Private events are append-only through the command API, and SQLite
triggers reject accidental update or deletion through another application path.
This does not claim protection against an attacker able to replace the database
schema itself. Existing database encryption and audit-chain boundaries remain authoritative.

### Monetary and UI behavior

Hourly and monthly pay are explicit nonnegative amounts with at most two decimals.
Monthly operational hourly costing is optional. Unknown costing stays null and
cannot silently become zero or a country-specific salary divisor. The pure
regular-time estimator is not certified payroll or a statutory entitlement engine.

The lazy workforce UI mounts private administrator and manager-safe components
separately, keyed by operator identity and role. Employee search and history are
paged. Lifecycle forms retain the selected optimistic version and freeze the
currency attached to entered amounts. A failed background context refresh must
not unmount a dirty form; initial load failure and refetch failure are different
states. Stale versions require an explicit refresh rather than a silent overwrite.

Cards and frozen history render two decimal places explicitly: runtime currency
catalog defaults can otherwise round away accepted cents. UI amounts never
relabel or convert automatically when the tenant currency changes.

## Consequences and alternatives

- No salary or employment status is inferred during migration or backfill.
- Separate assignment reads reduce accidental disclosure compared with client-side
  redaction of one privileged response.
- Effective records and private events cost more storage than mutable employee
  columns, but preserve the evidence needed for reasoned corrections.
- General audit remains useful without becoming a second compensation database.
- These records are not legal employment documents, certified payroll, or proof
  of regulatory compliance. External review remains necessary for those claims.

## Verification

Storage and upgrade tests cover additive migration, explicit money, interval
overlap, archived sites, tenant isolation, raw event mutation rejection and rollback. Transport tests cover
role boundaries, bounded reads, safe projections, idempotency and reservation
failures. Component tests cover lifecycle inputs, stale versions, duplicate
confirmation, context-refresh recovery, hidden pay-basis fields, cents, escaping
and private history. Live web evidence exercises create, replace, end, void,
administrator/manager handoff and reload against an isolated SQLite database.
These checks do not substitute for final web/Electron release qualification.
