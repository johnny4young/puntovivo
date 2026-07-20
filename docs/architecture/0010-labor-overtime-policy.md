# 0010 — Labor Overtime Policy Evidence

> Status: Accepted
> Date: 2026-07-15

## Decision

Puntovivo derives overtime as effective-dated, country-specific evidence from immutable attendance intervals; it does not persist a mutable overtime total or claim a payroll-final currency amount.

The reviewed baseline lives in `packages/server/src/services/labor/overtime-policy.ts`. Each profile carries a stable id, effective date, statutory daily and weekly thresholds where they can be proven, official sources, and explicit limitations; the same catalogue defines the supported premium categories. `overtime-calculator.ts` subtracts audited breaks, splits work in the tenant timezone, and allocates regular time before overtime without counting the same seconds under both daily and weekly rules.

Calculations cover all of an employee's shifts inside the tenant and complete labor week. A site filter changes only which evidence rows are displayed; it cannot hide hours worked at another tenant site from the weekly threshold. Results remain advisory because employee contract hours, collective agreements, holiday/substituted-rest calendars, and some authorised schedule types are not yet modeled.

## Alternatives Rejected

- **Store overtime totals on each shift** — legal thresholds and corrections are effective-dated; persisted derived totals would become stale or require destructive rewrites of historical evidence.
- **Calculate only the requested site or page** — weekly labor thresholds apply to the employee's tenant-wide work and must not change with pagination or a manager's UI filter.
- **Return payroll currency automatically** — Puntovivo does not yet hold enough contract, holiday, collective-agreement, or wage data to make a payroll-final money claim.
- **One timeless rule per country** — Colombia and Chile already have legislated transition dates, so a static rule would misclassify history and future weeks.

## Implementation Impact

- `packages/server/src/services/labor/overtime-policy.ts` owns reviewed profiles for CO, MX, CL, PE, and AR plus their official source URLs and limitation codes.
- `packages/server/src/services/labor/overtime-calculator.ts` is a pure tenant-timezone classifier over attendance and break evidence.
- `packages/server/src/services/labor/attendance-report.ts` expands the calculation window to complete labor weeks and all tenant sites for the employees visible on the requested page.
- `apps/web/src/features/staff/TeamAttendancePanel.tsx` displays regular/overtime duration, premium buckets, the applied profile, official provenance, and an advisory warning.
- Future payroll and accounting exports must consume these duration/category results and add contract/rate/calendar data; they must not duplicate country thresholds.

## Implementation map

- shift management, attendance evidence, overtime, and future payroll exports.
- tip distribution by hours must consume the same net-work evidence boundaries.
- Colombia electronic payroll is gated but will consume classified duration plus payroll-specific data.

Updated: 2026-07-15 — accepted with .
