# Migration Plan Status

> Updated: April 9, 2026
> Purpose: preserve the migration context without pretending the repo is still at day one

This document used to be the active roadmap for migrating the legacy WinForms application into the
current Electron + React + Fastify stack.

It is now a historical-reference summary with live annotations.
For current execution status, use:
[IMPLEMENTATION_STATUS.md](/Users/johnny4young/Personal/github/open_yojob/docs/IMPLEMENTATION_STATUS.md)

## Migration Outcome

The migration is functionally successful for the main product surface:

- desktop shell is operational
- embedded backend is operational
- tRPC replaced the legacy REST-first application path
- administration/catalog modules are live
- product and pricing flows are live
- inventory flows are live
- sales and purchases are live
- dashboard and export/reporting flows are live

## What the Current Repo Added Beyond the Early Plan

The live codebase now includes items that were either future-facing or absent from the original
plan:

- geography hierarchy with countries, departments, and cities
- customer classification catalogs and commercial activities
- locations and site-location assignments
- provider-category assignments
- orders with receive-into-purchase workflow
- tenant logo catalog and active company logo selection
- sale refunds through `sale_returns`
- desktop backup / restore, tray, theme, update, and print settings
- merged sync conflict resolution UI

## Migration Areas Considered Complete

| Area | Status |
| --- | --- |
| Transport migration to tRPC | Complete |
| Auth and tenant isolation | Complete |
| Admin/master data foundation | Complete |
| Product management | Complete |
| Inventory workflows | Complete |
| Sales workflows | Complete |
| Procurement workflows | Complete |
| Dashboard and export reporting | Complete |

## Migration Areas Still Open

The remaining migration-adjacent work is no longer “move feature X from legacy to new stack”.
It is mostly enhancement and hardening work:

- richer site-aware inventory ownership model
- purchase returns and other reverse logistics
- remote sync strategy clarification
- desktop security tightening
- performance and packaging cleanup

Those are tracked in:
[OPEN_BACKLOG.md](/Users/johnny4young/Personal/github/open_yojob/docs/OPEN_BACKLOG.md)

## Practical Guidance

When a legacy reference conflicts with the current repo:

1. trust the code in `apps/` and `packages/server/`
2. trust `docs/IMPLEMENTATION_STATUS.md`
3. treat old phase language as historical context only
