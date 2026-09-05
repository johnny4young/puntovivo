# Recurring schedule drafts and atomic publication

Status: Accepted

## Decision

A recurring plan is a manager-authored draft, not an operational schedule, a
reservation of employee time, or proof of hours worked. Its explicit lifecycle is
draft → published or draft → discarded. Regeneration replaces only a draft's
occurrences and requires a private operational reason. Discard retains evidence;
it never cancels shifts. Published times remain frozen while later corrections
belong to the linked operational shifts.

The generator accepts at most 31 starting dates, 100 employee rules and 1,000
occurrences. The exclusive end bounds starting dates; an overnight occurrence can
end the next day. One-to-four-week cadence uses an explicit ISO Monday anchor,
not a locale-dependent week or the host timezone. The plan freezes its business
timezone. Nonexistent DST times are rejected; repeated wall times select the
earliest occurrence deterministically. Each shift is limited to 24 **real** hours.
The client checks syntax but must not replace this rule with nominal wall hours.

## Transaction and concurrency boundary

Create, regenerate, discard and publish are critical commands. A publication has
one Command Envelope and one immediate SQLite writer transaction for all its
shifts, occurrence links, plan transition, private event, minimal audit record,
local-only outbox and cached command result. Any failure rolls back the entire
publication. A retry with the same command identity cannot publish twice.

CPU-bound calendar and availability checks run outside the writer. Admission
compares the exact frozen intent and complete policy digest; the writer rechecks
current actor authority, tenant/site ownership, employee eligibility, locale,
absences, overlapping shifts and policy freshness. Versioned-WHERE transitions
reject stale intent rather than silently rebasing an operator's confirmation.

Header, occurrences and target authorization share one deferred SQLite snapshot,
including on the shared development DB. Current employee/site display names are
a separate minimal projection in that same snapshot. They are not copied into
private history or the publication digest. The immutable event insert guard binds
its actor to both the tenant and the actor of that specific plan transition; a
global user foreign key alone is insufficient.

## UI and privacy boundary

Managers can access only their current allowed employee roles; administrators
retain their broader existing authority. The employee picker is bounded and does
not call the administrator directory or expose email, PIN or compensation.
Plan pages use site-owned cursors, cleared before the first query for another
site. Preview cards are paginated rather than mounting all 1,000 occurrences.

The UI captures the displayed version for regeneration/publication/discard,
requires explicit publication acknowledgement, prevents duplicate or dismissible
pending decisions, and retains edited intent after a safe error. Read errors hide
cached private details. Tenant/staff/role handoffs unmount private local state.
Successful writes invalidate both plans and the operational schedule.

Private plan events retain frozen intent and operational reasons. Generic audit
and local-only sync payloads contain only identifiers, status, version and count;
they must not disclose employee schedules or notes. Generic audit remains
administrator-only. Recurrence does not confer payroll or legal entitlement.

## Migration and validation

The additive migration creates plans, occurrences, private events, scoped indexes
and invariant guards. It does not backfill manual shifts into invented plans.
Upgrade/adoption tests cover new and historical databases, including encryption.
Regressions cover stale versions, shared-DB snapshot races, actor attribution,
availability/absence changes, overlap, rollback, replay and SQLite contention.

The shared web/Electron journey drives creation, regeneration, explicit
publication, conflict rejection, discard and EN/ES reload through the real UI.
Web evidence additionally reconciles immutable events, exact shift links and
minimal audit/outbox rows against SQLite. These tests do not replace physical
macOS version coverage, employee pilots or external labor-policy review.
