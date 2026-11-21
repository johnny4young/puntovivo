# 0036 — Mid-Day Register Handoff

**Language:** English · [Español](../es/architecture/0036-mid-day-register-handoff.md)

> Status: Accepted
> Date: 2026-11-21

## Context

A register changes hands during the day. Before this decision the outgoing
cashier closed the drawer and the next one opened it with a fresh float, so
nothing tied the two counts together, the note between them lived on paper and
suspended sales stayed owned by someone who had gone home.

## Decision

A handoff is its own row, `cash_session_handoffs`, written inside the existing
close and open use-cases.

- `cashSessions.startHandoff` closes the caller's session with a blind count
  by denomination and, in the same transaction, records a pending handoff with
  the count, an optional note, an optional named recipient and how it was
  signed. The response carries the count, never the expected balance.
- `cashSessions.receiveHandoff` opens the receiver's session on the same
  register. A kept drawer opens with the recount, and its difference against
  the outgoing count is read from both stored counts; a new drawer opens with
  its own float. The
  outgoing cashier's parked retail drafts at that site pass to the receiver,
  and the handoff becomes `received`, all in the open transaction.
- Opening that register any other way marks a pending handoff `superseded`.
  A partial unique index keeps one pending handoff per register.
- Each side signs with its staff PIN when one is enrolled, through the shared
  PIN throttle; without a PIN the authenticated session signs and the row says
  so.
- A manager explains a non-zero over/short of a closed session with a reason
  (`wrong_change`, `unrecorded_withdrawal`, `other` with a note), and can leave
  a parked draft for the next business day. Both are additive columns on
  `cash_sessions` and `sales`.

## Consequences

- One open session per cashier and per register, the labor-shift link, audit
  rows and journal effects stay owned by the open and close use-cases; the
  handoff hook returns its own audit effects to join their journal entry.
- A carried draft counts as carried only while `carried_over_at` is not older
  than `suspended_at`, so parking it again clears the decision without touching
  the suspend path.
- `operations.today` shows the handoff each register came from and every
  register handed over and still waiting. The next planned handoff names its
  receiver from the shift that starts at the same site within an hour of it,
  and stays unnamed when no one is scheduled.
- Restaurant checks keep their table-based sharing and are not reassigned.
- On the register, a register waiting to be received replaces Open on the
  primary key and the open shortcut, so opening it by habit does not discard
  the handoff. Each signer's PIN requirement comes from `cashSessions.mySigner`
  and the shift's sales from `cashSessions.myShiftSummary`, both scoped to the
  caller.
