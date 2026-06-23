/**
 * Receipt Template Service — public barrel.
 *
 * Re-assembles the per-concern modules into the original public surface
 * (7 functions + their arg/option types + the record type) so importers
 * resolve unchanged.
 *
 * @module services/receipt-templates
 */

export type { ReceiptTemplateRecord } from './types.js';
export { createReceiptTemplate, type CreateReceiptTemplateArgs } from './create.js';
export { updateReceiptTemplate, type UpdateReceiptTemplateArgs } from './update.js';
export { deleteReceiptTemplate, type DeleteReceiptTemplateArgs } from './delete.js';
export { setDefaultReceiptTemplate, type SetDefaultReceiptTemplateArgs } from './setDefault.js';
export { duplicateReceiptTemplate, type DuplicateReceiptTemplateArgs } from './duplicate.js';
export {
  listReceiptTemplates,
  getReceiptTemplateById,
  type ListReceiptTemplatesOptions,
} from './read.js';
