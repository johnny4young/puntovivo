# Testing and Release Validation

This document describes the current validation contract. It is an operational
reference, not a future-work tracker.

## Required workspace gates

Run commands from the repository root.

| Changed area                                        | Required command                     |
| --------------------------------------------------- | ------------------------------------ |
| Shared contracts                                    | `pnpm run ci:shared`                 |
| React or browser application                        | `pnpm run ci:web`                    |
| Fastify, tRPC, database, or server services         | `pnpm run ci:server`                 |
| Electron main process or preload bridge             | `pnpm run ci:desktop`                |
| Login, sales, inventory, import, or browser E2E     | `pnpm run test:e2e:web`              |
| Electron bootstrap, IPC, backup, or updater E2E     | `pnpm run test:e2e:electron`         |
| Release automation                                  | `pnpm run ci:release`                |
| Encrypted upgrade, downgrade, and restore rehearsal | `pnpm run rehearse:upgrade-recovery` |

The workspace CI commands include type checking, linting, tests, dependency
audit, and the build or runtime measurements appropriate to that workspace.

## Live UI requirement

Every user-facing change also requires a running-target smoke. The smoke must:

1. navigate to the affected surface;
2. assert the user-visible result or persisted round trip;
3. check browser console and uncaught page errors;
4. capture a screenshot when visual behavior changed;
5. exercise Electron as well when the change crosses the preload or main
   process boundary.

Component tests alone do not prove route mounting, bundled localization,
client-cache invalidation, or backend round trips.

## Current end-to-end boundaries

The browser suite covers the critical retail money path and administrative
journeys, including authentication, role gating, sales, refunds, voids,
purchases, inventory transfers, cash sessions, imports, approvals, loss
prevention, staff attendance, variants, serials, and day-close sign-off.

The Electron suite launches the real desktop runtime and validates the
renderer sandbox, embedded server, authenticated application boot, encrypted
backup creation, cloud-vault write, scheduling, and restore readiness.
Node-side Electron tests additionally pin Store Hub URL policy, OS-keychain
sealing, owner-only credential-envelope permissions, refresh rotation after an
app restart, rejected-session cleanup, exact-token IPC registration, and the
fixed-destination API proxy's header/path restrictions.

## Release-candidate additions

Automated gates are necessary but not sufficient for a desktop release. A
release candidate also needs:

- manual package validation on Linux, macOS, and Windows;
- signing and notarization verification where credentials are available;
- clean install and upgrade from the previous production version;
- database migration and downgrade-refusal checks;
- backup and restore rehearsal using production-equivalent data volume;
- printer, drawer, scanner, and terminal checks for every supported device;
- review of known limitations in `PROJECT-STATUS.md` and the release notes.

Run `pnpm run rehearse:upgrade-recovery` for the database migration item. It
builds a verified v1.7.0 encrypted fixture with two tenant graphs, upgrades it
through the current migration journal, verifies a second idempotent boot, and
launches the historical build contract in an isolated process to prove that a
downgrade is refused without modifying the database. It then adds
current-schema attendance, approval, privacy, staff, and serialized-inventory
sentinels; creates a production-format encrypted ZIP; extracts it into a
separate installation directory; rekeys the staged database to a fresh
installation key; and boots the restored database through the real server.

The report proves historical and current-domain fingerprints, tenant
separation, device-identity preservation, key separation in both directions,
source-database immutability, bundle size/hash, snapshot time, and elapsed
backup/restore time. The command writes the sanitized report under the ignored
`.artifacts/recovery-rehearsal/` directory; retain it with release-candidate
evidence. The report must never contain either SQLCipher key, credentials,
device identifiers, absolute paths, or raw business rows.

## Failure reporting

Record the exact command, runtime, operating system, failing test, and whether
the failure came from project code or the execution environment. Do not report
a gate as passing when it was skipped, interrupted, or replaced by a narrower
test.
