# Dependency remediation — 2026-10-24

**Language:** English · [Español](es/DEPENDENCY-REMEDIATION-2026-10-24.md)

The original 1.15.3 graph at `404b5d7294ea021a5863d2149c79bf483a498b73`
blocks workspace CI at the full dependency audit: 41 advisory/version entries,
32 distinct GHSA identifiers. The [review matrix](assets/dependency-review-2026-10-24.json)
records every identifier, affected installed version, dependency path, upstream
patched range and conditional application exposure. Reachable dependencies are
not proof of an application exploit; development tools still require patching.
No audit disposition, allowlist, threshold or test budget is relaxed.

## Existing changes and order

- [#340](https://github.com/johnny4young/puntovivo/pull/340) owns `sanitize-html` 2.18.0.
- [#341](https://github.com/johnny4young/puntovivo/pull/341) owns Vite 8.3.3.
- [#342](https://github.com/johnny4young/puntovivo/pull/342) owns Electron 43.7.0.
  This dependency-gap branch targets that branch and advances Electron to 43.8.1,
  because later permission/GPU/TLS advisories are not fixed by 43.7.0.
- [#343](https://github.com/johnny4young/puntovivo/pull/343) independently owns atomic
  product deactivation and stale-edit rejection. Its head and historical red CI
  remain preserved; a private composition does not change its qualification.

Review #340/#341 and #342 with this gap change, reconcile their shared lockfile,
and then rerun validation with #343. No foreign branch is edited or merged by the
reproduction. The dependency-gap branch alone intentionally still reports the six Vite
advisories already owned by #341; its audit is not reported as green.

Composition also revealed GHSA-c9rx-x947-fp3h, a discarded-iframe recursion
regression in 2.18.0 itself. A narrow `sanitize-html@2.18.0` selector advances
that version to 2.18.1. pnpm applies the intersecting range to the original
manifest too, so its lock also resolves 2.18.1; #340 still owns the declared
manifest floor. Review these coordinated changes rather than deploying 2.18.0.

## Compatibility decisions

Fastify 5.12.6 and Zod 4.6.6 remain on the current server major lines. Vitest and
coverage move together to 5.0.3. Narrow existing selectors advance DOMPurify to
3.4.17, fast-uri to 3.1.9/4.2.3, undici to 6.29.1/7.30.1/8.12.2 and ip-address to
10.7.4. Older Zod 4.4.3 peers are raised within major 4. Exact override ownership,
review dates and removal criteria are updated with the floors.

Lighthouse's older Puppeteer 25.11.0 retained a Zod 3 consumer in Chromium BiDi.
The owner range already accepts Puppeteer 25.16.0, whose upstream BiDi migration
uses Zod 4. This owner-scoped update keeps Puppeteer's public major 25; it does
not force Zod 4 into a library written against Zod 3. Node 24.21.0 satisfies the
new engines. Browser protocol child versions do change and require Lighthouse
contracts plus an actual isolated browser run before release qualification.
Electron stays on major 43 and the bundled SQLite/Argon2 Node-API line is unchanged;
metadata and Node tests do not qualify its new binary or OS behavior.

## Reproduce the private composition

The [recipe](assets/dependency-composition-2026-10-24.json) pins reviewed PR heads,
manifest changes and a checksum-verified combined lockfile. The helper clones only
tracked source into a new directory, applies the pinned #343 change and reconstructs
#340/#341's manifest intent with the reviewed lock. It performs no installation,
tests, publication or merge and refuses an existing destination. This avoids
manually selecting one side of conflicting peer snapshots.

Use Node 24.21.0 and pnpm 11.7.0, including nested pnpm calls. Establish a clean
child environment without provider, database, signing or telemetry settings; use
owned temporary HOME/TMP/cache directories and the cooperative heavy lane. Never
reuse a real database or a listening application. From this PR checkout:

```sh
node scripts/reproduce-dependency-composition.mjs ../puntovivo-composition
cd ../puntovivo-composition
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run ci:audit
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/products-deactivation.test.ts src/__tests__/products.test.ts src/__tests__/optimistic-version.test.ts src/__tests__/tenant-isolation-mutations.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/server run typecheck
corepack pnpm --filter @puntovivo/web run typecheck
node --test scripts/check-lighthouse.test.mjs scripts/run-lighthouse-gate.test.mjs scripts/electron-fetch-download.test.mjs scripts/run-dependency-audit.test.mjs scripts/runtime-dependency-reachability.test.mjs scripts/check-exact-override-policy.test.mjs
node --experimental-strip-types --test apps/desktop/src/main/print-html-sanitizer.test.ts
```

## Qualification limits

See the PR for commands, exact candidate hashes, counts and failures from each
completed run. A clean audit alone does not pass `ci:server`, `ci:web` or
`ci:desktop`. Their coverage, build, browser/runtime and measurement gates remain
required. Native Electron, physical printers, fiscal providers and operator data
must not be used without the documented isolated runtime boundary. Product
atomicity/UI follow-ups and the unresolved monetary midpoint policy are separate.
