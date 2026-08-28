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
| Bounded critical browser contract                   | `pnpm run test:e2e:web:critical`                |
| Login, sales, inventory, import, or browser E2E     | `pnpm run test:e2e:web`                         |
| Long-shift renderer lifecycle or leak-sensitive UI  | `pnpm run test:e2e:web:soak`                    |
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

The same contract selects one executable journey for each shift-critical area
under `criticalE2E`: first sale for selling, exact manager approval for control,
immutable signed day close for closing, and discrepant inter-site transfer for
stock. Those four tests carry the `@critical` Playwright tag and run serially
through `pnpm run test:e2e:web:critical`. The contract checker keeps the subset
at four or fewer, rejects missing area coverage or tag drift, and prevents a
fifth tagged journey from silently expanding the CI budget. Push and pull-
request web CI runs this bounded subset after `ci:web`; the complete browser
suite remains the local requirement for any affected login, sales, inventory,
import, or browser flow.

The opt-in `test:e2e:web:soak` contract keeps one authenticated renderer alive
instead of reloading between journeys. After five warmup cycles it exercises
product creation/details, sales history, route transitions, and their query
lifecycles for 30 measured cycles. Each checkpoint forces Chromium GC and
records used JS heap plus live document, DOM-node, and event-listener counts;
only final-minus-baseline retained growth is gated, because a transient peak is
not a leak. The same running-target proof closes the purchase OCR dialog while
upload persistence is deliberately held in flight and asserts that its exact
Blob preview URL is revoked before the late response completes. The normal 107-
test browser suite excludes `@long-shift-soak`; `ci:web` still runs the pure
growth comparator and the command/budget contract.

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
fixed-destination API proxy's header/path restrictions. They also enumerate all
13 db/sync channels behind an Electron-free session-first core, prove the
device-id setter cannot persist before login, and pin the locale/device-read
pre-login exceptions. The live Electron smoke clears main-process session state
under an authenticated renderer, then requires localized re-entry UI with no
raw invoke error or expected-error main-process diagnostic before returning to
login. Shared, web, server,
and Electron tests also pin incremental SSE framing, Authorization-bearing
fetch, Store Hub refresh-and-retry, bounded reconnect with `Last-Event-ID`,
stream cleanup, and `sessionVersion` revocation. The web E2E suite opens the
real KDS stream, verifies its Bearer header, revokes that session, and observes
the canonical login redirect after server revalidation. Its observer uses an
independent API cookie jar so the second principal cannot inherit the browser
operator's refresh cookie and accidentally cross the intended CSRF boundary.

The launch-import journey also pins service-item semantics end to end: the
preview exposes the stock-tracking column and rejects opening stock for a
service, the accepted row persists as a service, inventory and procurement
pickers omit it, and the normal sales search still offers it. Server tests pin
the matching write-side invariant by rejecting a service before either a
purchase or an inventory order header is created.

Price-tier regressions are split across the shared, server, and web suites.
Shared tests own base/alternate-unit fallback; server tests own tenant-safe
customer resolution, frozen three-price sale snapshots, draft completion,
quotation persistence, and legacy migration/backfill; web tests prove that
customer selection does not silently reprice and that an explicit action
updates Sales, POS Touch, and quotation drafts. Any change to these visible
flows still requires the running-target smoke described above, including a
persisted quotation or completed-sale readback.

The server and desktop CI gates also consume
`perf-budget.json::operationalProfile`: the server measures a maximum-size
launch-product preview/commit; desktop tests time an encrypted 5,000-row backup
round trip and enforce a bounded recovery queue; the Electron runtime gate
checks boot elapsed time together with main/renderer memory. See
`PERF-BUDGETS.md` for thresholds and the packaged-artifact boundary.

Server CI additionally runs the isolated product-search scale contract after
coverage and the store profile. It grows one tenant to 1,000, 10,000, and
50,000 products, then pins relevance, tenant isolation, FTS integrity/query
plans, and p95 for exact SKU, selective and broad FTS, and compatibility
substring searches. It also profiles the bounded 200-id hybrid semantic
candidate pool without contacting an AI provider. The profile is intentionally
separate from the parallel coverage pool; see `PERF-BUDGETS.md` for its samples
and baselines.

