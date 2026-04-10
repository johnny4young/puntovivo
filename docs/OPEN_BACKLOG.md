# Open Backlog

> Updated: April 10, 2026
> Purpose: single file for current gaps, bugs, improvements, hardening, and suggested next steps

This file replaces the old habit of spreading pending work across historical migration notes.

## Priority 1: Core Product Gaps

- Inventory is still tenant-wide rather than truly site-owned.
  Impact: site-to-site transfer workflows would be misleading until stock ownership is modeled per site or per location.

- Orders already support partial receipt, but procurement still lacks some follow-through around receiving workflows.
  Examples: stronger operator guidance around staged deliveries, clearer audit/reporting around multi-receipt orders, and tighter downstream reconciliation after mixed receive/return scenarios.

- Procurement still lacks some edge-case follow-through beyond the live purchase-return workflow.
  Examples: richer supplier credit-note handling, more explicit reconciliation after mixed return/void scenarios, and stronger audit surfaces around return approvals.

- There is no explicit credit-note or accounting layer beyond operational refund/void status.
  Impact: fiscal and accounting reconciliation may need a richer document model later.

## Priority 2: Sync and Offline Hardening

- The sync system has local queueing, conflict handling, and admin tooling, but the remote replication story is still underspecified.
  Suggestion: document the intended upstream authority, push/pull semantics, and conflict ownership model before expanding the feature set further.

- Browser IndexedDB offline helpers and Electron desktop DB bridge coexist.
  Suggestion: define a long-term ownership boundary so offline behavior stays predictable across browser-only and desktop modes.

- Sync observability is still shallow.
  Suggestion: add richer audit/log surfaces for queue failures, repeated conflicts, and last successful remote reconciliation by tenant.

## Priority 3: Security and Operational Risks

- Main Electron window still runs with `sandbox: false`.
  Impact: the project already uses context isolation and disabled node integration, but sandboxing remains a meaningful hardening gap.

- Sensitive admin actions do not yet have a full audit trail.
  Candidates: user changes, backup restore, sync conflict resolution, purchase void, sale refund, company settings updates.

- Dependency and packaging review should continue.
  Known theme: keep checking Electron-adjacent packages and export/reporting dependencies.

## Priority 4: Performance and UX Polish

- The web build still emits large Vite chunk warnings.
  Suggestion: the route surface is now lazy-loaded, so the next pass should focus on the remaining export-heavy chunk (`exceljs`) and any other library-level splits that still exceed Vite's warning threshold.

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

1. Site-aware inventory ownership model
2. Electron main-window sandbox hardening
3. Library-level splitting for export/reporting dependencies after route lazy loading
4. Procurement audit and credit-note follow-up after returns
5. Broader Electron and sync smoke coverage
