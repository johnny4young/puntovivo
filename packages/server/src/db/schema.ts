/**
 * Drizzle ORM Schema for Puntovivo POS System
 *
 * This is the source-of-truth schema for the SQLite database.
 * All tables support multi-tenant isolation via tenant_id.
 *
 * ENG-178 — this file was a 5430-LOC monolith; it is now a thin barrel that
 * re-exports the per-domain modules under `db/schema/`. Kept as `db/schema.ts`
 * (not `schema/index.ts`) so all 263 importers + the drizzle-kit `schema:`
 * path resolve unchanged; the table/column/index/FK/relation shape is
 * shape-identical (drizzle-kit generate emits no migration); only four base
 * helper declarations gained `export` so domain modules can share them.
 *
 * @module db/schema
 */
export * from './schema/base.js';
export * from './schema/auth.js';
export * from './schema/labor.js';
export * from './schema/approvals.js';
export * from './schema/catalogs.js';
export * from './schema/products.js';
export * from './schema/customers.js';
export * from './schema/purchasing.js';
export * from './schema/sales.js';
export * from './schema/salesAux.js';
export * from './schema/inventory.js';
export * from './schema/quotationsAudit.js';
export * from './schema/devices.js';
export * from './schema/config.js';
export * from './schema/fiscal.js';
export * from './schema/hardware.js';
export * from './schema/syncAi.js';
export * from './schema/types.js';
export * from './schema/realtime.js';
