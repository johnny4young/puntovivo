# Effective recurring employee availability

Status: Accepted

## Decision

Availability is an explicit employee-global scheduling constraint, not inferred
from contracts, actual attendance, medical information, or a site's opening hours.
It neither records worked time nor establishes paid leave or statutory entitlement.
Managers and administrators manage availability. Managers cannot manage or read a
current administrator's policy; cashiers and viewers do not receive management
capabilities. A minimal employee projection excludes pay, email and PIN metadata.

A policy captures its business timezone and a half-open effective calendar period.
Its optional null end intentionally supports indefinite weekly recurrence. Weekly
slots use ISO weekdays (Monday = 1) and half-open local minutes from 0 through 1440.
Overnight availability is represented by two day slots; adjacent slots can join,
while duplicate or overlapping slots are invalid. At most 56 slots are accepted.
An empty slot set explicitly means unavailable throughout the effective period.
Outside any configured period, historical scheduling behavior is preserved; a
migration never invents availability for existing employees.

Every real minute of a scheduled shift intersecting a policy must be available.
Both occurrences of repeated DST wall minutes follow the same weekly rule. Skipped
minutes are not invented, including skipped midnight in LATAM zones. Shifts remain
bounded to 24 real hours by the scheduling contract. Unsupported historical
odd-second timezone offsets fail closed rather than approximating a decision.
Availability never overrides an approved absence or permits an overlapping shift.

## Effective changes and evidence

Creation takes effect only after an explicit command succeeds. Replacement splits
an existing active period strictly inside its dates and creates a linked successor
with new weekly slots. The successor inherits the original frozen timezone and end
so a locale change cannot reinterpret the existing agreement. The preceding period
remains active for its original dates. A separate void command explicitly removes
a restriction and can preserve/void records after employee archival. Neither
operation cancels or modifies scheduled shifts or actual attendance.

A versioned-WHERE update, private immutable event snapshot, minimal generic audit,
local-only outbox and command completion share one immediate SQLite transaction.
Replacement's old-period end and new-period creation are indivisible. Replays use
the command envelope rather than reapplying a transition. Event history preserves
the original dates, slots, explanation and employee reference; generic transports
carry only identity, status and version. Remote application is blocked until a
cross-device conflict/admission protocol exists. SQLite triggers reject accidental
update or deletion of event rows through another application path; this is not a
cryptographic guarantee against replacement of the database schema itself.

## Bounded reciprocal validation

A new shift evaluates effective policies while holding the existing schedule
writer. A new availability policy must also admit all already-scheduled shifts
in its effective period, across all sites. It never silently cancels conflicting
shifts to make a policy fit.

Historical shift validation reads keyset pages of 50 rows using the
`(tenant_id, user_id, status, id)` index. Wall-clock evaluation yields between
individual shifts outside the writer. A per-command SHA-256 fingerprint covers
exactly the validated row identities, UTC boundaries and versions. The immediate
writer rechecks actor/employee/tenant/clock authority and recomputes that fingerprint
using bounded pages before changing availability. Insertions, deletions or updates
behind the preflight cursor fail closed and require a fresh decision. The fingerprint
is not a persistent cache or an integrity verdict against arbitrary database writers.

## Validation boundary

The management UI is lazy-loaded from the schedule page. Its employee picker uses
the minimal authorized workforce projection, never the administrator directory.
Explicit overnight windows are split into canonical day slots, including the
Sunday-to-Monday boundary; an empty week requires a separate acknowledgement.
Forms freeze the selected version and preserve entered values on failed decisions.
Staff or tenant handoff unmounts the private form and history. The row label means
configured, not currently available: past effective periods retain their evidence.

Schedule admission and workforce failure messages share the lazy workforce error
dictionary. The weekly schedule loads it before enabling decisions, including
the first failure after direct navigation; these feature messages do not inflate
the offline login/error-boundary dictionary. Generic bootstrap errors stay eager.
Schedule decision errors are rendered inside their active dialog and persist
until retry or dismissal; a toast behind a modal backdrop is not usable failure
feedback, even when a DOM visibility assertion succeeds. While a decision is
pending, Escape, backdrop, close buttons and duplicate submissions are blocked
so a late response cannot be displayed as the result of a different decision.

Pure tests cover complete-minute coverage, gaps, adjacent and overnight windows,
DST, effective boundaries, fractional instants and malformed inputs. Real router
tests cover tenant/role restrictions, reciprocal schedule admission, competing
commands, storage-fence rollbacks, lost responses and SQLite writer contention.
A raw-SQL regression rejects event history rewrites and deletions. A 120-shift
case covers multiple pages, event-loop yields, the indexed query plan
and changes behind the cursor. Plaintext and encrypted historical upgrade tests
verify no inferred preferences, preserved attendance, self-linked successors and
repeatable restarts.

Component and cross-runtime journeys cover the editor, explicit replacements,
voiding, private history, safe retry and schedule admission. These tests do not
qualify schedule publication, shift swaps, payroll, a human pilot or a release
candidate; full gate evidence must correspond to the exact candidate under review.
