// domain-entity type barrel ( slice 28).
//
// Re-assembles the per-domain modules into the original `types/domain`
// public surface so importers (`types/index.ts` shim + the direct
// `@/types/domain` consumers) resolve unchanged.

export * from './auth';
export * from './catalogs';
export * from './products';
export * from './customers';
export * from './sales';
export * from './cash';
export * from './inventory';
export * from './transfers';
export * from './audit';
export * from './quotations';
export * from './purchasing';
export * from './sync';
