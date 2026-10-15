# 0007 — Module activation kernel

**Language:** English · [Español](../es/architecture/0007-module-activation.md)

> Status: Accepted
> Initial decision: 2026-05-07
> Current manifest, store and delivery boundaries reviewed: 2026-10-15

## Decision

Activation lives in the existing `tenants.settings` JSON under `modules`, not a
`tenant_modules` table. `packages/server/src/services/modules/manifest.ts` owns
`MODULE_IDS`, `MODULES_MANIFEST`, defaults, classification, role visibility and
i18n descriptors. `Record<ModuleId, ...>` makes the mapping exhaustive.

Effective state combines manifest defaults with explicit tenant overrides.
`RING1_RETAIL_PROFILE` writes a deliberate core-only profile for a fresh retail
tenant. Existing tenants without overrides retain manifest defaults. The five
original modules default on in the manifest; that does not mean optional AI is
on for every new retail tenant. Surfaces, Companion, table service and public
events are opt-in. See the complete [module catalog](../MODULE-ACTIVATION.md).

Deactivation is soft: historical rows survive, but protected behavior is gated.
A disabled procedure returns `FORBIDDEN` with `MODULE_NOT_ACTIVATED` and
`details.moduleId`, distinguishable from a role denial. Unknown identifiers
return `MODULE_UNKNOWN`. Module state never substitutes for tenant or role authority.

## Server and command boundaries

`createModuleGuard(moduleId)` composes with `adminProcedureWithModule`,
`managerOrAdminProcedureWithModule`, `cashierManagerOrAdminProcedureWithModule`
and `tenantProcedureWithModule`. Ordinary `adminProcedure` and
`managerOrAdminProcedure` remain separate for non-module procedures.

The current namespace exposes `modules.list` for manager/admin, authenticated
`modules.getEffective`, and administrator critical commands `modules.setActive`
and `modules.applyPreset`. Writes use the Command Envelope/device identity and
complete settings, audit, canonical result and idempotency inside the domain
transaction. Atomic JSON updates preserve sibling fiscal/AI/locale settings.

Disabling `dine-in`, including through a preset, rejects an open normalized
restaurant service or any table-linked draft. The check and update share
`BEGIN IMMEDIATE`; no service can open between them. Creating, suspending,
moving or splitting a draft onto a physical table independently revalidates
`dine-in` under its own writer. Legacy sale paths cannot bypass the gate.

Presets apply a server-owned patch rather than replacing arbitrary settings.
Existing optional choices outside the patch survive. Company controls invalidate
both `modules.list` and `modules.getEffective` after a successful change.
Audit records distinguish `'module.toggle'` and `'module.preset_applied'` with
resource type `'tenant_module'`, without exposing secret settings.

## Renderer state and routes

`apps/web/src/features/modules/ModulesContext.ts` now owns a Zustand store,
not the old React provider. `ModulesSync` mounts once inside authenticated
application context and `useModulesSync()` bridges `modules.getEffective` into
that store. The query uses a five-minute stale time and no window-focus refetch;
admin mutations invalidate it explicitly. Logout resets the store so another
tenant does not inherit its flags.

`useIsModuleActive(moduleId)` and `useModulesSnapshot()` retain their public
signatures. Known manifest defaults fill a cold snapshot; the placeholder state
is not authoritative permission. Server guards still enforce every request.
`RequireModule` controls subtree/fallback rendering. `<ShellRoute>` uses
`allowedModule?: ClientModuleId`; sidebar descriptors use
`requiredModule?: ClientModuleId`. A disabled route redirects to `/dashboard`.

`/company?tab=modules` hosts `CompanyModulesCard`. `TAB_KEYS`/`isTabKey` retain
existing `?tab=` links and use `general` when absent. Unknown stored module ids
are ignored by `resolveModulesState`; helpers `isModuleId`, `visibleDescriptors`
and `buildModulesBlob` keep catalog and JSON handling consistent.

## Surfaces

