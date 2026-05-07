# 0007 — Module Activation Kernel

> Status: Accepted
> Date: 2026-05-07
> Owner: ENG-068

## Decision

Per-tenant module activation lives in the existing `tenants.settings`
JSON column under the key `modules`, NOT in a dedicated `tenant_modules`
table. The single source of truth for module ids, default state, role
visibility, and i18n key mapping is the manifest at
`packages/server/src/services/modules/manifest.ts`.

The renderer reads the effective state once per session via
`modules.getEffective` (a `tenantProcedure` query) and exposes it
through `useIsModuleActive(moduleId)` from
`apps/web/src/features/modules/`. Server-side procedures gate via
`createModuleGuard(moduleId)` middleware composed onto the standard
role factories — `adminProcedureWithModule`,
`managerOrAdminProcedureWithModule`, etc.

When a deactivated module's procedure is called, the server returns
`FORBIDDEN` with structured error code `MODULE_NOT_ACTIVATED` and a
`details.moduleId` payload so the renderer can show a translated
"feature not available" toast distinct from a role-FORBIDDEN. Module
deactivation is **soft** — rows persist; reading is gated, not
deleted.

The kernel ships with five demo modules wired end-to-end so future
work can light up vertical packs (ENG-069) and the public API
(ENG-070) by registering more entries in the manifest:

- `copilot` — `/co-pilot` route + `ai.copilot.chat`.
- `operations-center` — `/operations` route + `reports.diagnostics.*`.
- `quotations` — `/quotations` route + `quotations.*`.
- `anomaly-detection` — dashboard tile + `ai.anomalies.{list,snooze}`.
- `semantic-search` — sparkles toggle on Products + `products.semanticSearch`,
  `products.regenerateEmbeddings`, `products.suggestCategory`.

Default state for every demo module is `enabled: true`. Tenants that
have never been toggled see no behavior change after the kernel lands.

## Alternatives Rejected

- **Dedicated `tenant_modules` table** — Would require a schema
  migration plus a per-call join for every gate. Adding or removing
  a module would require migration plus role-gated CRUD over the
  table. The JSON blob already exists, the existing fiscal/AI gate
  precedent (`fiscal_dian_enabled`, `fiscal.mx.enabled`,
  `fiscal.cl.enabled`, `ai.enabled`) shows the pattern works, and
  the manifest's TypeScript exhaustiveness check guards typos at
  compile time.
- **Module-id enum at the DB level** — Too rigid. A new module
  would require migration before the application layer could use it.
  Manifest-as-source-of-truth + JSON storage gives the same type
  safety on the application side without the ALTER TABLE round-trip.
- **Per-module compile-time flag** — Would force a rebuild for
  SaaS-style activation. Runtime JSON read is the right tradeoff:
  a single in-memory hit per request, and the `ai.enabled` /
  `fiscal_dian_enabled` precedents already pay this cost without
  measurable latency.
- **Hard disable on toggle-off** (data export + scrubbed) — Out of
  scope for v1. Acceptance criteria says "deactivation hides
  behavior without deleting rows"; soft disable matches. A future
  ticket can add hard disable for compliance scenarios where the
  tenant must demonstrate data scrubbing.

## Implementation Impact

- New manifest at `packages/server/src/services/modules/manifest.ts`
  — `MODULE_IDS` tuple, `MODULES_MANIFEST` record, helpers
  `isModuleId`, `resolveModulesState`, `visibleDescriptors`,
  `buildModulesBlob`. `Record<ModuleId, ...>` exhaustiveness blocks
  forgotten arms at compile time.
- New middleware factory at
  `packages/server/src/trpc/middleware/modules.ts` — exports
  `createModuleGuard(moduleId)`, plus pre-composed factories
  `adminProcedureWithModule`, `managerOrAdminProcedureWithModule`,
  `cashierManagerOrAdminProcedureWithModule`,
  `tenantProcedureWithModule`. Existing `adminProcedure` /
  `managerOrAdminProcedure` stay untouched so non-module routes do
  not pay the JSON-read cost.
- New tRPC namespace `modules.*` with three procedures (`list`,
  `getEffective`, `setActive`). `setActive` is composed under
  `criticalCommandAdminProcedure` (ADR-0002) so each toggle ships an
  envelope + device id and lands in the audit log
  (`action='module.toggle'`, `resourceType='tenant_module'`).
- New error codes `MODULE_NOT_ACTIVATED` + `MODULE_UNKNOWN` in
  `packages/server/src/lib/errorCodes.ts`, mirrored in
  `apps/web/src/lib/translateServerError.ts` so the renderer
  surfaces a translated toast distinct from role-FORBIDDEN.
- Audit-log enum extension — `auditLogActionEnum` gains
  `'module.toggle'`, `auditLogResourceTypeEnum` gains
  `'tenant_module'`. The renderer's `AuditLogAction` /
  `AuditLogResourceType` mirror the change so the audit-logs page
  picker shows the new entry.
- Renderer kernel at `apps/web/src/features/modules/` —
  `ModulesProvider` mounted between `TenantProvider` and the route
  tree, exposing `useIsModuleActive(moduleId)` +
  `useModulesSnapshot()`. `RequireModule` component for routes,
  sidebar entries, and dashboard cards. While the
  `modules.getEffective` query is in flight, the manifest defaults
  apply (every demo module defaults to `true` today, so this is
  optimistic-with-redirect — no flash of hidden routes on cold boot).