Product-vector selection also has retained, non-network CI evidence. Corpus and
evaluator tests pin 36 representative products, 24 graded neutral LATAM and
cross-language queries, fail-closed vector-map validation, and retrieval metric
math. Codec/storage tests pin the versioned little-endian `PVEC` envelope,
legacy JSON compatibility, corrupt-payload rejection, float32 recall/error, and
the production 200-candidate boundary. The evidence-binding test rejects drift
between the corpus SHA, selected Ollama default, retained reports, and codec
contract. Re-running providers remains an explicit operator benchmark because
CI must not need Ollama or cloud credentials. See `PERF-BUDGETS.md` and
[ADR-0011](./architecture/0011-product-search-vectors.md).

## Hardening evidence map

The current product hardening baseline is represented by durable, executable
contracts rather than by a standalone manual checklist:

| Quality boundary                           | Canonical evidence                                                                                                                     | Gate                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Operator Deck adoption                     | `scripts/check-operator-deck-adoption.mjs` and its regression tests                                                                    | `ci:web`                                                                   |
| Shift-defining operator journeys           | `operator-journeys.json`, its four tagged critical flows, the full indexed browser matrix, and the ten target-agnostic Electron ports  | `ci:web`, `test:e2e:web:critical`, `test:e2e:web`, and `test:e2e:electron` |
| Accessibility and adaptive layouts         | `e2e/web/a11y.spec.ts`, `assistive-technology.spec.ts`, `navigation-responsive.spec.ts`, and `payment-drawer-responsive.spec.ts`       | `test:e2e:web`                                                             |
| Dense data behavior                        | `e2e/web/design-system-scale.spec.ts`, including the 1,000-row bounded table contract                                                  | `test:e2e:web`                                                             |
| Same-renderer retained memory              | `e2e/web/long-shift-soak.spec.ts`, its pure growth comparator, and `perf-budget.json::longShiftSoak`                                   | `ci:web` contracts plus opt-in `test:e2e:web:soak`                         |
| Migration journal integrity                | `migrations-parity.test.ts`, `migration-tracking.test.ts`, and `scripts/ensure-migrations-bundled.mjs`                                 | `ci:server` plus `ci:desktop`                                              |
| Query plans and store/search-scale latency | `perf-store-profile.test.ts`, `perf-product-search-profile.test.ts`, `perf-trpc-latency.test.ts`, and `perf-budget.json`               | `ci:server`                                                                |
| Product vector/model selection             | `product-embedding-evidence.test.ts`, `vector-codec.test.ts`, retained corpus/reports, and ADR-0011                                    | `ci:server` plus operator benchmarks                                       |
| Desktop continuity and recovery            | `recovery-rehearsal.test.ts`, the encrypted recovery rehearsal, and the Electron runtime memory/launch gate                            | `ci:desktop` plus `rehearse:upgrade-recovery`                              |
| Packaged encrypted recovery                | `packaged-recovery-rehearsal.test.ts`, `run-packaged-recovery-rehearsal.mjs`, and candidate evidence validation                        | `ci:desktop`, `ci:release`, plus the full manual desktop matrix            |
| Recovery ownership and executable actions  | `packages/shared/src/operational-readiness.ts`, `scripts/check-operational-readiness.mjs`, and `e2e/web/operational-readiness.spec.ts` | `ci:web` plus `test:e2e:web`                                               |
| Authenticated realtime continuity          | shared SSE parser tests, server SSE tests, Electron Store Hub tests, and `e2e/web/realtime-auth.spec.ts`                               | workspace CI plus `test:e2e:web`                                           |
| Full dependency-graph advisories           | `scripts/run-dependency-audit.mjs` plus pnpm's low-severity registry audit                                                             | each workspace CI gate; every advisory still fails closed                  |
| Exact dependency-override lifecycle        | `config/exact-overrides-policy.json` and `scripts/check-exact-override-policy.mjs`                                                     | `ci:shared` rejects missing, stale, duplicate, or expired review metadata  |
| Runtime dependency reachability            | production graphs rooted at web, server, and desktop plus `config/runtime-dependency-reachability.json`                                | audit output classifies vulnerable installed versions by artifact path     |

This map proves that the local development and automated validation baseline
remains covered. It does not replace the multiplatform packaging, signing,
provider certification, physical-device, or controlled-pilot evidence required
for release readiness.

Exact registry overrides are reviewed as explicit, temporary exceptions rather
than permanent lockfile decoration. The policy binds both selector and target,
requires an owner, rationale, removal criteria, and category-specific deadline,
and fails closed after 14 days for regression ceilings, 30 days for security or
deprecation floors, and 90 days for compatibility pins. A review removes an
unneeded override or refreshes its evidence and deadline only after
`pnpm run ci:audit` plus the applicable runtime gate pass. Local `file:`
replacements are maintained workspace packages and are not version-pin debt.

