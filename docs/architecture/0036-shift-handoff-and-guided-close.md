# 0036 — Shift Handoff and the Guided Day Close

**Language:** English · [Español](../es/architecture/0036-shift-handoff-and-guided-close.md)

> Status: Accepted
> Date: 2026-11-16

## Context

A register changes hands during the day. Until now the outgoing cashier
closed the session with a blind count and the incoming cashier opened a new
one from nothing: the note, the parked sales and the drawer itself had no
link between the two sessions. At night the manager signed the day without a
place to say why a drawer was short, or to decide what happens to a sale
that is still parked.

The cash-session invariants stay as they are: one open session per tenant,
site and cashier and one per register, the in-transaction re-check before a
sale binds a session, `insertCashMovement` advancing the expected balance in
lockstep, and the blind close.

## Decision

**Handoff row.** `cash_session_handoffs` records one drawer passed from one
session to the next: the register, the outgoing session and cashier (name
frozen at signing), the blind count with denominations, the note, the parked
sale ids that pass on and the notices prepared for the next cashier (low
change from the two smallest denominations of the count, failed print jobs
at the site). The receiving columns stay null until someone receives it.

**Handing out reuses the close.** `handOutShift` calls `closeCashSession`
with a transaction hook, so the session close and the handoff insert commit
together. The outgoing cashier never sees the expected balance; the preview
returns the shift total and curve, never the expected cash.

**Receiving reuses the open.** `receiveShift` calls `openCashSession` with a
hook that, in the same `immediate` transaction, claims the handoff with a
conditional update (`to_session_id IS NULL`), checks that the register was
not opened again after the handoff, stores the recount and its difference
against the outgoing count, and reassigns the carried drafts. The open
keeps every existing precondition, so a cashier with another open drawer is
still refused. The difference between the two counts lives only on the
handoff row; neither session's over/short changes.

Two receive modes exist: recount the drawer that is there, or bring a new
float (the previous drawer goes to the office and no recount is stored). A
cashier who has a staff PIN confirms with it; one without a PIN is confirmed
by the authenticated session. The outgoing cashier cannot receive their own
drawer.

**Draft ownership.** Only drafts still parked and still owned by the
outgoing cashier move, with the same ownership rule `sales.listDrafts` uses
for cashiers (`suspended_by`, or `created_by` when that is empty). A draft a
manager took over in between stays where it is. Table checks never move:
any cashier at the site can already take them.

**Guided close.** `reports.dayClose.guide` gathers what the manager needs to
sign: the day in figures, closed and open registers, drawers that differed,
parked sales, DIAN status and high-severity anomalies. Two new decisions
are stored:

- A tenant-wide difference tolerance in `cashCloseSettings`. A closed
  session whose over/short exceeds it needs a reason (wrong change,
  unrecorded withdrawal, or other with a note) stored on the session.
  `dayClose.signOff` refuses the day while one is missing, and
  `operations.today` lists it as a before-close item.
- A parked sale can be left for tomorrow (`carried_over_at`), so the close
  stops asking about it that day. Discarding still goes through
  `sales.discardDraft`.

The signature is either a drawn PNG or the signer's staff PIN, stored on
`day_close_signoffs` next to the existing attestation. Once a day is signed,
its variance reasons can no longer change.

`shiftHandoffs.handOut` and `shiftHandoffs.receive` join the closed list of
critical commands in ADR-0002.

## Consequences

- Every handoff is auditable from both ends (`cash_session.handoff_out`,
  `cash_session.handoff_receive`) and appears in Hoy as a handoff entry.
- A register opened without receiving its handoff makes that handoff stop
  waiting; it stays in the history.
- The reassignment changes `suspended_by`, so the incoming cashier sees the
  drafts in the suspended list without a new visibility rule.
- The tolerance is tenant-wide; a per-site tolerance would need a new
  setting.

## Alternatives rejected

- **Keep one session across cashiers.** It would break the one session per
  cashier rule and mix two people's counts in one over/short.
- **Store the recount difference as an over/short on either session.** The
  outgoing session is already closed and signed; the incoming one has not
  sold yet. The difference belongs to the handoff.
