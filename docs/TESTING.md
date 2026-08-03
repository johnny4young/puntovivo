# Testing and Release Validation

This document describes the current validation contract. It is an operational
reference, not a future-work tracker.

## Required workspace gates

Run commands from the repository root.

| Changed area                                        | Required command                                |
| --------------------------------------------------- | ----------------------------------------------- |
| Shared contracts                                    | `pnpm run ci:shared`                            |
| React or browser application                        | `pnpm run ci:web`                               |
| Fastify, tRPC, database, or server services         | `pnpm run ci:server`                            |
| Electron main process or preload bridge             | `pnpm run ci:desktop`                           |
| Login, sales, inventory, import, or browser E2E     | `pnpm run test:e2e:web`                         |
| Electron bootstrap, IPC, backup, or updater E2E     | `pnpm run test:e2e:electron`                    |
| Release automation                                  | `pnpm run ci:release`                           |
| Encrypted upgrade, downgrade, and restore rehearsal | `pnpm run rehearse:upgrade-recovery`            |
| One packaged desktop recovery rehearsal             | `pnpm run rehearse:packaged-recovery -- <args>` |

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

`operator-journeys.json` is the executable index for the ten shift-defining
journeys: first sale, suspended cart, split tender, manager approval, refund,
blind cash close, signed day close, purchase receiving, inter-site transfer,
and secure operator switching. Each entry owns an exact Playwright file/title
and declares its role, language, viewport, interaction, and continuity
coverage. `scripts/check-operator-journeys.mjs`, invoked by `ci:web`, fails when
an indexed test disappears, its title drifts without updating the contract, a
required journey is removed, or the matrix loses a required operating variant.
The contract indexes real flows; it does not replace their browser execution.

The operational recovery contract is defined in
`packages/shared/src/operational-readiness.ts`. It covers synchronization,
fiscal delivery, receipt hardware, electronic payments, encrypted backup, and
desktop updates. `scripts/check-operational-readiness.mjs`, invoked by the web
CI gate, fails when any service loses its explicit owner, response target,
threshold, runbook anchor, recovery route, or exact executable drill title.
The Operations browser smoke verifies that the same contract is visible in
English and Spanish and that recovery actions reach the owning surface. It
also inserts a real declined payment outbox incident, retries it as an
administrator, verifies the audit event and non-failure status, and confirms
that the invalidated attention count falls in the browser. The same drill proves
that aggregate task measurement records one `recover_operation` success with a
succeeded recovery outcome. This pins the signal → action → mutation → measured
outcome → refreshed queue loop rather than navigation alone.

The Electron suite launches the real desktop runtime and validates the
renderer sandbox, embedded server, authenticated application boot, encrypted
backup creation, cloud-vault write, scheduling, and restore readiness. Ten
target-agnostic operator journeys run against either the development bundle or
a packaged desktop application: first sale, suspended cart, split tender,
manager approval, blind cash close, signed day close, refund, and purchase
receiving, inter-site inventory transfer, and secure staff handoff. The manager
approval journey keeps the exact cashier checkout mounted while a different
eligible manager presents a fresh PIN, then proves one-use grant consumption
and correlated immutable request, approval, and consumption audit evidence. The
signed-close journey verifies the stored PDF response and proves that the
signer and evidence hash remain immutable after a renderer reload and fresh
authentication. The refund journey proves direct manager authority, visible
inventory restoration, and immutable actor-and-reason audit evidence after
re-authentication. The purchase-receiving journey proves the completed receipt
details, exact aggregate and site stock effects, and immutable actor-attributed
receipt evidence after a fresh authentication. The transfer journey proves an
exact source debit, in-transit custody, a discrepant destination receipt, the
resulting aggregate and per-site stock, and immutable actor-attributed
create/receive evidence after a fresh authentication. The staff-handoff journey
proves that an administrator can enroll a cashier PIN and yield the same
terminal without leaking privileged route access, while the selected cashier
survives renderer reload and the actor/target audit row remains available after
fresh authentication.
Node-side Electron tests additionally pin Store Hub URL policy, OS-keychain
sealing, owner-only credential-envelope permissions, refresh rotation after an
app restart, rejected-session cleanup, exact-token IPC registration, and the
fixed-destination API proxy's header/path restrictions. Shared, web, server,
and Electron tests also pin incremental SSE framing, Authorization-bearing
fetch, Store Hub refresh-and-retry, bounded reconnect with `Last-Event-ID`,
stream cleanup, and `sessionVersion` revocation. The web E2E suite opens the
real KDS stream, verifies its Bearer header, revokes that session, and observes
the canonical login redirect after server revalidation.

