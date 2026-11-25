# 0037 — Guided Day Close

**Language:** English · [Español](../es/architecture/0037-guided-day-close.md)

> Status: Accepted
> Date: 2026-11-21

## Context

The day close was a report page with a checkbox attestation. A register
difference could be signed without a reason, parked sales stayed parked
forever, and the signer left no trace of how they signed. The handoff work
added a reason for a closed difference and a carry-over flag for parked
sales, but nothing required either before signing.

## Decision

- `reports.dayClose.preview` gains two readiness blockers:
  `unexplained_differences` (a session closed that day with a non-zero
  over/short and no reason) and `unresolved_drafts` (a retail draft parked
  before the day ended that was neither discarded nor left for tomorrow at that
  day's close; a carry decided for an earlier day does not count, so each close
  decides again).
  Restaurant checks stay with their table and do not count. There is no
  configurable tolerance: any difference beyond the cent epsilon needs a
  reason.
- `reports.dayClose.checklist` returns the per-register and per-draft rows the
  guided close acts on. The signed snapshot keeps only totals, so the rows are
  read live and are not hashed.
- `reports.dayClose.signOff` accepts an optional signature: the staff PIN,
  verified through the shared PIN throttle, or a drawn signature as SVG path
  data restricted to absolute moves and lines. Without one the authenticated
  session signs, as the report page does. `day_close_signoffs` gains
  `signature_method` and `signature_path` through an additive migration; they
  sit outside the hashed report snapshot, and the PDF names the method.
- Hoy opens the guided close for a business day through `?close=`, and
  the report page links each new blocker there.

## Consequences

- Both surfaces read the same readiness, so the report page cannot sign a day
  the guided close would refuse.
- Old sign-offs read as `session`; their hashes do not change.
- A store with old parked drafts must discard or carry them before its next
  signature.
- The owner summary is built on the device and opens WhatsApp with totals only;
  no service is called.
