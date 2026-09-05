# 0017 — Vertical profiles, operational precision, and site GS1 authority

> Status: Accepted
> Date: 2026-09-01

## Context

Ferreterías and butcher shops share the retail sale, inventory, purchase, and
cash kernels, but their normal catalog entry differs. Hardware commonly needs
length, serial, or lot tracking. Butcher counters need thousandth quantities,
lot traceability, and variable-measure labels whose 20–29 prefix meaning is
configured by the scale at one site.

A business-profile selection must not rewrite an established catalog. A
renderer-supplied GS1 interpretation would also be unsafe: a modified or stale
client could reinterpret a price payload as weight, and two sites may use
different scale layouts. Existing tenants already have scanners without an
explicit prefix map and products whose positive fraction policy may be finer
than new UI defaults.

## Decision

### Profiles and product-entry templates

- The shared closed profile set includes `hardware` and `butchery` alongside
  the existing retail, restaurant, quick-service, and wholesale profiles.
- Applying a profile records `tenant.settings.businessType` and changes only
  the server-owned surface-module patch. Hardware enables quotations and the
  operations center; butchery enables POS Touch and the operations center.
  Restaurant surfaces remain disabled in both profiles.
- Profile application never creates, renames, or modifies categories, products,
  units, prices, stock, lots, or serials. AI and integration settings remain
  outside every profile patch.
- Hardware and butchery expose explicit create-product templates only after the
  corresponding profile is selected. A template mutates the unsaved form,
  resolves one active existing unit by normalized abbreviation and physical
  dimension, preserves configured Tier 2 and Tier 3 prices, and leaves the form
  unchanged when no compatible unit exists. Weighted templates additionally
  require the same positive mass reference factor enforced by scanner lookup.
- Templates configure only the sellable catalog item. They do not consume
  inputs or claim yield, waste, cutting, recipes, remnants, or lot
  transformations. Those operations use the separate transactional inventory
  engine in [ADR-0018](./0018-lot-procurement-and-transformations.md); applying
  a template never creates a recipe or executes stock.

### Quantity precision

- `0.001` is the smallest increment exposed by current product, unit,
  sale-cart, purchase, and order controls.
- That constant is an operational renderer/input floor, not a new server
  rejection minimum. The server retains any valid positive historical
  fraction policy and validates sale quantity against the product's stored
  step and minimum.
- Quantity normalization remains separate from two-decimal money rounding.
  A sale, purchase, or order can retain `0.001` while each monetary
  intermediate continues through the existing `roundMoney` contract.

### Site-authoritative GS1 decoding

- An active keyboard-wedge scanner may persist an optional, non-overlapping
  map from in-store prefixes 20–29 to `weight` or `price`. Prefixes omitted
  from both roles are ordinary EAN-13 codes.
- Without an explicit map, the compatibility layout remains even prefix =
  weight and odd prefix = price. `gs1Scheme: none` disables embedded
  interpretation.
- Product lookup accepts the raw barcode and parse policy only. For a
  13-digit 2x code, the server resolves the active scanner from
  `tenantId + ctx.siteId`, parses its persisted configuration, and then
  decodes. The renderer cannot submit an alternate map.
- A decoded weight is expressed in kilograms. It requires an explicit base
  unit whose physical dimension is `mass` and whose positive reference factor
  converts through canonical grams. Only the converted base-unit quantity is
  checked against the product's authoritative fractional sale policy. Missing,
  non-mass, whole-unit, below-minimum, and step-misaligned configurations fail
  before creating a cart line.
- Variable-measure layouts resolve only the product's own five-digit barcode.
  They never fall back to a packaging-unit barcode, because combining a scale
  quantity with an unrelated packaging equivalence would corrupt stock.
- A price-encoded layout carries the price payload of one whole package. It is
  rejected for fractional products because the label carries no defensible
  stock quantity; those products must use a configured weight prefix. In the
  cart the payload is the package unit price under the tenant's normal
  inclusive or exclusive tax mode, not a trusted exemption from price-override
  controls.
