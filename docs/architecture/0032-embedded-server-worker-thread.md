# 0032 — Embedded Server in a Worker Thread

**Language:** English · [Español](../es/architecture/0032-embedded-server-worker-thread.md)

> Status: Accepted
> Date: 2026-11-07

## Context

Packaged Electron runs the Fastify authority, tRPC, Drizzle and the
SQLCipher connection on the main thread, the same thread that owns windows,
menus, IPC, `safeStorage` and the updater. Every synchronous SQLite statement
and every tRPC/Zod/Drizzle step of a request therefore delays native UI work
and every renderer `ipcRenderer.invoke`.

A proof of concept on a loaded Apple Silicon machine (indicative figures,
20 sales through the real UI) measured:

| Metric                       | In-process | Worker thread | Utility process |
| ---------------------------- | ---------: | ------------: | --------------: |
| Main thread blocked          |      21.4% |          0.7% |            3.6% |
| Worst main-thread stall      |     249 ms |         16 ms |          234 ms |
| IPC round trip p99           |     131 ms |        1.6 ms |           18 ms |
| Idle footprint over baseline |          — |        +21 MB |          +46 MB |

Synchronous SQLite explained about 42% of the main-thread blocking; the rest
was the server's own JavaScript. Sale latency did not improve: the gain is
responsiveness, which matters most on the four-core, 4 GB Windows registers
Puntovivo targets.

`safeStorage` is available only in the main process. Since the async
`safeStorage` migration, the audit anchor state no longer calls it per
operation: the state file is sealed in-process with AES-256-GCM under a key
derived (HKDF-SHA256) from the keychain-sealed anchor secret, and only the
one-time conversion of a file written by an older build needs `safeStorage`.
No server code path needs `safeStorage` inside a SQLite transaction.

## Decision

Packaged and development Electron run the embedded server in one Node
`worker_threads` worker inside the main process. The renderer keeps talking to
the loopback HTTP listener; only the thread that serves it changes.

### Ownership

| Main thread                                                          | Server worker                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Windows, menus, tray, renderer protocol, CSP                         | Fastify listener, tRPC routers, Zod, application services               |
| Every `ipcMain` handler and its trust checks                         | Drizzle and the SQLCipher connection that serves the app                |
| `safeStorage` and every sealed envelope (DB key, anchor secret, hub) | Argon2 hashing and its warm-up                                          |
| Key rotation, cleartext migration, restore and backup file work      | Fiscal, outbox, realtime and sync workers that the server owns          |
| Auto-updater and its floor store                                     | The audit anchor file store (PVA1), opened with the secret it receives  |
| Session custody, Store Hub relay, peripherals and printing           | Desktop operations that need the database (settings, sync, drill reads) |
| Its own crash telemetry, and reports of worker exits                 | Server logs and telemetry, under the same crash policy as main          |

The packaged recovery rehearsal keeps creating its servers in the main
process: it never opens a window, so main-thread latency does not matter
there.

### Secrets

Main resolves the SQLCipher key, the anchor secret and the per-lifetime JWT
secret exactly as today and sends them in the worker's `start` message, never
in environment variables or argv. The worker keeps them only in memory and
never logs them. A restart sends them again; key rotation
happens while no worker runs, so the next worker receives the new key.

### `safeStorage` and the anchor store

The worker never calls `safeStorage`. Main runs the one-time legacy anchor
conversion before it starts a worker; the worker opens the PVA1 file store
with the anchor secret it received. Main sends a store location only when the
anchor secret comes from the keychain; installs keyed from the environment or
the development key run without an anchor store, as they do today. A failed
conversion leaves the old file in place and every audited write fails closed,
as it does today.

Exactly one thread may write the anchor file at a time. Restore replaces the
database and the anchor state only after the worker has exited, never while it
is stopping. If a future feature needs `safeStorage` from the server, it must
be an asynchronous request to main made outside any SQLite transaction;
blocking the worker with `Atomics.wait` inside a transaction is not allowed.

### Protocol

Main and worker exchange structured-clone messages over the worker port:

- requests carry an id, an operation name from a closed list and a payload;
- replies carry the same id and either a result or a serialized error
  (`name`, `message`, an optional closed `code`), never a raw object graph;
- the worker validates every payload, because the main-side caller is trusted
  but not infallible;