Audit scope is derived from paths, never from a package name or its declared
development scope. The audit wrapper obtains pnpm's complete advisory report,
then builds production graphs from the web bundle, standalone server, and
packaged Electron roots. Findings are matched to the vulnerable installed
version before being labelled runtime-reachable, not-runtime-reachable, or
unknown. The Electron contract explicitly pins the shipped
`@puntovivo/desktop → electron-updater → js-yaml` path and rejects Electron
Forge in the desktop production graph. Every low-or-higher advisory fails CI,
including tooling-only findings, and registry, JSON, graph, or version
ambiguity fails closed.

A not-runtime-reachable label is still not permission to ignore an advisory on
its own: it is a conservative manifest-graph result. It is now the
precondition for the one legitimate exception, an expiring disposition
recorded in `config/audit-dispositions.json` and described in
[SECURITY.md](./SECURITY.md). The audit refuses a disposition whose advisory it
classifies as runtime-reachable or unknown, whose package does not match, or
whose review date has passed, and it fails when a disposition outlives the
advisory it covers. The bundle/import and packaged-artifact argument remains a
recorded human claim bounded by the review deadline rather than an automated
proof, because the audit runs before any build exists to inspect.

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
- `packaged-recovery-<os>[-<mac-generation>]-<short-sha>.json`;
- `candidate-evidence-<os>[-<mac-generation>]-<short-sha>.json`.

