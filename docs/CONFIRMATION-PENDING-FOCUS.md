# Focus during pending confirmation

**Language:** English · [Español](es/CONFIRMATION-PENDING-FOCUS.md)

## Objective and cause

After product opener identity/search preservation in #349, the composed browser flow reaches7/8 passing cases. The remaining case loses focus on Confirm during the pending mutation, before cancellation. ConfirmModal applies native disabled to its focused confirmation button while loading. That removes the control from keyboard destinations and can blur it; the dialog's normal initial-focus timer can then choose its first control. This is separate from #349's remounted row and #348's toast portal.

A pending confirmation now remains a stable, focusable button with aria-disabled and aria-busy. Its click handler explicitly guards loading and confirmDisabled, covering pointer and Enter/Space activation. The business confirmDisabled condition remains native disabled; only temporary loading uses the guarded ARIA state. No focus call, timer change, inert exemption, error suppression, API/schema/dependency or business-rule change. Cancel's existing loading behavior is preserved. The shared confirmation helper is the only production change.

## Reproduction and dependencies

This draft stacks on #349 d83b4b68b89f5235ed0d181aa4505eabe0e496f9, retaining that head and its historical7/8 result. Full error/cancel/retry fixtures require #343 rollback, #347 rejection consumption and #348 accessible alert, plus the audited dependency graph.

Review/qualification sequence:345 →341 →342 →340 together344 →343 →346/347 →348 →349 →this repair. The user decides actual merge order. Do not merge/deploy from this recipe.

Use Node24.21.0, local pnpm11.7.0, a new owned checkout/frozen install, synthetic data, explicit clean environment, owned HOME/TMP/cache/profile/DB and the cooperative heavy-test lock. Never borrow an installed application, existing listener or production database.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/components/form-controls/ConfirmModal.pending.test.tsx src/components/form-controls/Modal.test.tsx src/features/products/ProductsPage.focus.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

The component fixture checks EN/ES Tab reachability while pending, blocked keyboard/pointer repeats, same node after failure/loading ends and successful retry; business-disabled actions remain unavailable. Before repair,2cases fail/1passes. Do not disable the strict unexpected-console gate.

`e2e/web/confirmation-pending-focus.spec.ts` holds the real synthetic products.delete response behind an explicit gate. EN/ES keyboard/mouse check the original confirm node's focus while busy, no repeat dispatch, accessible localized rejection, unchanged rollback, focus on the original row after cancel and successful retry. Existing #348/#349 E2E files remain unchanged; run all12cases in the pinned composition:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts e2e/web/product-dialog-opener-identity.spec.ts e2e/web/confirmation-pending-focus.spec.ts --workers=1
```

Use #344's pinned275d recipe,346/347 extension, #348 helper and #349's committed reproduction script. Then apply this exact head using `scripts/reproduce-confirmation-focus.py NEW_RECIPE_DIRECTORY EXACT_CONFIRMATION_HEAD`. It verifies the receipt, copies only this diff and unions documentation pairs, leaving the frozen lock intact. It never installs/tests/merges/pushes.

Review setup before launch: the laboratory uses fresh clones, loopback guards, no server reuse and a lab-only setup forbidding fiscal activation/emission. Raw traces may contain ephemeral credentials and stay private. The PR description records exact heads, measured counts, original failed browser evidence, hosted CI and limits. Native screen-reader speech, canonical Lighthouse, fiscal and native Electron remain unqualified. A draft is not merge/release qualification.