- A missing scanner at a valid site retains compatibility behavior. Absence of
  an active site disables embedded interpretation, and an active legacy row
  with malformed or ambiguous GS1 configuration fails closed to ordinary EAN
  lookup rather than guessing a role.
- Repeated weight labels add their exact converted quantities. Price packages
  use a cents-normalized line identity: equal encoded prices may increment one
  line, different prices remain distinct, and frozen server item IDs preserve
  those repeated product/unit rows after suspend/resume.
- Ordinary barcodes and search text do not query scanner configuration. The
  extra indexed read is limited to 13-digit 2x candidates.
- Country scheme names remain compatibility selectors over the current generic
  five-digit SKU/five-digit payload layout. They do not claim that every
  Colombia, Mexico, or Chile scale uses that layout.

## Consequences

- Selecting a profile is reversible module configuration and cannot damage an
  existing catalog.
- Newly confirmed profile state is mirrored into the authenticated renderer
  session so product templates appear immediately; `auth.me` remains the
  authority after reload.
- A cashier cannot change the amount/quantity semantics of a variable-measure
  label through request input, and site-specific scale layouts do not leak
  across tenants or sites.
- A kilogram payload cannot be applied directly to metres, pieces, an
  unclassified legacy unit, or a packaging equivalence. Operators must first
  classify the product's base unit; kilogram and gram bases are converted
  deterministically through their stored reference factor.
- Existing scanners with empty configuration keep historical behavior.
  Corrupt active configuration requires operator repair instead of silent
  reinterpretation.
- The global omnibox and the mounted register share one cart-resolution
  pipeline. Normal barcode additions honor the workspace's explicit customer
  tier; GS1 price lines stay marked as frozen overrides. A cashier completion
  requires a `sale_price_override` manager grant bound to the exact cart,
  customer, tender mix and total. Manager/admin roles keep direct authority;
  accepted quotations retain the manager/admin authorization that created
  their frozen terms. Legacy drafts without catalog-price snapshots fail
  closed as unverifiable overrides. The checkout preflight derives the visible
  action from the current tenant catalog or the draft's frozen snapshots, not
  renderer metadata; completion repeats the check independently so the read
  remains guidance rather than authorization.
- Software parsing and deterministic fixtures do not certify a physical scale,
  scanner, label format, legal metrology requirement, or printer integration.

## Alternatives rejected

- **Create units and products when selecting a profile:** silently mutates
  catalogs and cannot distinguish a new tenant from a running store.
- **Send GS1 mappings from React:** trusts stale or modified client state for a
  money/quantity decision.
- **Use one tenant-wide prefix map:** breaks stores whose sites have different
  scales or label firmware.
- **Force every server quantity to a 0.001 minimum:** would reject valid
  historical policies and confuse UI capability with domain authority.
- **Fold cutting into a product template:** cannot atomically account for input
  lots, outputs, yield, waste, or cost allocation; the dedicated engine keeps
  that transaction and evidence separate.

## Verification evidence

- `packages/shared/src/vertical-product-templates.test.ts`,
  `packages/shared/src/gs1.test.ts`, and the shared unit tests pin the closed
  contracts and compatibility layout.
- `packages/server/src/__tests__/module-presets.test.ts` proves profile patches
  and that consecutive profile changes leave tenant catalog rows unchanged.
- `packages/server/src/__tests__/products-lookupByBarcode.test.ts`,
  `peripherals-router.test.ts`, `peripherals-registry.test.ts`, and
  `peripherals-barcode-parser.test.ts` pin tenant/site authority,
  compatibility, invalid-row failure, and typed configuration validation.
- Sale, purchase, order, fraction-policy, product-modal, cart, scanner,
  peripheral-form, and authenticated-session regressions preserve thousandths,
  explicit template application, and immediate profile coherence.
- Checkout approval integration covers current catalog reads, frozen drafts,
  exact grant binding, one-time consumption, immutable audit, stale renderer
  metadata, and a foreign-tenant catalog probe.
- An isolated authenticated Chromium smoke applied both profiles, created and
  reloaded MT/KG products, persisted a per-site mapping, and delivered a raw
  wedge burst whose server-owned decode added `0.199 kg`; the bounded final
  continuation reported zero browser client errors.
