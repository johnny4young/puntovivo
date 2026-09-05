# ADR-0025: Explicit employee absences and scheduling exclusions

Status: Accepted

## Context

Employee absences affect staffing across sites. Treating a pending request as an
approval can block normal scheduling, while approving an absence over an existing
shift silently leaves contradictory obligations. An absence also must not rewrite
clock evidence or infer legal leave entitlements or salary deductions.

## Decision

### Explicit lifecycle and calendar evidence

A manager or administrator records a vacation, leave or absence request. Requests
begin pending and can be approved, rejected or cancelled. Approved requests can
be cancelled; rejected and cancelled requests are terminal. The employee cannot
approve their own request, even as an administrator. Managers cannot target or
read current administrator employees. Application roles remain unchanged.

The all-day interval is half-open: the first absent day is included and the return
date is excluded, with a maximum of 366 calendar days. The request freezes its
business time zone and real UTC boundaries. Calendar boundaries reuse the reporting
resolver, including LATAM transitions with a skipped midnight. A later tenant
zone change never reinterprets the original request.

Pending and approved requests cannot overlap for the same employee across sites.
Only approved requests block new or rescheduled shifts. Approval rejects an
existing scheduled shift overlap, including at another site; the operator must
resolve that shift explicitly. Cancellation removes the future scheduling block
but preserves the original approval evidence. Neither action modifies actual
clocked attendance, compensation or past labor cost evidence.

### Transactional decisions and privacy

Create and advance use the command envelope with an immediate SQLite writer.
Active tenant, actor role, employee, site and business-clock authority are checked
again under that writer. The current version and status are compared in the
update predicate. Private event, minimal audit, local-only outbox and command
completion share the transaction. A stable retry identity returns the committed
result after an uncertain response; a fresh command cannot repeat a terminal
transition. An archived employee/site can still have a historical request rejected
or cancelled, but cannot receive new requests or approvals.

Reasons and frozen before/after evidence live only in the private event table.
Generic audit, outbox and completion responses omit absence classification, dates
and explanation. Remote sync application is blocked; generic Electron table
bridges do not expose these tables. Reads authorize every bounded request/history
page by tenant and site and enforce the current target-role restriction. Unknown
storage failures return a safe translated error and preserve retry identity.

Private history is append-only through the command API, and SQLite triggers reject
accidental update or deletion through another application path. It is not a
cryptographic guarantee against an attacker able to replace the database schema;
the existing encrypted database and audit-chain boundaries still apply.

### Operator interface

The schedule page lazy-loads a dedicated absence view. Role-keyed mounts discard
private open forms/history after a staff handoff. Requests and history are paged;
creation uses the bounded employee picker and excludes administrator targets for
managers. Approval, rejection and cancellation each require a new explanation and
retain the exact version displayed when the decision began. Refetch cannot silently
advance that version or turn a committed action into another submission.

The UI distinguishes the included first day from the excluded return date and
warns against clinical details and sensitive attachments. Saving a request does
not approve it. An unsaved-change confirmation preserves entered values.

## Consequences and limitations

- The additive migration fabricates no absence, authorization or leave balance.
- Vacation and leave are operational classifications, not validated statutory
  entitlements, payroll concepts or diagnoses. No medical attachments are accepted.
- Worker self-service requests, partial-day leave and recurring availability need
  separate capability and scheduling contracts; management access is not granted
  to read-only application roles by this change.
- Approval and scheduling must keep using the same database writer boundary.
  Replacing these checks with preflight-only reads would reopen the race.

## Verification

Pure policy tests cover invalid dates, closed transitions and DST boundaries.
Real router tests cover tenant/role isolation, self-approval denial, cross-site
conflicts, overlapping commands, approval versus scheduling contention, fresh
actor/site/clock checks, rollback at each persistence fence, same-command replay
and post-commit response failure. Raw SQLite tests reject rewriting or deleting
private event evidence. Plaintext and encrypted historical upgrades
preserve actual attendance and retain approval/cancellation evidence on two boots.
UI tests cover private mounting, pagination, required input, version retention,
XSS-safe history, unsaved changes, safe errors and language parity. Shared web and
Electron journeys exercise actual UI creation, manager approval, cancellation and
reload. Execution evidence is recorded separately; these contracts do not certify
payroll, legal entitlements or physical platform compatibility.