The evidence manifest binds the candidate SHA to the exact package version,
platform, architecture, actual host OS version, stable support target, artifact
names, byte sizes, SHA-256 checksums, and matching update-feed reference. macOS
evidence uses distinct Sequoia and Tahoe filenames so a Tahoe result cannot be
reported as Sequoia compatibility. It also recomputes the installer SHA-512 and
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
[run 31264233582](https://github.com/johnny4young/puntovivo/actions/runs/31264233582)
from 2026-08-08 against the released candidate
`c6aebb8ee27e1f6f73e593cbd0a4ff117fd8a567` (app `1.10.1`, database schema
`35`). Linux x64, macOS arm64, and Windows x64 each passed package creation,
the native/runtime and first-login renderer smokes, and all nine encrypted
recovery checks over the 262,865-row profile. The downloaded manifests were
revalidated against their actual installer, update-feed, and recovery-report
hashes; each rejected a wrong key and corrupt bundle, preserved the source
database, and booted the restored copy. These are validation-only manual
candidate artifacts: they prove runtime and recovery behavior, not release
signing, notarization, certification, or a production recovery-time commitment.
The macOS job ran on Tahoe 26.5.2 arm64. It does not replace a separate
Sequoia run or the representative-machine clean-install, real-updater upgrade,
and downgrade-refusal checks required before rollout promotion.

## Representative-machine Gate 5

Gate 5 is deliberately outside GitHub-hosted CI. Each distributed platform and
support target needs its own manifest; a candidate passes that target only when
one representative machine retains hash-bound evidence for all of these
observations against the same session UUID, platform, architecture, observed OS
version, app version, and complete candidate SHA:

1. install the signed candidate into a fresh, isolated OS profile with no prior
   Puntovivo user data, launch it, and capture the observed version;
2. install the previous supported signed release in another isolated profile,
   create a deterministic canary, receive the candidate through the production
   `electron-updater` path, relaunch, observe the candidate version and update
   history, and export the same canary before and after;
3. under a normal (not rollback) update policy, attempt a real downgrade with
   the previous signed installer. Retain the visible installer/startup refusal
   plus byte-identical closed/checkpointed encrypted database snapshots from
   before and after the attempt;
4. run all Electron journeys from a standalone interactive terminal against a
   completely clean checkout of that exact candidate; and
5. have a release-operator role independently review distinct clean-install,
   upgrade, and downgrade captures.

Do not perform any of these steps against an operator's production profile.
Use a disposable OS account or disposable machine image and close Puntovivo
before copying the encrypted database. Retain the raw captures and databases
locally under the ignored `.artifacts/` tree; the sanitized manifest contains
only basenames, byte counts, hashes, bounded host labels, observations, and a
non-personal reviewer-role label.

The external Electron command refuses non-interactive shells and any CI,
Codex, XCTest, dynamic-library injection, or dirty-worktree signal. That is an
evidence boundary, not a workaround for failing tests:

Generate one fresh correlation id with `node -p "crypto.randomUUID()"` and use
that exact UUID in both the external command and the Gate 5 draft:

```bash
pnpm run test:e2e:electron:external -- \
  --candidate-root /absolute/path/to/clean-candidate-worktree \
  --packaged-app /absolute/path/to/the/installed/signed/Puntovivo.app \
  --session-id 018f6f8c-4e5b-7a21-8abc-1234567890ab \
  --output .artifacts/gate5/macos-sequoia/external-electron.json
```

`--candidate-root` lets the current tooling orchestrate a historical release
checkout without modifying it; `--packaged-app` makes Playwright drive the
installed signed candidate through the packaged CDP path rather than launching
the development Electron bundle. On the representative host, place both signed
installers, the three distinct captures, before/after canary exports,
before/after encrypted database snapshots, and `external-electron.json` in one
session directory. Create `draft.json` in that directory with the final report
fields plus an `artifactFiles` object whose ten values are basenames:

```json
{
  "schemaVersion": 1,
  "outcome": "passed",
  "sessionId": "018f6f8c-4e5b-7a21-8abc-1234567890ab",
  "candidateSha": "0123456789abcdef0123456789abcdef01234567",
  "candidateVersion": "1.10.1",
  "previousVersion": "1.10.0",
  "startedAt": "2026-08-08T09:00:00.000Z",
  "completedAt": "2026-08-08T11:00:00.000Z",
  "environment": {
    "platform": "darwin",
    "architecture": "arm64",
    "osVersion": "15.7.1",
    "supportTarget": "macos-15-sequoia-arm64",
    "machineProfile": "retail-register-apple-silicon"
  },
  "probes": {
    "cleanInstall": {
      "freshUserData": true,
      "installedVersion": "1.10.1",
      "firstLaunchSucceeded": true
    },
    "upgrade": {
      "fromVersion": "1.10.0",
      "offeredVersion": "1.10.1",
      "installedVersion": "1.10.1",
      "transport": "production-auto-updater",
      "updateHistoryRecorded": true
    },
    "downgrade": {
      "attemptedVersion": "1.10.0",
      "attemptMethod": "previous-signed-installer",
      "policyMode": "normal",
      "downgradeRefused": true,
      "refusalKind": "installer-refused"
    }
  },
  "artifactFiles": {
    "candidateInstaller": "Puntovivo-1.10.1-mac-arm64.zip",
    "previousInstaller": "Puntovivo-1.10.0-mac-arm64.zip",
    "cleanInstallCapture": "clean-install.png",
    "upgradeCapture": "upgrade.png",
    "upgradeCanaryBefore": "upgrade-canary-before.json",
    "upgradeCanaryAfter": "upgrade-canary-after.json",
    "downgradeCapture": "downgrade-refusal.txt",
    "downgradeDatabaseBefore": "downgrade-before.db",
    "downgradeDatabaseAfter": "downgrade-after.db",
    "externalElectronE2e": "external-electron.json"
  },
  "review": {
    "outcome": "approved",
    "reviewerRole": "release-operator",
    "reviewedAt": "2026-08-08T11:05:00.000Z",
    "notes": "Captures and immutable before/after pairs reviewed on the representative host."
  },
  "failureCode": null
}
```

Collect hashes from actual files, then independently re-read every file and
require a passing reviewed manifest. The validator also parses the external
Electron report and pins it to the same session UUID, SHA, version, exact OS,
platform, architecture, and Gate evidence window:

```bash
pnpm run collect:gate5-evidence -- \
  --input .artifacts/gate5/macos-sequoia/draft.json \
  --output .artifacts/gate5/macos-sequoia/gate5-manifest.json

pnpm run validate:gate5-evidence -- \
  --evidence .artifacts/gate5/macos-sequoia/gate5-manifest.json \
  --artifacts-dir .artifacts/gate5/macos-sequoia \
  --candidate-sha 0123456789abcdef0123456789abcdef01234567 \
  --candidate-version 1.10.1 \
  --previous-version 1.10.0 \
  --support-target macos-15-sequoia-arm64
```

Important v1.10.1 limitation: v1.10.0 and v1.10.1 both bundle database schema 35. Therefore the source-level `SchemaNewerThanAppError` rehearsal does **not**
prove that this specific binary pair refuses a downgrade, and Gate 5 must not
claim it does. It needs an observed previous-signed-installer or startup refusal
with unchanged database bytes. No such approved representative manifest is
retained today, so the v1.10.1 rollout remains blocked at its initial
percentage.

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
