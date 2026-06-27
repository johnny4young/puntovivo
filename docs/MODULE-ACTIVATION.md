# Module Activation System

> Status: shipped kernel, living reference.
> Created: April 21, 2026.
> Updated: May 20, 2026.
> Roadmap anchor: `ENG-068`, with surface expansion in `ENG-069` and
> public events in `ENG-070`.

## Goal

Ship one codebase where tenants can turn capabilities on and off
without forking the product. A minimarket should not carry restaurant,
KDS, AI, or public-event UI unless those modules are active, but
historical data must remain durable when a module is disabled.

## Shipped Contract

The source of truth is the server manifest plus the tenant settings JSON:

- `packages/server/src/services/modules/manifest.ts`
- `tenants.settings.modules`

There is no separate `tenant_modules` table in the shipped architecture.
That was an earlier design option and is now superseded by ADR-0007.

At request time, module-aware procedures use the module guard middleware:

- `createModuleGuard(moduleId)`
- `adminProcedureWithModule(moduleId)`
- `managerOrAdminProcedureWithModule(moduleId)`
- `tenantProcedureWithModule(moduleId)`

When a module is inactive, the server returns `FORBIDDEN` with
`MODULE_NOT_ACTIVATED`. The renderer mirrors the effective module map
through `ModulesProvider`, `useIsModuleActive`, and `RequireModule`.

## What a Module Is

A module is a capability bundle that can include:

- tRPC procedures or procedure guards.
- UI routes or sidebar entries.
- i18n namespaces.
- Outbox/event projections.
- Optional seed data on activation.
- Optional schema additions when the feature needs durable tables.

A module is not:

- A code branch.
- A separately versioned package.
- A tenant-specific fork.
- A signal that historical data can be deleted.

## Activation Semantics

- Default state comes from the manifest.
- Per-tenant overrides live in `tenants.settings.modules`.
- `modules.setActive` is admin-only and writes an audit row.
- Deactivation is soft-disable: UI hides and procedures reject, but rows
  remain intact.
- New modules must define their copy, route/sidebar behavior, and server
  guard behavior in one coherent ticket.

## Current Module Families

| Family | Examples | Notes |
| --- | --- | --- |
| AI | `copilot`, `anomaly-detection`, `semantic-search` | Provider and budget gates still live in AI settings. |
| Operations | `operations-center`, `events-api` | Public delivery worker follow-up lives in `ENG-118`. |
| Sales surfaces | `pos-touch`, `mobile-waiter`, `customer-display` | Route shell shipped in `ENG-069`; deeper workflows live in Plan V3. |
| Restaurant | `kds` | KDS foundation shipped in `ENG-098`; v2 lifecycle lives in `ENG-117`. |
| Commercial docs | `quotations` | Existing quote module can feed WhatsApp and accounting tickets. |

Future vertical modules for services, pharmacy, supermarket, and
hardware-store workflows are tracked in `ENG-119..ENG-122`. Future
supportability, privacy, and AI automation work in `ENG-128..ENG-130`
must reuse the same module/permission semantics where tenant-specific
activation is needed. Do not revive the old `tenant_modules` table
design.

### License-gated activation (planned, `ENG-138`)

`ENG-138` (subscription / billing / license enforcement) introduces a
license check at the activation seam: when `modules.setActive` flips a
module to `true`, the procedure first asks the license service whether
the tenant's current plan tier covers that module. If the plan does
not, the procedure rejects with `MODULE_NOT_LICENSED` (a new error
code distinct from `MODULE_NOT_ACTIVATED`). Grace-period tenants
remain in read-only mode and cannot flip new modules on. The
license-check call is local (license state syncs to the tenant DB so
the POS works during a brief offline window) and audit-logged. The
existing `createModuleGuard(moduleId)` middleware is unchanged; the
license gate runs at activation time, not at every guarded request,
so the hot path stays cheap.

## Module Classification (ENG-183)

Every module carries a product classification and a market ring (see
`services/modules/manifest.ts`). The classification drives the Ring-1 retail
scope gate: a fresh retail tenant is seeded with only the `core` modules ON
(`RING1_RETAIL_PROFILE`), so it lands on the sellable retail surfaces and
nothing else. Non-core modules are pulled forward only when a pilot makes that
vertical the wedge; an admin enables them per tenant via `/company?tab=modules`.

**Classes**

- `core` — required for Ring-1 retail sellability; ON for a fresh retail tenant.
- `compliance` — fiscal / legal obligation. Reserved: fiscal documents and audit
  logs are not module-gated today, so no module carries this class yet.
- `optional` — useful but not Ring-1 core; OFF for a fresh retail tenant, opt-in.
- `experimental` — beta / unproven. Reserved for future AI Wave 2 and
  payment-terminal adapters; no module carries this class yet.

**Rings**: `1` = generic retail MVP, `2` = restaurant +
pharmacy, `3` = service verticals.

| Module id | Class | Ring | Default | Ring-1 retail | What it gates |
| --- | --- | --- | --- | --- | --- |
| `operations-center` | core | 1 | on | on | Operations / diagnostics center surface. |
| `quotations` | core | 1 | on | on | Quotations / estimates surface. |
| `copilot` | optional | 1 | on | off | AI co-pilot assistant. |
| `anomaly-detection` | optional | 1 | on | off | AI fraud / anomaly detection. |
| `semantic-search` | optional | 1 | on | off | AI semantic product search. |
| `events-api` | optional | 1 | off | off | Public webhooks / events API. |
| `pos-touch` | optional | 2 | off | off | Touch POS surface. |
| `kds` | optional | 2 | off | off | Kitchen Display System surface. |
| `customer-display` | optional | 2 | off | off | Customer-facing second-monitor display. |
| `mobile-waiter` | optional | 2 | off | off | Table-side mobile waiter surface. |
| `delivery` | optional | 2 | off | off | Delivery / domicilios surface. |

`Default` is the manifest `defaultEnabled` fallback (what an unconfigured tenant
resolves to — UNCHANGED by ENG-183 so existing tenants keep their choices).
`Ring-1 retail` is `RING1_RETAIL_PROFILE`, the explicit set written for a fresh
tenant at creation (`db/seed.ts`). The two differ only on the AI modules: an
existing tenant that never toggled them keeps them on (fallback), while a
brand-new retail tenant gets them off.

## Invariants

- Every guarded procedure still scopes by `ctx.tenantId`.
- Module state never replaces role checks; it composes with them.
- Adding a module must not silently activate it for existing tenants
  unless the manifest default explicitly preserves current behavior.
- Deactivation must not orphan operational records or break historical
  reports.
- User-facing module copy ships in both `en` and `es`.
- Any route gated by a module needs live smoke for active and inactive
  states when the route changes.

## Example: KDS Module

The KDS module illustrates the shipped pattern:

1. Module state gates `kds.*` procedures and the `/kds` route.
2. `sales.suspend` and `completeSale` enqueue KDS rows only when the
   module is active and the sale belongs to a restaurant table.
3. Existing sales remain valid if KDS is later deactivated.
4. `ENG-117` can extend the module with station routing, served state,
   and waiter views without changing the activation contract.

## Testing Checklist

- Active module allows the route and server procedure for an authorized
  role.
- Inactive module returns `MODULE_NOT_ACTIVATED` and hides the route.
- Cross-tenant state does not leak.
- Toggle writes an audit row.
- Default-on modules preserve current behavior for existing tenants.
- Default-off modules stay hidden until activated.
