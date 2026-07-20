/**
 * DTE 1.0 serializer () — public barrel.
 *
 * Re-assembles the per-concern modules into the original public surface
 * (the two serialize functions + the result type) so importers resolve
 * unchanged. The constants, format/node helpers, and the private node
 * interfaces stay non-public.
 *
 * @module services/fiscal/packs/cl/dte10-xml
 */

export { serializeDte10, prettyPrintDte } from './serialize.js';
export type { SerializedDte10 } from './types.js';
