/**
 * CFDI 4.0 serializer () — public barrel.
 *
 * Re-assembles the per-concern modules into the original public surface
 * (the two serialize functions + the result type) so importers resolve
 * unchanged. The constants, receptor/concepto/format helpers, and the
 * private node interfaces stay non-public.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml
 */

export { serializeCfdi40, prettyPrintCfdi } from './serialize.js';
export type { SerializedCfdi40 } from './types.js';