- when the worker exits, main rejects every request still waiting for a reply,
  and new requests fail at once until the next worker reports its URL.

The operation list replaces every place where main reaches into the server
object: the fixed authentication `inject` routes, access-token verification,
installation claim, owner recovery, the three main-recorded audit events,
`app_settings` reads and writes, the desktop sync bridge and the restore-drill
row counts. Code in main depends on an `EmbeddedServerHost` interface with an
in-process implementation (tests, rehearsal) and a worker implementation
(the app).

### Lifecycle

- **Start.** Main spawns the worker, waits for it to load, sends `start`, and
  resolves when the worker reports its listening URL. A failure during the
  first start is fatal, as it is today. A failure while `restartAround` starts
  the next worker goes back to the backup, restore or rotation caller, as it
  does today.
- **Stop.** Main sends `stop`; the worker closes the server, which drains
  requests, settles Argon2 work and closes the database, then exits on its
  own. Main waits for the `exit` event and terminates the worker only after a
  grace period longer than the fiscal adapter timeout. `terminate()` cannot
  interrupt a synchronous native call, so the bound holds between statements.
- **Restart around backup, restore and key rotation.** The existing
  `restartAround` choreography stops the worker, runs the operation, and starts
  a new worker with the same JWT secret, so sessions survive.
- **Unexpected exit.** Any exit that `stop` did not request, whatever its
  code, is fatal: main logs it, reports it to crash telemetry, shows the error
  dialog and quits, which is what a crash of the in-process server does today.
  Superseded by [ADR-0034](./0034-server-worker-restart.md): the worker now
  restarts unless the database or key is broken or it keeps crashing.
- **Crash policy in the worker.** The worker installs main's handlers: an
  unhandled rejection is logged and reported, not fatal; an uncaught exception
  ends the thread.
- **Errors.** Request errors cross the boundary only as serialized error
  codes; logs stay in the worker's logger.

### Native modules

`better-sqlite3-multiple-ciphers` 13 and `argon2` 0.45 are Node-API addons,
which Node loads in worker threads. Main still loads the SQLite addon for its
own short-lived connections (backup, rotation, drill snapshots), so the addon
runs in two environments of the same process. Scheduled backups and drill
snapshots now run beside the worker's writer, so their WAL checkpoint can wait
on a sale for up to its `busy_timeout` on the main thread; [ADR-0035](./0035-backups-off-the-main-thread.md)
moves that work off main. The native runtime verifier and
the packaged smoke must prove both addons load and work inside a worker under
the shipped Electron on every supported platform.

## Consequences

- Native UI and IPC stay responsive while the server works; sales are not
  faster.
- Worker memory is part of the Electron `Browser` process, so the existing
  `main` memory budget already counts it; the budget is recalibrated with the
  measured delta.
- A native crash inside the worker still ends the whole process, as it does
  today. Isolation from native crashes is the utility-process trade-off and is
  not part of this decision.
- Main-thread code can no longer touch the database directly. New desktop
  features that need data add an operation to the closed list.
- Main imports only the light `@puntovivo/server/desktop-main` entry and loads
  the packaged recovery rehearsal lazily. Otherwise main and worker would each
  evaluate the whole server graph: a measured +53 MB in main instead of +22 MB.
- Telemetry registers inside the worker with the server, so main registers its
  own adapter for its crashes and for a worker that dies.

## Alternatives rejected

- **Keep the server in-process.** Leaves the measured main-thread blocking and
  IPC tail in place on the slowest supported hardware.
- **`utilityProcess`.** Costs about twice the memory, adds a process to start
  and a second IPC hop, and its measured IPC tail was worse than the worker's.
  It stays the fallback if native-crash isolation becomes more important than
  memory.
- **Synchronous `safeStorage` through `Atomics.wait`.** Would keep the old
  anchor format but blocks the server thread on main inside a transaction and
  deadlocks if main is waiting on the worker.
- **Run SQLite alone in a worker and keep Fastify on main.** Moves only about
  42% of the blocking and adds a hop to every statement.

## Verification

- unit tests for the protocol, the lifecycle and the anchor-store split;
- `pnpm run ci:desktop`, including a gate that measures main-thread blocking
  and IPC round-trip p99 while the server works;
- the Electron memory gate with the recalibrated `main` budget;
- the packaged smoke on Linux, macOS and Windows through
  `build-desktop.yml`.
