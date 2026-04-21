# Future Verticals — CO + LatAm Extensions

> Status: vision document, beyond the MVP rings.
> Created: April 21, 2026.

See [MARKET-SEGMENTS.md](./MARKET-SEGMENTS.md) for Rings 1-3 (MVP +
restaurant/pharmacy + services). This document lists **Ring 4+** —
verticals that fit Puntovivo's architecture but are deferred past the
initial mission.

## Colombian verticals (Ring 4)

| Vertical | Unique features | Reuses | Effort |
| --- | --- | --- | --- |
| Colleges, universities, academies | Recurring tuition, cohorts, academic calendars, student ID + QR, on-campus cafeterias (sub-tenants) | Subscriptions + appointments + retail | 4-6 weeks |
| Driving schools | N-class courses, mandatory attendance, final exam, RUNT reporting | Appointments + subscriptions | 3 weeks |
| Travel agencies / tour operators | Partial-payment reservations, adviser commissions, bundled packages | Deposits + commissions | 4 weeks |
| Event venues / wedding planners | Packages with milestone payments, associated vendors, event timeline | Plans + calendar | 3-4 weeks |
| Florists and funeral homes | Delivery scheduling, recurring reminders, composed arrangements | Composition + delivery | 3 weeks |
| Daycare centers | Enrollment, daily attendance, monthly fees, parent reporting | Attendance + subscriptions + messaging | 4 weeks |
| Martial arts academies | Belt ranks / levels, grade exams, per-student progress, tournaments | Subscriptions + progress | 3 weeks |
| Music / art schools | Private vs group lessons, instrument rentals | Appointments + rentals | 4 weeks |
| Food trucks / ambulant commerce | Mobile POS without fixed site, daily GPS of sale point | Mobile-first UI + geo | 3 weeks |
| Farmers markets / feria | Multi-vendor under one organizer tenant, commissions | Sub-tenants + commissions | 5 weeks |
| Private medical/dental offices | EHR, EPS billing, medical authorizations, lab results | Appointments + assets + compliance-lite + EPS | 6-8 weeks |
| Clinical labs | Sample intake, digital results (bacteriologist digital signature), EPS/particular billing | Appointments + document signing + EPS | 6 weeks |
| Pet shops with grooming | Retail + appointments + service history | Full stack intersection | 4 weeks |
| Home-service trades (carpentry, plumbing, electrical) | On-site estimates, scheduled visits, crews, parts + labor | Work orders + appointments + teams | 5 weeks |
| Recurring home services (cleaning, gardening) | Weekly/monthly contracts, crews, routing | Subscriptions + teams + scheduling | 4 weeks |
| Churches and NGOs | Recurring donations, tax certificate generator, fund-raising events | Subscriptions + tax docs | 3 weeks |
| Farms and ranches | Lot/animal traceability, SIPSA/ICA reports | Composition + hierarchical tracking | 8-12 weeks |
| Private clubs (picaderos, galleras) | Culturally specific, highly regulated | Restaurant + membership | 3-4 weeks |
| Border-zone stores (Cúcuta, Leticia) | Dual currency (COP/VES/BRL), exchange controls, dual tax authority | Multi-currency hard + dual fiscal | 6-8 weeks |

## LatAm-specific verticals

Not all regional verticals map cleanly to Colombia. A few with unique
demand elsewhere:

- Taquerías, cevicherías, formalized street food (MX, PE)
- Wholesale hub markets (MX, AR)
- Cantinas / pulperías with fiado (covered by credit sales)
- Pollerías and rotisseries (cafeteria + pre-cooked)
- Small casinos (PA, CR, DO) — heavily regulated, likely out of scope
- Liquor stores with delivery (CL, MX, AR) — retail + delivery + age
  verification
- Tobacconists / cigarreterías — retail + age verification
- Rental plots / quinchos (AR, CL, UY) — Airbnb-local style reservations

## Classification

For each vertical:

- **Fit with current architecture**: high (needs only existing or planned
  modules) / medium (needs one new shared module) / low (conflicts with
  architecture)
- **Market size (CO or regional)**
- **Competitive pressure**: who already dominates this vertical?

These classifications are updated per quarter as market research
refreshes. Engineering planning uses them to pick which Ring 4 vertical
to fund next.

## Guiding principle

No vertical ships as a fork. Every Ring 4 vertical becomes a
[MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md)-compatible module —
additive tables, namespaced routers, lazy-loaded routes. The core stays
lean as verticals accumulate.
