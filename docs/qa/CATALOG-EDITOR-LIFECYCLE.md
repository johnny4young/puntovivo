# Catalog closed-editor lifecycle regression

**Language:** English · [Español](../es/qa/CATALOG-EDITOR-LIFECYCLE.md)

## Objective and scope

Avoid running ProductFormModal while the operator only views the product list or detail drawer. Previously ProductsPage mounted it whenever the editing snapshot was ready, including the normal `editingProduct=null, isOpen=false` state. The modal hides its DOM after its hooks have already run. That also requests the lazy productQuickCreate namespace while no editor is visible.

The production change adds `isModalOpen` to the existing mount condition. It preserves the complete edit snapshot guard, modalInstanceKey, callbacks and all exports. A new key already resets the form on each open; the closed mounted instance is not a preserved-draft contract. No memo comparator, callback cache, query invalidation, TTL, auth, fiscal, rounding or server behavior changes. The form module remains statically imported; this is lifecycle deferral, not full form code splitting.

This change is stacked on #351 `02161ea343a6ef6997043f7de9e0856517e59f5c` to reuse its sanitized fixture/server/guard recipes rather than duplicate them. #351 itself is untouched. The production guard is independent of metadata invalidation. Main was `404b5d7294ea021a5863d2149c79bf483a498b73`, app 1.15.3; review current remote heads before composing.

## Fast regression versus broader gates

Node 24.21.0, pnpm 11.7.0, frozen lockfile. From the root of a disposable checkout:

```sh
corepack pnpm --filter @puntovivo/shared run build
corepack pnpm --filter @puntovivo/web exec vitest run src/features/products/ProductsPage.details.test.tsx src/features/products/ProductsPage.moduleGate.test.tsx src/features/products/ProductFormModal.test.tsx src/features/products/providerState.test.ts src/features/categories/categoryTree.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run build
```

The existing five-file selection passed 54/54 before adding the new oracle. The oracle then failed at a closed-form call on baseline (54 PASS/1 FAIL); after the production guard,55/55 pass. The table and real detail drawer remain mounted in this test; only the heavy form is observed through its existing spy. No existing assertion is relaxed. The same suite verifies loading details and immutable edit versions, module gates, form cancellation, provider normalization and category trees. These quick checks do not equal ci:web.

Broader qualification uses the existing coverage floors with `corepack pnpm --filter @puntovivo/web exec vitest run --coverage --maxWorkers=2`, fast lint, types, ESLint and build in the audited private composition containing the prior repairs. Canonical ci:web also includes audit, more contracts and Lighthouse; it is not declared complete. Do not rerun identical known-red audits, suppress advisories, run canonical Lighthouse/native lanes, or merge/deploy from this recipe.

## Isolated production measurement

Use an independent fresh checkout with no .env/local.db, an already-provisioned canonical synthetic E 2E fixture, and the #351 preparation script. It never creates accounts. Follow that script's source identity, quiescent WAL, no-overwrite and disabled-fiscal prerequisites; never supply an application DB. The lab fixture has 32existing synthetic accounts,6products,24category/provider/location options and 32units including seeds. No DB/auth state/raw trace is published. Acquire the shared heavy lane and use only clean explicit environment, owned HOME/TMPDIR/cache and loopback services.

```sh
corepack pnpm --filter @puntovivo/server run build
LAB_FRESHNESS_ACK_SYNTHETIC=1 LAB_FRESHNESS_FIXTURE_DB=/tmp/owned-e 2e-source/local.db node scripts/prepare-catalog-freshness.mjs
VITE_API_URL=http://127.0.0.1:18926 node scripts/lab-catalog-navigation-build.mjs
NODE_OPTIONS="--require=$PWD/e 2e/web/support/catalog-freshness-network.cjs" \
 PUNTOVIVO_E 2E_API_ORIGIN=http://127.0.0.1:18926 \
 LAB_BROWSER_OUTPUT=/tmp/owned-nav/browser LAB_BROWSER_JSON=/tmp/owned-nav/results.json \
 LAB_NAV_RESULTS=/tmp/owned-nav/samples.jsonl LAB_NAV_EXPECT_CLOSED=zero \
 corepack pnpm exec playwright test --config playwright.catalog-navigation.config.ts --project chromium
```

