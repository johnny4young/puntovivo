# Market Segments Coverage

> Status: strategic planning document.
> Created: April 21, 2026.
> Canonical reference for ring-based market strategy.

## Three Rings

Puntovivo's market strategy is organized into three concentric rings.
Each ring activates via the **module activation system** (see
[MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md)) so a minimarket does
not carry restaurant or pharmacy code at runtime.

### Ring 1 — Generic retail MVP (target: 8-10 weeks)

Covers ~80% of Colombian retail POS market.

| Vertical | Covered by |
| --- | --- |
| Neighborhood store, minimarket | Base POS + fiscal + hardware |
| Papelería, ferretería | Base + fractional units (already shipped) |
| Boutique (clothing, shoes) | Base + product variants (Phase 6 item) |
| Carnicería, fruver, pescadería | Base + scale integration + EAN-13 price-embedded parsing |
| Panadería, heladería, cafetería | Intersection with Ring 2 restaurant-lite |
| Droguería (OTC only, no Rx) | Base + lots/expiry (Phase 7) |

### Ring 2 — Restaurant + Pharmacy (target: +8-10 weeks after Ring 1)

**Restaurant module** ([RESTAURANT-LIFECYCLE.md](./RESTAURANT-LIFECYCLE.md)):
- Product composition / BOM ([PRODUCT-COMPOSITION.md](./PRODUCT-COMPOSITION.md))
- Tables + table sessions
- Preparation lifecycle + KDS
- Modifiers (sin cebolla, término medio)
- Touch UI for waiters
- One delivery integration (Rappi)

**Pharmacy module**:
- Lots + expiration dates
- INVIMA code validation
- Prescription workflow (Rx products flagged, controlled substance register)
- Insurance / EPS integration basics

### Ring 3 — Service verticals (target: +12 weeks after Ring 2)

Shared **appointments + services + commissions + client assets** module,
then specialized layers per vertical.

| Vertical | Specialization |
| --- | --- |
| Salones / barberías / spas | Stylist-level commissions, package deals |
| Veterinarias | Pet clinical history, controlled substances, pet packages |
| Talleres mecánicos / electrodomésticos | Work orders, parts + labor, client vehicle |
| Gimnasios | Subscriptions, check-in at door, classes |

Cross-vertical infrastructure shared between these four domains — one
module, four deploy targets.

## Beyond Ring 3

See:
- [FUTURE-VERTICALS.md](./FUTURE-VERTICALS.md) — CO + LatAm extended
  verticals (colleges, tour operators, florist, food trucks, …)
- [LATAM-EXPANSION.md](./LATAM-EXPANSION.md) — fiscal adapter expansion
  to Ecuador, Peru, Chile, Mexico, Argentina, etc.
- [LONG-TERM-VISION.md](./LONG-TERM-VISION.md) — cross-cutting platform
  features (BI, franchises, public API, AI, IoT)

## Prioritization heuristic

A feature ships with the **earliest ring** that uses it — features
required by Ring 1 always precede Ring 2, etc. Within a ring, prioritize
legal blockers > UX blockers > differentiators.
