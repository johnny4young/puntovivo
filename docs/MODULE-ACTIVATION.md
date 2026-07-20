# Module activation

Puntovivo ships one codebase whose optional capability bundles can be enabled
per tenant without deleting historical data or forking the product.

## Source of truth

- Manifest: `packages/server/src/services/modules/manifest.ts`
- Tenant overrides: `tenants.settings.modules`
- Decision record: [`architecture/0007-module-activation.md`](./architecture/0007-module-activation.md)

There is no `tenant_modules` table. Defaults come from the manifest, overrides
live in tenant settings, and deactivation is a soft disable.

## Enforcement

Module-aware server procedures compose the regular tenant and role guards with:

- `createModuleGuard(moduleId)`
- `adminProcedureWithModule(moduleId)`
- `managerOrAdminProcedureWithModule(moduleId)`
- `tenantProcedureWithModule(moduleId)`

Inactive modules return `FORBIDDEN` with `MODULE_NOT_ACTIVATED`. The renderer
uses the effective module map through the module store, `useIsModuleActive`,
and `RequireModule`; routes and navigation must apply the same gate.

## Catalog

| Module              | Class    | Ring | Manifest default | New retail tenant | Surface                    |
| ------------------- | -------- | ---: | ---------------- | ----------------- | -------------------------- |
| `operations-center` | core     |    1 | on               | on                | Operations and diagnostics |
| `quotations`        | core     |    1 | on               | on                | Quotations                 |
| `copilot`           | optional |    1 | on               | off               | AI assistant               |
| `anomaly-detection` | optional |    1 | on               | off               | Local anomaly detection    |
| `semantic-search`   | optional |    1 | on               | off               | Semantic product search    |
| `events-api`        | optional |    1 | off              | off               | Public events API          |
| `pos-touch`         | optional |    2 | off              | off               | Touch POS                  |
| `kds`               | optional |    2 | off              | off               | Kitchen display            |
| `customer-display`  | optional |    2 | off              | off               | Customer display           |
| `mobile-waiter`     | optional |    2 | off              | off               | Mobile waiter              |
| `delivery`          | optional |    2 | off              | off               | Delivery                   |

`RING1_RETAIL_PROFILE` is the explicit profile written for a fresh retail
tenant. Existing tenants without an override continue to resolve the manifest
default, preserving compatibility.

## Invariants

- Module state never replaces `ctx.tenantId` scoping or role checks.
- `modules.setActive` is admin-only and audited.
- Disabling a module keeps its durable rows and historical reports intact.
- New module copy ships in English and neutral LATAM Spanish.
- A gated route must have matching navigation, route, and server enforcement.
- Changes to a gated surface require active and inactive live-smoke coverage.

## Verification

Test that authorized users can use an active module, inactive modules return
`MODULE_NOT_ACTIVATED`, tenant state cannot cross boundaries, toggles emit audit
records, and both default-on and default-off profiles remain stable.