The server and desktop CI gates also consume
`perf-budget.json::operationalProfile`: the server measures a maximum-size
launch-product preview/commit; desktop tests time an encrypted 5,000-row backup
round trip and enforce a bounded recovery queue; the Electron runtime gate
checks boot elapsed time together with main/renderer memory. See
`PERF-BUDGETS.md` for thresholds and the packaged-artifact boundary.

## Hardening evidence map

The current product hardening baseline is represented by durable, executable
contracts rather than by a standalone manual checklist:

| Quality boundary                          | Canonical evidence                                                                                                                     | Gate                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Operator Deck adoption                    | `scripts/check-operator-deck-adoption.mjs` and its regression tests                                                                    | `ci:web`                                                        |
| Shift-defining operator journeys          | `operator-journeys.json`, the indexed browser flows, and the ten target-agnostic Electron ports                                        | `ci:web`, `test:e2e:web`, and `test:e2e:electron`               |
| Accessibility and adaptive layouts        | `e2e/web/a11y.spec.ts`, `assistive-technology.spec.ts`, `navigation-responsive.spec.ts`, and `payment-drawer-responsive.spec.ts`       | `test:e2e:web`                                                  |
| Dense data behavior                       | `e2e/web/design-system-scale.spec.ts`, including the 1,000-row bounded table contract                                                  | `test:e2e:web`                                                  |
| Migration journal integrity               | `migrations-parity.test.ts`, `migration-tracking.test.ts`, and `scripts/ensure-migrations-bundled.mjs`                                 | `ci:server` plus `ci:desktop`                                   |
| Query plans and store-scale latency       | `perf-store-profile.test.ts`, `perf-trpc-latency.test.ts`, and `perf-budget.json`                                                      | `ci:server`                                                     |
| Desktop continuity and recovery           | `recovery-rehearsal.test.ts`, the encrypted recovery rehearsal, and the Electron runtime memory/launch gate                            | `ci:desktop` plus `rehearse:upgrade-recovery`                   |
| Packaged encrypted recovery               | `packaged-recovery-rehearsal.test.ts`, `run-packaged-recovery-rehearsal.mjs`, and candidate evidence validation                        | `ci:desktop`, `ci:release`, plus the full manual desktop matrix |
| Recovery ownership and executable actions | `packages/shared/src/operational-readiness.ts`, `scripts/check-operational-readiness.mjs`, and `e2e/web/operational-readiness.spec.ts` | `ci:web` plus `test:e2e:web`                                    |
| Authenticated realtime continuity         | shared SSE parser tests, server SSE tests, Electron Store Hub tests, and `e2e/web/realtime-auth.spec.ts`                               | workspace CI plus `test:e2e:web`                                |
| Full dependency-graph advisories          | `pnpm audit --audit-level low`                                                                                                         | each workspace CI gate                                          |

This map proves that the local development and automated validation baseline
remains covered. It does not replace the multiplatform packaging, signing,
provider certification, physical-device, or controlled-pilot evidence required
for release readiness.

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

The manual **Build Desktop** workflow accepts only a complete 40-character
candidate commit SHA. Every selected platform checks out that exact commit. A
full build clears the package output, creates the platform installer, runs the
full packaged-runtime smoke (including native-module structure), runs a
packaged-renderer first-login journey, executes encrypted recovery inside the
packaged Electron binary, and uploads:

- the exact `Puntovivo-<version>-<os>-<arch>` installer;
- its blockmap when electron-builder emits one;
- the matching `latest*.yml` update feed;
- `packaged-recovery-<os>-<short-sha>.json`;
- `candidate-evidence-<os>-<short-sha>.json`.

The evidence manifest binds the candidate SHA to the exact package version,
platform, architecture, artifact names, byte sizes, SHA-256 checksums, and
matching update-feed reference. It also recomputes the installer SHA-512 and
size and requires them to match the values electron-updater will enforce.
Collection fails if the checkout differs from the requested SHA, the expected
installer/feed is missing, the feed points at another version, its integrity
metadata differs from the installer, or the packaged structure, runtime, or
renderer smoke did not pass. It also fails unless the packaged recovery report
belongs to the same SHA, version, platform, and architecture and passes every
recovery check described below. The renderer journey is required on Linux,
macOS, and Windows. It proves the secure custom renderer origin, preload
bridges, embedded API access, first-run authentication, and the data-backed
post-login landing. It uses a random per-run SQLCipher key plus a temporary
Chromium credential store so UI automation does not depend on runner keychain
prompts; the separate runtime smoke keeps exercising the normal OS-key-store
startup path. This exact-name contract prevents stale local output from being
reported as current evidence.