- Route gating in `apps/web/src/App.tsx` — `<ShellRoute>` accepts
  `allowedModule?: ClientModuleId`. When the module is off, the
  route redirects to `/dashboard`. Sidebar entries in
  `apps/web/src/components/layout/Sidebar.tsx` accept
  `requiredModule?: ClientModuleId`; the filter step hides the entry
  when the module is off.
- Admin tab `/company?tab=modules` — `CompanyModulesCard` lists
  every module from `modules.list`, each row has a toggle that
  fires `modules.setActive` (critical mutation). On success, the
  card invalidates both `modules.list` and `modules.getEffective`
  so the admin tab + the renderer-wide context refetch on the same
  tick.
- Dev seed at `packages/server/src/db/seed-dev.ts` — initializes
  `settings.modules` with every demo module ON for the demo tenant.

## Coupled invariants

- **`ai.enabled` flag** — Stays as-is. The `copilot` module is a
  SEPARATE gate (controls visibility of `/co-pilot`); `ai.enabled` is
  a runtime gate (controls whether the LLM provider is configured).
  Both gates can be on/off independently. When `copilot=false` the
  route hides; when `ai.enabled=false` but `copilot=true`, the route
  shows but the chat returns "configure AI in settings".
- **Locale parity** — The new `modules` namespace lands in both `en`
  and `es`. The locale-parity test gates the contract.
- **CompanyPage tabs** — Extending `TAB_KEYS` from
  `[general, locale, data, device, ai, fiscal]` to add `modules` keeps
  existing `?tab=` deep links working (the `isTabKey` guard tolerates
  the new entry; older URLs that omit `tab` fall back to `general`).
- **Stale clients** — `resolveModulesState` discards unknown ids
  silently. If the operator removes a module from the manifest, a
  tenant whose JSON still carries the stale toggle just stops seeing
  it. Forwards-compat for the SaaS lifecycle.

## Affected Tickets

- `ENG-068` — module activation kernel (this ADR's owner).
- `ENG-069` — multi-surface POS shell. Each surface (mobile, kiosk,
  ipad) registers as a module so a tenant can opt-in/out per
  vertical pack.
- `ENG-070` — event-based public API. Each event type (sale.created,
  inventory.adjusted, ...) registers as a module so a tenant can
  control which events leak into outbound webhooks.
- `ENG-068b` (potential follow-up) — migrate the existing fiscal +
  AI flags (`fiscal_dian_enabled`, `fiscal.mx.enabled`,
  `fiscal.cl.enabled`, `ai.enabled`) into the `modules` manifold.
  Out of scope here because every reader for those flags would have
  to flip in the same diff; the kernel + 5 modules is the right v1
  cut.

Updated: 2026-05-07 — initial entry.

## Surfaces (ENG-069)

ENG-069 lifted the surface-as-module pattern this ADR named in the
"Affected Tickets" section above. The kernel did not need a structural
extension — a "surface" is just a render target gated by the same
module manifold + the existing `<RequireModule>` + role guard
composition.

Concretely:

- New manifest `packages/server/src/services/surfaces/manifest.ts` —
  `SURFACE_IDS` tuple + `SURFACES_MANIFEST` record. POS Desktop is
  the implicit default (`moduleId: null`); the four new surfaces
  (POS Touch, KDS, Customer Display, Mobile Waiter) each carry a
  `moduleId` from the modules manifest. The cross-manifest invariant
  (`every non-null moduleId references a real ModuleId`) is checked
  at module load time via `assertSurfaceManifestIntegrity()` and
  pinned by a Vitest case.
- Modules manifest gained 4 new ids — `pos-touch`, `kds`,
  `customer-display`, `mobile-waiter` — all `defaultEnabled: false`
  so existing tenants do not see new sidebar entries appear after the
  kernel ships. Operators flip them on per tenant via
  `/company?tab=modules`.
- New tRPC `surfaces.list` (managerOrAdmin) joins the manifest with
  the resolved module state so a future surfaces admin tab (or the
  renderer's `useSurfacesSnapshot()` hook) does not need a second
  `modules.list` round-trip.
- Renderer mirror at `apps/web/src/features/surfaces/manifest.ts`
  plus 4 layout shell components — each composes
  `<ProtectedRoute>` + `<RequireModule fallback={<Navigate to="/dashboard" />}>`
  + `<Suspense>` around `<Outlet />`. Routes mount as top-level in
  `App.tsx`, OUTSIDE of `MainLayout`, so each shell owns its full
  viewport (KDS fullscreen black backdrop, customer-display gradient,
  mobile-waiter phone-width container, POS Touch wider chrome).
- ENG-039 (vertical restaurant Mexico) plugs real workflows into the
  existing shells without forking the App component. The shells +
  manifest are the seam; the placeholders ship as stubs.

The surface-as-module pattern adds zero new architectural primitives —
it composes ENG-068's module guard + role guard + lazy route exactly
the same way the existing demo modules do. Documented here so future
contributors find the pattern + the manifests in one place.
