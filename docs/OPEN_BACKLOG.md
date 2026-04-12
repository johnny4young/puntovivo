# Open Backlog

> Updated: April 11, 2026
> Purpose: single file for current gaps, bugs, improvements, hardening, and suggested next steps

This file replaces the old habit of spreading pending work across historical migration notes.

## Priority 1: Core Product Gaps

- Inventory is still tenant-wide rather than truly site-owned.
  Impact: site-to-site transfer workflows would be misleading until stock ownership is modeled per site or per location.

- There is no first-class cash session model.
  Impact: no opening/closing cash, drawer reconciliation, discrepancy handling, or cashier accountability per shift.

- There is no quotation / estimate / proforma workflow.
  Impact: the product is weaker for B2B, service businesses, and pre-sale conversion flows.

- Loyalty, promotions, gift cards, and store credit are missing.
  Impact: the product is behind mainstream POS expectations for retention and repeat-purchase mechanics.

- Omnichannel fulfillment is missing.
  Impact: there is no native buy-online-pickup-in-store, ship-from-store, or cross-channel order handling model.

- Fiscal localization is shallow.
  Impact: the system has taxes and sequentials, but not a country-adapter model for Colombia-first compliance and later multi-country expansion.

- Outbound logistics and transport execution are missing.
  Impact: there is no pick/pack/ship flow, shipment tracking, dispatch, proof of delivery, or delivery exception model.

- Orders already support partial receipt, but procurement still lacks some follow-through around receiving workflows.
  Examples: richer audit/reporting around multi-receipt orders and tighter downstream reconciliation after mixed receive/return scenarios. The operator-facing staged-delivery guidance and quick receive access are now live in the orders workflow.

- Procurement still lacks some edge-case follow-through beyond the live purchase-return workflow.
  Examples: richer supplier credit-note handling, more explicit reconciliation after mixed return/void scenarios, and stronger approval-oriented audit surfaces. Purchase history/export now expose basic return audit metadata plus the latest return actor, so the next pass should move past visibility into approval and accounting follow-through.

- There is no explicit credit-note or accounting layer beyond operational refund/void status.
  Impact: fiscal and accounting reconciliation may need a richer document model later.

- There is no public integration layer with webhooks/API keys.
  Impact: accounting sync, ecommerce bridges, and partner ecosystem work all stay harder than they should be.

## Priority 2: Sync and Offline Hardening

- The system does not yet have a formal hybrid data topology contract for “local SQLite plus remote authority”.
  Suggestion: define supported runtime modes, sync acknowledgement semantics, and conflict ownership before attempting PostgreSQL support.

- Persistence is still tightly coupled to SQLite-specific Drizzle and `better-sqlite3` internals.
  Suggestion: introduce repository and dialect boundaries before implementing PostgreSQL or remote-authority deployments.

- The sync system has local queueing, conflict handling, and admin tooling, but the remote replication story is still underspecified.
  Suggestion: document the intended upstream authority, push/pull semantics, and conflict ownership model before expanding the feature set further.

- Browser IndexedDB offline helpers and Electron desktop DB bridge coexist.
  Suggestion: define a long-term ownership boundary so offline behavior stays predictable across browser-only and desktop modes.

- Sync observability is still shallow.
  Suggestion: the sync center now shows retry/failure counts, oldest queued work, and last successful sync time. The next pass should add richer audit/log surfaces for queue failures, repeated conflicts, and per-tenant reconciliation history.

## Priority 3: Security and Operational Risks

- Main Electron window still runs with `sandbox: false`.
  Impact: the project already uses context isolation and disabled node integration, but sandboxing remains a meaningful hardening gap.

- Sensitive admin actions do not yet have a full audit trail.
  Candidates: user changes, backup restore, sync conflict resolution, purchase void, sale refund, company settings updates.

- Dependency and packaging review should continue.
  Known theme: keep checking Electron-adjacent packages and export/reporting dependencies.

## Priority 4: Performance and UX Polish

- Responsive/mobile refinement is strongest in Sales and weaker in some admin/maintenance screens.
  Suggestion: continue responsive QA across inventory, company settings, and larger catalog pages.

- The current app has strong loading/retry/toast primitives, but not every feature screen uses the exact same feedback quality level yet.
  Suggestion: continue normalizing older screens onto the shared feedback components.

## Priority 5: Testing Gaps

- Desktop features still lean heavily on unit/type checks and manual verification.
  Gaps: printer behavior, backup/restore drills, tray behavior across OSes, packaged auto-update flows.

- There is little true end-to-end coverage across renderer + embedded backend + Electron bridge.
  Suggestion: add targeted Electron/Playwright smoke coverage for the most critical workstation flows.

- Sync behavior would benefit from more scenario tests around conflicts, retries, and mixed desktop/web usage.

## Priority 6: Documentation and Ops

- The project now needs a cleaner operator runbook layer in addition to dev docs.
  Suggested additions:
  - backup/restore runbook
  - sync conflict resolution playbook
  - release verification checklist
  - workstation provisioning guide

- The terminology around tenant, site, location, order, purchase, void, and refund is now important enough to warrant a dedicated domain glossary.

## Suggested Next Slices

If the team wants a practical implementation order, the strongest next candidates are:

1. Cash management and shift control
2. Site-aware inventory ownership model
3. Stock transfers between sites/locations
4. Fulfillment logistics documents: pick list, packing, delivery note
5. Dispatch, shipment tracking, and proof of delivery
6. Audit trail for sensitive actions
7. Hybrid SQLite + remote authority architecture groundwork
8. Quotations and quote-to-order
9. Loyalty / promotions / store credit
10. Colombia-oriented fiscal localization layer
