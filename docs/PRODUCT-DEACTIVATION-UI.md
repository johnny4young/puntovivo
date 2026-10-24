# Product deactivation confirmation rejection

**Language:** English · [Español](es/PRODUCT-DEACTIVATION-UI.md)

## Objective and behavior

On app1.15.3/base404b5d7294ea021a5863d2149c79bf483a498b73, the product
confirmation awaits `deleteMutation.mutateAsync` without handling rejection.
The mutation shows its localized error toast, but the promise still rejects into
a React click handler that does not consume it. The laboratory observed this as
an uncaught rejection in both English and Spanish.

The page now handles the already-reported rejection, matching its existing
create/update handlers. The mutation remains the single owner of error toasts.
The confirmation stays available for retry or cancel; only success invalidates
the product list, closes confirmation and shows success. There is no optimistic
deactivation or new toast in the catch. The shared modal and other callers are
unchanged.

## Reproduce and validate

Use a fresh disposable checkout, Node24.21.0 and local pnpm11.7.0 including nested
calls. Use a clean child environment without inherited database/provider/signing/
telemetry settings and the cooperative heavy lane. The tested recovery graph is
the frozen composition in344 (Vitest5.0.3,jsdom30.1.1); this UI patch changes no
dependency manifest or lockfile.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/features/products/ProductsPage.details.test.tsx src/features/products/ProductsPage.moduleGate.test.tsx src/features/products/ProductFormModal.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm exec prettier --check apps/web/src/features/products/ProductsPage.tsx apps/web/src/features/products/ProductsPage.details.test.tsx
node scripts/check-documentation-translations.mjs
```

The existing page integration fixture keeps the real table/drawer, stubs the
heavy modals and simulates the mutation lifecycle at the tRPC boundary. New EN/ES
cases invoke the exact confirmation callback and assert its promise resolves
with no uncaught rejection, exactly one localized error toast, no success/cache
invalidation on failure, an available confirmation, successful retry, and cancel
without a request. The synthetic mutation transport never calls a backend.

Copy only the changed test file into an isolated original checkout for the before
comparison:6cases pass and the2EN/ES rejection cases fail. After the page change,
all48cases across the three named integration files pass. The tested before page
source was verified byte-identical to the original base. No database, fiscal
provider or physical printer is used.

## Limits

This handles the renderer promise only. Backend rollback and stale-edit rejection
remain owned by343; catalog transactions are separate346. No shared-modal error
policy, permissions, labels or rounding rule changes. Browser EN/ES laboratory
evidence predates this repair; these component regressions do not claim a new real
browser or native Electron qualification. Hosted CI still needs the dependency
composition; no advisory exception is added. Draft is not merge readiness.
