# Product dialog opener identity

**Language:** English · [Español](es/PRODUCT-DIALOG-FOCUS.md)

## Objective and cause

On app1.15.3/main404b5d7294ea021a5863d2149c79bf483a498b73, opening a product deactivation dialog remounts its Delete button. ProductsPage creates new column definitions on every render; their inline action renderer changes React component type in flexRender. The captured opener is already disconnected when the dialog opens, so cancelling leaves focus on BODY. This also reproduces before #348; its toast portal repair does not repair row identity.

The action renderer now has a stable module-level type and reads current callbacks, permissions and product data from its column definition. Products opt into entity IDs for table rows, cells, selection mapping and virtual item keys; other tables retain default index IDs. Reordering rows therefore preserves the control for the same product. No blanket memoization captures stale callbacks.

A second unmount came from the debounced search query: changing its key put the page into isLoading and removed the entire table even with confirmation open. The query now uses the existing repository keepPreviousData pattern, retaining rows/search while the response is pending and exposing aria-busy. A response that actually removes the product still uses the missing-row fallback. A real QueryClient fixture and EN/ES browser tests hold that response behind a gate; before this correction both browser cases disconnect the opener while pending. No sleeps or weaker focus assertion replace the gate.

Normal close restores the original, connected opener through the existing dialog hook. Only a genuinely missing opener (removed/filter/virtual window) uses product search, or the visible page heading if the table/search has disappeared. The heading has programmatic tabindex=-1, outside the normal tab order. ConfirmModal forwards the existing Modal restoration option. Global inert, focus trapping and toast isolation remain enforced.

## Scope and dependencies

This PR stacks on #347 headcb3cfed99e999d93bc126b4ef33a7012737d1231 to preserve rejection consumption. #347 remains unchanged. Real error/retry qualification also needs atomicity #343 and toast accessibility #348 head0b5122d6eb393ee3d1a67d9b8ea358683bc4f76e. No backend mutation, rounding policy, package, lock, release, fiscal or native behavior changes here.

Review sequence:345 →341 →342 →340 together344 →343 →346/347 →348 →this repair. This is review/qualification order; the user decides merge order. 345 restores factual notes,341 patches Vite,342 supplies Electron base,340/344 close the audit composition. Public base CI and private composed results must be reported separately.

## Reproduce with synthetic fixtures

Use Node24.21.0, pnpm11.7.0, a fresh owned checkout, no inherited provider credentials, an owned database/profile and the cooperative heavy-test lock. Never reuse production data, ports or an installed application. Install using the frozen lock; do not ignore advisories to obtain green CI.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/features/products/ProductsPage.focus.test.tsx src/features/products/productsColumns.identity.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

For the full browser composition, use #344's pinned reproduction helper, then the346/347 extension and #348's helper documented in their PR descriptions. Apply this PR's head with `python3 scripts/reproduce-product-focus.py NEW_COMPOSITION_DIRECTORY EXACT_FOCUS_HEAD`. The helper requires a clean recipe receipt with exact dependency heads and applies reviewed files, joining translation pairs without replacing the composed lock. It never merges, installs, tests or pushes.

In that new composition, build the server and run these bounded fixtures with Chromium, one worker and no retries:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts e2e/web/product-dialog-opener-identity.spec.ts --workers=1
```

Review the launcher/global setup before running; the lab uses a fresh clone, a guarded local API and a lab-only setup that prohibits fiscal activation/emission. The existing #348 fixture deliberately rejects one synthetic outbox write, verifies rollback and accessible EN/ES alert, cancels to the original opener, retries successfully and verifies persisted state. Its original assertions remain intact. The new fixture uses46 synthetic products, mouse cancellation on the same original node, then keyboard cancellation after a real virtual-window eviction to product search. Unit fixtures cover EN/ES keyboard/mouse error/retry, reorder, row removal, query-error heading fallback, fresh permissions/callbacks and selection IDs. Raw traces may contain ephemeral fixture credentials and must remain private.

Before repair, the eight page regressions fail on the composition already containing #348; after repair they pass. Earlier #348's four browser cases remain historical failures, separate from fresh combined results. Consult this PR description for exact published/private SHAs, measured counts and hosted CI; draft status is not merge qualification. Browser accessibility-tree semantics do not certify native screen-reader speech. Canonical Lighthouse, fiscal and native lanes are outside this bounded repair.
