# Dialog notifications and accessibility

**Language:** English · [Español](./es/DIALOG-TOAST-ACCESSIBILITY.md)

## Objective and cause

On app 1.15.3/base `404b5d7294ea021a5863d2149c79bf483a498b73`, an error toast created while a modal remains open is rendered under the application root. The dialog correctly makes that background root inert and aria-hidden. The toast exists visually/within the DOM but its alert and recovery controls are absent from the accessibility tree.

This predates the product rejection repair [#347](https://github.com/johnny4young/puntovivo/pull/347). That patch consumes the rejected promise; it does not repair the shared notification boundary. Keep its earlier partial qualification and historical CI separate.

## Minimal repair and contracts

ToastProvider owns one stable React portal host. The shared dialog hook registers its actual focus panel before computing background isolation. The host moves into the top registered modal panel, back into the lower drawer/modal when a nested dialog closes, and back to the document body when all dialogs close. Existing notification DOM identity and expiry timers survive those transitions.

The background remains inert and hidden; there is no global exemption for notification nodes. Toast recovery/dismiss buttons participate in the panel's existing Tab trap. An incoming notification does not steal focus. Removing the currently focused notification returns focus to that panel; removing a different notification does not move focus. A notification action that opens a dialog retains a real opener node for restoration. Dialog-scoped feedback stays in flow with a bounded scroll area rather than clipping a fixed viewport inside the panel.

This changes notification placement and shared hook integration only. No dependency, schema, fiscal, product mutation, permission, rounding, global inert removal or unrelated modal arbitration change. Existing toast action rejection containment remains. Native screen-reader speech output is not certified by DOM/ARIA-tree checks; the lab exercises EN/ES semantics and keyboard behavior in Chromium.

## Synthetic reproduction

Use Node 24.21.0 and local pnpm 11.7.0, including nested calls. Use a NEW checkout, its own frozen installation and database, clean explicit child environment, owned HOME/TMP/cache and the cooperative heavy lane. Never reuse an operator database, listener, browser profile, Keychain or printer.

The original lock has advisories. For joint qualification, reconstruct the pinned [#344](https://github.com/johnny4young/puntovivo/pull/344) composition and its exact #343/#345/Dependabot recipe, then apply the pinned #346/#347 files using the script in that PR description. Apply this PR's files and union its translation pair in that private tree. Do not edit another PR branch or concatenate independent locks. The PR description records exact final heads and measured results.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/components/feedback/__tests__/ToastProvider.dialog.test.tsx src/components/feedback/__tests__/ToastProvider.portal-lifecycle.test.tsx src/components/feedback/__tests__/ToastProvider.test.tsx src/components/form-controls/Modal.test.tsx src/components/feedback/__tests__/Drawer.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

For before, copy only the new component fixture to the unchanged source in the same frozen graph: the six dialog cases fail because alerts/status are inaccessible. The lifecycle fixture includes two additional risks: restoring a notification action opener and independently expiring multiple notifications. That latter test supplies distinct synthetic UUIDs because the global test setup normally returns one fixed UUID; it does not suppress React diagnostics.

The live fixture uses a scoped real SQLite outbox trigger and a new synthetic tenant/product. Joint prerequisites #343 and #347 respectively provide rollback/version behavior and the handled renderer promise. It asserts one accessible localized error, background isolation, focus retention, Tab/Shift+Tab, dismissal, cancel/restoration, retry, reload/persistence and zero escaped page errors in EN/ES and light/dark. The sole expected HTTP500 is tied to the deliberately rejected products.delete request. No global console allowlist is added.

After confirming the exact test ports are free and building the standalone server:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts --workers=1
```

The canonical config owns the plaintext fixture at packages/server/data/local.db and refuses server reuse. In the lab, an owned config additionally disables fiscal activation/emission, restricts outbound traffic, and records exact ports and final zero fiscal counts. Preserve raw traces privately: even synthetic sessions carry ephemeral credentials. No canonical Lighthouse/fiscal flow or native Electron lane is qualified by these checks. Do not claim full release readiness while those boundaries remain unresolved.