Create the output parent first; supply PLAYWRIGHT_BROWSERS_PATH for a reviewed installed Chromium cache. Check API 18926/UI 5173 free; no existing listener is borrowed or killed. The config starts a seedData:false loopback backend and production Vite preview, one worker/zero retries. Both Node guard and browser route handler reject external requests. No physical/native app, printer or real provider is used. The base config controls strict cookies/origin matching; no security policy is weakened.

The build helper uses the normal Vite configuration with one test-only transform at the ProductFormModal function entry, plus normal companion service-worker generation. It must instrument exactly one module. Standard build-web-production is unchanged and does not include the counter. The probe must observe open-form calls, so missing instrumentation cannot yield a false zero. Counts are render-function invocations including possible retries/suspension, not React commit counts or CPU time.

Each of five samples uses a fresh browser context and the existing manager identity. After authenticated Dashboard settles, it enters Products via the real link, records route-cold timing/JS and RPC procedures, returns to Dashboard, then re-enters warm. Common authenticated-shell modules are already loaded; this is not a browser-boot benchmark. It verifies SKU/category, one products.list cold/zero warm, read-only details, complete edit selections, keep-editing/discard of an unsaved draft, unchanged row and clean create/cancel. No product mutation is submitted. Context routing disables HTTP cache, while module-map/query reuse remains; keep that condition matched before/after.

A click-capture timestamp and MutationObserver/next-animation-frame record first visible row. Network-idle plus two frames delimit counting. Samples run sequentially before then after, not randomized ABBA. Host/V 8/cache warmup and automation remain limitations. Save every sample/outlier and source/lock/fixture hashes. `lab-catalog-state.mjs` records only scoped catalog hash/counts and fiscal invariants, not rows/credentials. Compare its pre/post hash to verify read-only data.

## Measured baseline and candidate

| Metric, 5samples each                      | Before                | After                  |
| ----------------------------------------- | --------------------- | ---------------------- |
| Closed-form invocations, cold             | 4,4,4,4,4             | 0,0,0,0,0              |
| Closed-form invocations, warm             | 2,2,2,2,2             | 0,0,0,0,0              |
| Cold first-row ms: median;range;sample SD | 87.1;85.2–152.9;29.23 | 80.9;80.1–349.4;120.10 |
| Warm first-row ms: median;range;sample SD | 29.0;26.4–30.6;1.66   | 30.4;21.6–30.7;3.93    |
| Cold observed JS resources/encoded bytes  | 27/61243              | 26/60262               |
| Warm JS bytes;products.list procedures    | 0;0                   | 0;0                    |
| Functional samples;pageerrors             | 5 PASS;0              | 5 PASS;0               |

The missing cold resource is the 972-byte productQuickCreate English namespace; the remaining 9 bytes of aggregate difference come from emitted chunk details. This does not establish a general bundle-size improvement. The namespace remains available when the editor opens. Open/editor oracles are preserved. Catalog data hash remains `331fa1e943c60faf99249f5a97114f0f413a507d9bbc90dc2c394dbd33e0e126`; users 32, fiscal documents/outbox/enabled 0 throughout. Source fixture hash was `d4adb6658e7cf19590b1d72a881af7c6469696d47b07cf5a002603de54957159`.

The supported result is removal of closed-editor work and one unnecessary namespace request in this measured flow. Latency improvement is inconclusive: retain the 349.4 ms candidate outlier and overlapping ranges; do not claim p95, CPU, memory, save-path throughput, Spanish-browser or production gains. No N+1 bank was repeated. Future full form lazy loading would be a separate hypothesis, requiring its own focus/fallback oracles. No 16-field projection abstraction is included.
