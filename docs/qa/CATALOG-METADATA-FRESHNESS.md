# Product projections after metadata edits

**Language:** English · [Español](../es/qa/CATALOG-METADATA-FRESHNESS.md)

## Contract and cause

On base `404b5d7294ea021a5863d2149c79bf483a498b73` (app 1.15.3), AppRoot gives queries a 300000ms staleTime. CategoriesPage/ProvidersPage successful edits invalidate their own lists, but products.list and products.getById also serialize the joined metadata name. A warm Products view can therefore show the old name while its edit selector shows the new one after the same operator renames a category/provider. Re-entering the view within five minutes does not normally refetch a fresh query.

Invalidate the products router on successful category/provider update. This marks all cached input variants and imperative getById reads stale; active queries refetch through the existing query contract. Existing own-lookup invalidations remain. Customer queries are untouched. No new network polling, TTL changes, global cache clearing, server write, version bump, or rounding rule is introduced.

A different browser context has no general metadata broadcast contract. Fresh cache reuse is expected there. Default focus/reconnect notifications renew stale queries, not fresh ones. The probe advances Date only with Playwright setFixedTime; timers remain real. It dispatches window visibilitychange and offline/online notifications in owned headless contexts. This qualifies the QueryClient event handlers, not OS/native focus, actual internet recovery, service workers or a cross-device sync transport.

Deletion uses unreferenced synthetic metadata. The fixture's product category/provider/unit FKs are restrictive, so this repair does not define deletion of referenced records. Units are a negative control in this editor: their options already come from the invalidated units.list query. Other unit consumers are outside this measured flow.

## Reproduce without a database

Use Node 24.21.0 and pnpm 11.7.0, the frozen lockfile, and the web test environment:

```sh
corepack pnpm --filter @puntovivo/web exec vitest run src/features/categories/CatalogProductFreshness.test.tsx --maxWorkers=1
```

The two tests use a real QueryClient with the production five-minute staleTime, fresh list variants and detail, and mocked transport. They drive each page's actual successful update callback. Before the two production invalidations they receive Original name; after the fix all product projections read Renamed metadata. The unrelated customer cache remains fresh. To reproduce the red baseline, retain the test and remove only the two new products invalidations in a disposable copy.

## Reproduce the browser matrix

Use a fresh independent disposable checkout with no .env or local.db. Install with the frozen lockfile and review/disable lifecycle scripts for the lab. Build shared/server. Use the existing canonical synthetic E2E fixture with E2E_USERS admin/manager already provisioned, no real accounts, quiescent WAL, empty fiscal tables and disabled DIAN. This probe never provisions identities. No fixture DB, auth state, trace, personal path or credential is committed. Fixture availability is an explicit prerequisite; never point this at an application database.

The prepare script rejects overwrites and identities outside @local.test plus the canonical admin@localhost seed. It copies into the disposable checkout, records source SHA256, adds six synthetic products and 24options per lookup kind, and verifies account count unchanged. IDs and values are in the script. Source bytes must remain unchanged. Keep all source fixtures and run reports when comparing baselines.

```sh
corepack pnpm --filter @puntovivo/shared run build
corepack pnpm --filter @puntovivo/server run build
LAB_FRESHNESS_ACK_SYNTHETIC=1 LAB_FRESHNESS_FIXTURE_DB=/tmp/owned-synthetic-source/local.db node scripts/prepare-catalog-freshness.mjs
NODE_OPTIONS="--require=$PWD/e2e/web/support/catalog-freshness-network.cjs" \
 PUNTOVIVO_E2E_API_ORIGIN=http://127.0.0.1:18924 \
 LAB_BROWSER_OUTPUT=/tmp/owned-freshness/results \
 LAB_BROWSER_JSON=/tmp/owned-freshness/results.json \
 LAB_CATALOG_REQUEST_LOG=/tmp/owned-freshness/requests.jsonl \
 corepack pnpm exec playwright test --config playwright.catalog-freshness.config.ts --project chromium
```

Supply the installed Playwright browser cache through PLAYWRIGHT_BROWSERS_PATH if needed. Create the output parent first. Run with a clean explicit environment and owned HOME/TMPDIR/cache, never inherited credentials. Acquire the lab's shared heavy lock and cooperative lane; verify API 18924 and UI 5173 free. The config refuses listener reuse, runs one worker/zero retries, and launches only loopback web/server children with seedData:false. The Node guard and browser route handler deny external requests. No native app or printer is launched. Release only owned locks/listeners. Fresh checkout/fixture per matrix; do not rerun its insertion script over an existing DB.

For each entity, the same-session case warms Products+detail, edits metadata through Catalog's directory, returns through SPA links, reads the detail and selector, deletes an unused option and verifies selection remains intact. A second manager context reads while an admin writer edits/deletes. At+60s focus retains fresh values; at+301s it refreshes. At+330s reconnect retains the still-fresh deletion cache; at+602s it refreshes. Request ledgers record procedure names/counts without inputs, headers or tokens; database reads verify actual writes. The local UI language is English; no new localized strings are added.

## Evidence and integration

Main browser baseline: two expected failures (category/provider detail names) and four passes (unit and all three second-session cases). Both cache regression tests fail at the stale-name oracle before the fix. Earlier navigation/selector/mock setup failures were retained privately and excluded from product conclusions.

The lab also compares the same fixture against private composition `fc6e0bb4185ce108ba5e6e1d22842c784af947ea`, with independent evidence for the candidate. This composition contains PR 340–350, including dependency and release-note repairs. The present change does not change any lockfile or supersede those PRs. Main's historical dependency audit and missing curated release note remain separate gates; a draft alone is not merge qualification.

Review the existing chain 345 → 341 → 342 → 340 together with 344 → 343 → 346/347 → 348 → 349 → 350 before assessing joint qualification, then this focused metadata repair. That is a review/dependency order, not authorization to merge. Do not rerun an identical known-red audit to manufacture activity, suppress advisories, or merge/deploy from this reproduction. The prior bounded lookup/N+1 negative result is retained; this matrix is a cache consistency experiment, not a new performance benchmark.
