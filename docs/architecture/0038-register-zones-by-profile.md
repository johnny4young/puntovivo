# 0038 — Register zones by business profile

**Language:** English · [Español](../es/architecture/0038-register-zones-by-profile.md)

> Status: Accepted
> Date: 2026-11-21

## Context

Module presets turn whole surfaces on or off (touch POS, kitchen display,
tables), but desktop Vender looked the same for every business. A pharmacy saw
one-touch keys and a store-credit shortcut it never uses, and a corner store saw
the restaurant tip section in every charge.

## Decision

- `packages/shared/src/register-zones.ts` is the single registry of register
  zones and the default matrix per business profile. Retail covers both the
  corner store and the minimarket, so it carries the union of their zones. A
  tenant without a profile keeps every zone on.
- The command bar and the checkout (total, Charge, incidents) are locked on for
  every profile.
- Admins override single zones in `tenants.settings.registerZones` through the
  audited `registerZones.set`. A value equal to the profile default removes the
  override, so the zone follows the profile again; overrides survive a profile
  change.
- Overrides reach every register through the `auth.me` settings projection, at
  sign-in, staff switch or restart, the same way the business profile does.
  `useRegisterZone` resolves profile, override and module gate on the client.
- Seating a ticket at a table goes through the park prompt, so the tables zone
  also shows Suspender.
- Modules stay the gate for surfaces: a zone that needs a module (tables need
  dine-in, quotes need quotations) renders only while that module is on.
- Every zone outside the engine can be switched.
- Zones only hide register controls. Pricing, promotions, compliance (lot,
  prescription) and sales already parked keep working when their zone is off.

## Consequences

- No migration: the override lives in the existing settings JSON.
- Zones wired today: one-touch keys, amount keys, store credit (the account
  bar with its abono, the Fiar key beside Cobrar and the charge drawer), parking, expiry discount badges (ticket lines, keys
  and product search), the unit picker in product search, the quotation banner,
  table actions when parking, tips and bill splitting.
- With the unit zone off, product search sells the base unit; a scanned
  presentation barcode still sells that presentation.
- The touch POS keeps its own catalog grid; zones shape desktop Vender and its
  phone layout.
