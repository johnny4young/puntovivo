# 0034 — Restart the Server Worker After a Crash

**Language:** English · [Español](../es/architecture/0034-server-worker-restart.md)

> Status: Proposed
> Date: 2026-11-12
> Supersedes the "Unexpected exit" clause of [ADR-0032](./0032-embedded-server-worker-thread.md).

## Context

Under ADR-0032 any worker exit that `stop` did not request closes the app. A
crash mid-shift therefore closes the register until someone opens it again,
and the cashier has to sign in and rebuild the cart. Most crashes leave
nothing broken: SQLite rolls back the open transaction and the next worker
reopens the same database.

Two cases are different. A corrupt database or a key that no longer opens it
fails the same way on every start, so restarting only hides the damage. And a
crash that repeats every few seconds must not loop forever.

Sale completion is safe to retry. `sales.create` and `sales.completeDraft`
write the idempotency row as `succeeded` in the same SQLite transaction as the
sale and its fiscal intent. If the response is lost, the renderer keeps the
command envelope (no structured response) and a retry returns the stored
sale. If the worker dies before the commit, nothing of the sale is stored and
the reservation stays `processing`.

## Decision

Main restarts a server worker that dies after it has started serving.

| Situation                                                   | Action                                     |
| ----------------------------------------------------------- | ------------------------------------------ |
| Failure during the first start                              | Fatal, as before                           |
| Exit during `restartAround` (backup, restore, rotation)     | As before: the error returns to the caller |
| Unexpected exit while serving                               | Restart                                    |
| `SQLITE_CORRUPT`, `SQLITE_NOTADB`, an anchor or key failure | Fatal with a support code; never restarted |
| A fourth restart inside ten minutes                         | Fatal with a support code                  |

- **Backoff.** 0.5 s, 2 s and 8 s before the first, second and third restart
  in a sliding ten-minute window. Ten quiet minutes clear the count. A restart
  whose start fails counts as an attempt.
- **Same identity.** The new worker gets the same port, database key, anchor
  secret and JWT secret, so access and refresh tokens stay valid and the
  cashier is not signed out.
- **One worker at a time.** Crash recovery and `restartAround` share one
  queue; neither starts a worker while the other is running.
- **Cause.** The worker's crash handler sends the serialized error to main
  before the thread ends; a heap-limit exit is classified as `oom`. A native
  crash still ends the whole process (ADR-0032).
- **Renderer.** Main pushes `server:state` (`running`, `restarting`, `fatal`).
  While restarting, the status strip says the app is reconnecting and the
  charge buttons are disabled; the cart stays. When the server is back, every
  query is invalidated and one toast asks the cashier to check the last sale.
- **Abandoned reservations.** At boot the server marks `processing`
  reservations of the commands that complete inside their own transaction as
  failed. No owner can be alive at boot, and for those commands `processing`
  proves nothing committed, so a same-payload retry runs once at once instead
  of waiting for the 60 s lease. A different payload still conflicts.
  Commands that complete after their commit are left to the lease.
- **No blind retry.** Main never resends a call that was in flight. The
  renderer keeps its envelope, so the cashier's next "Charge" for the same
  cart either returns the stored sale or runs it once.

### Telemetry

Each exit appends one entry to `worker-crashes.ndjson` in `userData` (last
50): time, kind (`oom`, `uncaught`, `unknown`), exit code, closed error code,
uptime, calls in flight, restart attempt, outcome, fatal cause and app
version. No message text, tenant data or secrets. The same fields go to crash
telemetry when a DSN is configured. Operations shows "Server restarts: N in 7
days", and the diagnostic export includes the entries.

### Fiscal documents in flight

An ordered stop still waits 90 s for provider calls. A crash loses no
obligation: the fiscal intent is written in the sale transaction and the
fiscal worker resumes it when its lease expires. A real provider adapter must
query the document status (prefix and number, or CUDE/CUFE) before it resends
a document left `sent` without a verdict; it never reissues blindly or burns
a new number.

## Consequences

- A crash costs the cashier a few seconds of "reconnecting" instead of a
  closed app and a new sign-in.
- A broken database or key still stops the app, with a code support can act
  on.
- The crash log and the restart count make repeated crashes visible before a
  store reports them.

## Alternatives rejected

- **Keep every exit fatal.** Safe but turns a transient crash into a closed
  register mid-shift.
- **Unlimited restarts.** Hides a crash loop and can spin on a damaged
  database.
- **Resend the in-flight calls from main.** Main cannot tell whether a call
  committed; the envelope replay already answers that safely.

## Verification

- unit tests for the policy (backoff, loop, corruption and key failures), the
  lifecycle (same JWT secret, restart failures, shutdown, `restartAround`
  exclusion), the host's exit classification and the crash log;
- a real worker that crashes on a test message and frees its port;
- a server test that releases abandoned reservations only for transactional
  kinds and keeps payload conflicts;
- an Electron E2E that crashes the worker and completes the next sale in the
  same session.