`packages/server/src/services/surfaces/manifest.ts` owns `SURFACE_IDS` and
`SURFACES_MANIFEST`. POS Desktop has `moduleId: null`; POS Touch, KDS, Customer
Display, Mobile Waiter and Companion refer to real module ids.
`assertSurfaceManifestIntegrity()` checks every non-null reference. The server
manifest is canonical; a separate renderer surface catalog must not drift.
`surfaces.list` combines descriptors and effective module state for manager/admin.

`SurfaceShellRoute` composes role/module guards and `<Suspense>` before loading
lazy shells outside `MainLayout`. Restaurant Voice Ordering at `/touch/voice`
requires both `pos-touch` and `dine-in`; `/m` requires `mobile-waiter` and
`dine-in`. A viewport module alone cannot authorize table-service commands.

Customer Display is opt-in for every preset. An administrator enables it and a
sales role opens a named browser window or one reusable sandboxed Electron
window with a dedicated minimum-privilege preload. Its versioned tenant/site/
cash-session projection fails closed when stale, offline, malformed or logged
out. Navigation to `/customer-display` redirects to Sales; this is neither a
monitor driver nor physical hardware qualification.

## Public events

`events-api` gates business-event projection. `PUBLIC_EVENT_TYPES` and the Zod
schemas in `packages/server/src/services/events/manifest.ts` define five
business events (`sale.completed`, `sale.refunded`, `inventory.adjusted`,
`cash_session.closed`, `fiscal_document.accepted`) plus four privacy-bounded
operational transitions. `PUBLIC_EVENTS_VERSION = 1` changes for breaking
contracts, not every additive event.

`services/events/projector.ts::projectOperationEvent(op)` maps succeeded
`operation_events`: `sales.create`/`sales.completeDraft` to `sale.completed`,
`sales.returnSale` to `sale.refunded`, `inventory.adjustStock` to
`inventory.adjusted`, and `cashSessions.close` to `cash_session.closed`.
`projectFiscalDocumentAccepted` handles `fiscal_document.accepted` from the
worker. `markOperationCompleted` performs projection/enqueue best-effort;
a webhook failure never rolls back the authoritative business commit.

`isModuleActiveInSettings(blob, 'events-api')` checks the tenant's choice.
`webhook_outbox`, signed HTTPS delivery, subscriber configuration, retries and
dead-letter recovery are implemented; they are not future-only v1 work.
`events.getContract` and `events.peekOutbox` remain bounded manager/admin reads.
Operational alerts require explicit destination provisioning and retain their
own minimal lifecycle/attempt evidence. See [Webhooks](../WEBHOOKS.md) and
[Observability](../OBSERVABILITY.md) for delivery and privacy limits.

## Coupled invariants and alternatives

- `ai.enabled` is independent of `copilot`: module visibility does not prove a
  provider is configured. With `copilot=false` the route hides; with
  `ai.enabled=false` and `copilot=true` it can request configuration rather than chat.
- Fiscal flags (`fiscal_dian_enabled`, `fiscal.mx.enabled`, `fiscal.cl.enabled`)
  remain distinct; do not imply the module kernel migrated every existing gate.
- Module text and errors ship in both `en` and `es`; locale parity is required.
- A dedicated `tenant_modules` table or DB enum would require migration and
  extra joins for a manifest-driven setting already represented by tenant JSON.
- Compile-time feature flags require rebuilding for tenant activation. Runtime
  selection is the implemented contract; no unmeasured latency claim is needed.
- Hard deletion on deactivate would destroy history. Soft disable does not
  constitute a compliance erasure workflow.

## Verification

Manifest/state, active/inactive server guards, role/tenant boundaries, preset
atomicity, live restaurant work exclusions and renderer routes need regression
coverage. User-visible changes require a live active/inactive smoke. Surface or
event additions extend their manifest and the same guards; they do not create a
new authority model. No module toggle certifies a fiscal provider, display or
external monitoring service.
