# Catalog writes and authoritative sync intents

**Language:** English · [Español](es/CATALOG-ATOMICITY.md)

## Objective and failure

On app1.15.3/base404b5d7294ea021a5863d2149c79bf483a498b73, a category,
provider or unit mutation can reject because its sync outbox insert fails after
the business write has committed. A provider-category replacement can commit
its relationship changes and a delete intent before a later create intent fails.
The rejected operation then leaves persistent partial state, including after
reopening the SQLite file.

The repair keeps each business write and its authoritative sync intents in one
synchronous immediate SQLite transaction. Provider deletion retains its existing
financial-history/assignment prechecks and now writes the intent before commit.
Provider creation remains in its canonical application use-case. Category/provider
version checks, unit abbreviation conflict mapping, tenant boundaries, payloads
and return shapes remain. The existing transactional enqueue helper deliberately
excludes the best-effort operation-journal effect; catalog routes are not critical
command-envelope routes. No new journal-fatal behavior is introduced.

## Reproduction

Use an independent disposable checkout with Node24.21.0 and pnpm11.7.0 local,
including nested pnpm calls. Use a clean environment without inherited provider,
database, signing or telemetry settings; owned HOME/TMP/cache directories and the
cooperative heavy-test lane. Never reuse an operator DB or application listener.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/catalog-outbox-atomicity.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/units.test.ts src/__tests__/providers.test.ts src/__tests__/provider-payables.test.ts src/__tests__/optimistic-version.test.ts src/__tests__/tenant-isolation-mutations.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/server run typecheck
corepack pnpm --filter @puntovivo/server run lint
corepack pnpm --filter @puntovivo/server run format
node scripts/check-documentation-translations.mjs
```

The20case fixture creates and removes its own temporary SQLite file per test,
seeds synthetic identities, boots without listening and never starts a delivery
worker. A tenant/entity/operation-scoped SQLite trigger raises
`Synthetic catalog outbox rejection`. No fiscal provider or physical printer is
involved. It snapshots all tenant category/provider/unit/assignment rows and
outbox entries. Rejected mutations must preserve that snapshot immediately and
after reopen. Successful mutations must commit exactly their intents, survive
reopen and pass integrity/foreign-key checks. Replacement exercises a later
create-intent failure after a delete intent, so partial intent batches are covered.

For the before comparison, copy only this same test file into an isolated base
checkout and execute it:10rollback cases fail and10success cases pass. With the
repair,20/20pass. Tested recovery dependencies:Vitest5.0.3 and SQLite Node-API13.0.3;
this PR itself changes no dependency manifest or lockfile. The frozen composition
from dependency PR344 provides the tested graph without merging any branch.

## Scope and limits

Covers category/provider/unit create/update/delete and provider-category
replacement. It does not add optimistic versions to units, change hierarchy
concurrency rules, alter rounding, fix UI promise rejection, migrate a schema or
change product-deactivation PR343. No financial history is deleted to make a
provider deletion pass.

This independent draft requires dependency and documentation prerequisites for
full CI; isolated base dependency-audit failures are not waived. Reconcile added
translation pairs when composing with343/344/345. Related suites/types/lint and
hosted CI outcomes belong in the PR description with the exact candidate SHA.
Passing this bounded fixture is not full browser/native/runtime qualification.
