# 0035 — Build Backup Bundles Off the Main Thread

**Language:** English · [Español](../es/architecture/0035-backups-off-the-main-thread.md)

> Status: Proposed
> Date: 2026-11-12

## Context

ADR-0032 moved the server to a worker but left scheduled backups and manual
backups on the main thread. `createBackupBundle` runs a `wal_checkpoint(FULL)`
that can wait up to its 5 s `busy_timeout` on a sale, a `VACUUM INTO` that
decrypts and re-encrypts the whole database in one native call, an
`integrity_check` and the zip. On a register without AES-NI that is software
AES on the thread that paints the window.

## Decision

Every backup bundle is built in a short-lived `worker_threads` worker that
main starts for that bundle and that exits with it.

- Main keeps what it owns: the scheduler, the operation queue, `safeStorage`,
  the cloud vault and IPC. The worker receives the database path, the key, the output path, the device id path, the passphrase and the manifest by message, never through
  argv or the environment, and runs the same `createBackupBundle`; the bundle
  format does not change.
- Cancellation crosses the boundary as a `cancel` message, checked between
  steps. A native call already running finishes first; the staging directory
  is removed by the bundle code or by the startup sweep.
- Before staging, the bundle checks that the staging and destination volumes
  each have twice the database (plus WAL) free and fails with
  `BACKUP_DISK_SPACE_LOW` otherwise.
- A scheduled snapshot that is due waits while a sale completed in the last
  two minutes, for at most two hours. Main learns of sales from the API
  responses it already sees.
- The native verifier and the packaged smoke load the SQLite addon in main
  and in two concurrent workers, which is what main, the server worker and a
  backup worker do at once.
- Restore and key rotation do not change: they still run inside
  `restartAround` with the server stopped.

The audit anchor state is not part of the bundle. Restore reads the audit
chain heads of the restored database and replaces the anchor state only after
the operator trusts that restore, so the bundle does not need it.

## Consequences

- The window stays responsive while a backup runs; the backup itself is not
  faster and still uses one core.
- Each backup briefly adds one more addon environment and its SQLite page
  cache to the process.
- The restore drill still extracts and checks its snapshot on main; it
  runs only when an admin asks for it.
- `VACUUM INTO` keeps a read transaction open for its whole run, so the WAL
  cannot be truncated until it ends; the soak measures WAL growth.

## Alternatives rejected

- **Run the backup in the server worker.** It would block sales for the whole
  `VACUUM INTO`.
- **`utilityProcess`.** Better isolation from a native crash, about 40 MB more
  for the run and one more hop. It stays the fallback if three addon
  environments in one process cause problems on the target hardware.

## Verification

- a worker-built bundle that extracts, passes `integrity_check` and keeps
  every row;
- the worst main-thread stall during a worker backup stays under 100 ms and
  under the in-thread backup's;
- cancellation by message, a worker that dies without a result, the quiet-till
  deferral and its two-hour cap;
- the native verifier with two concurrent workers, and the packaged smoke
  checking `backup-worker.cjs` on Linux, macOS and Windows.
