/**
 * Fiscal country packs barrel.
 *
 * Each pack exports an `AdapterClass` that the registry instantiates
 * on demand. Adding a new country = (1) drop a new directory under
 * this folder, (2) export the adapter class from its `index.ts`, (3)
 * register it in `services/fiscal/registry.ts::ADAPTER_FACTORIES`.
 *
 * @module services/fiscal/packs
 */

export { ColombiaMockAdapter } from './co/index.js';
export { MexicoCFDIAdapter } from './mx/index.js';
export { ChileNotImplementedAdapter } from './cl/index.js';