Distribution trust is now measured rather than declared. On macOS the collector
runs the host's own tooling against the packaged bundle — `codesign --verify
--deep --strict`, `xcrun stapler validate` and `spctl --assess` — and records
one of four verdicts plus the per-check evidence:

- `trusted` — signed, notarized, and accepted by Gatekeeper.
- `signed-not-notarized` — a valid signature without a stapled ticket. This is
  what the manual workflow produces, because it ad-hoc signs so the runtime
  smoke can launch the app and never loads release signing credentials.
- `untrusted` — the signature did not verify, or the tooling could not answer.
  A tool that is absent is recorded as unknown and never counted as a pass.
- `unsupported-platform` — Linux and Windows, whose trust models this collector
  does not assess. It is reported as its own state so it cannot be mistaken for
  either a pass or a failure; verify those hosts separately with the Windows
  signature verifier before accepting a candidate.

The verdict is reported, not enforced: an untrusted manual build is the expected
outcome and must not fail evidence collection. Only `trusted` on every required
platform clears the release gate, and reaching it requires the release workflow
with real Developer ID material — ad-hoc signing remains validation-only.

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

### Packaged encrypted recovery evidence

The full manual **Build Desktop** workflow runs the recovery-only mode of the
actual packaged executable on every selected operating system. It does not run
the source-level Node rehearsal and does not open the operator's database. The
host wrapper creates isolated temporary storage, launches the package with an
explicit recovery authorization flag, validates the resulting report, copies
only that sanitized report into `out-builder`, and removes the temporary
installation.

The immutable `retail-annual-medium-v1` profile represents one active retail
location for a year: 2,500 products, 10,000 customers, 365 closed cash
sessions, 50,000 completed sales, 150,000 sale lines, and 50,000 payment rows.
The package must:

1. create the current schema from its bundled migrations and seed the full
   profile into a SQLCipher database;
2. create and integrity-check the production ZIP backup format;
3. reject an unrelated encryption key without changing the valid snapshot;
4. reject a ZIP whose encrypted database entry was truncated;
5. restore and rekey into a separate installation, then boot that copy through
   the packaged server graph;
6. fingerprint every representative business row before and after restore;
7. prove the original database byte hash is unchanged after the recovery;
8. record the app version, database schema version, platform, architecture,
   recovery time, and snapshot age without paths, keys, credentials, device
   identities, or business rows.

For a package already built on the current host, run:

```bash
pnpm run rehearse:packaged-recovery -- \
  --against-packaged apps/desktop/out-builder \
  --candidate-sha "$(git rev-parse HEAD)" \
  --output .artifacts/packaged-recovery/current-platform.json
```

A local pass proves only that package and host. Cross-platform readiness still
requires one fresh full workflow run for Linux, macOS, and Windows against the
same 40-character SHA. Do not copy a report between platforms or translate a
source-level rehearsal into packaged evidence.

The most recent retained cross-platform proof is manual workflow
[run 30764351491](https://github.com/johnny4young/puntovivo/actions/runs/30764351491)
from 2026-08-02 against candidate
`fc0439d533e38ddfc12393518569f68c1a2613fd` (app `1.9.0`, database schema
`35`). Linux x64, macOS arm64, and Windows x64 each passed package creation,
the native/runtime and first-login renderer smokes, and all nine encrypted
recovery checks over the 262,865-row profile. The downloaded manifests were
revalidated against their actual installer, update-feed, and recovery-report
hashes; each rejected a wrong key and corrupt bundle, preserved the source
database, and booted the restored copy. These are validation-only manual
candidate artifacts: they prove runtime and recovery behavior, not release
signing, notarization, certification, or a production recovery-time commitment.

If any recovery check fails, the host wrapper copies the bounded failure report
before returning non-zero, and the artifact step still uploads it with the
workflow logs. Promotion remains blocked. The package never swaps the source
database, so the immediate rollback is to keep distributing the last trusted
release and preserve the original encrypted database plus its last known-good
backup. The operator should classify the stable `failureCode`, reproduce against an
isolated copy on the failing OS, and escalate database-integrity, wrong-key,
or source-mutation failures before another candidate is built. No failing
candidate may be promoted by rerunning only the successful platforms.

## Failure reporting

Record the exact command, runtime, operating system, failing test, and whether
the failure came from project code or the execution environment. Do not report
a gate as passing when it was skipped, interrupted, or replaced by a narrower
test.
