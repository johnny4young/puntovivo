/**
 * Drizzle schema — stable inventory-domain barrel.
 *
 * table, index, foreign-key, relation, and inferred-type exports
 * remain available through this path while focused modules own each inventory
 * concern. Importers and drizzle-kit continue to resolve schema/inventory.js.
 *
 * @module db/schema/inventory
 */

export * from './inventory/core.js';
export * from './inventory/transfers.js';
export * from './inventory/lots.js';
