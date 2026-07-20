/**
 * Fiscal reports Zod schemas.
 *
 * The fiscal reports surface is the first consumer of
 * `fiscal_documents` + `fiscal_document_items`. Inputs are deliberately
 * minimal for estado actual — kind/status filters, paged list, and
 * `getByCufe` lookup.  will widen the filters (issuer/buyer
 * search, contingency queue, exports).
 *
 * @module trpc/schemas/fiscal
 */

import { z } from 'zod';
import {
  fiscalDocumentKindEnum,
  fiscalDocumentSourceEnum,
  fiscalDocumentStatusEnum,
} from '../../db/schema.js';

export const fiscalDocumentKindSchema = z.enum(fiscalDocumentKindEnum);
export const fiscalDocumentStatusSchema = z.enum(fiscalDocumentStatusEnum);
export const fiscalDocumentSourceSchema = z.enum(fiscalDocumentSourceEnum);

/** CUFE = SHA-384 hex digest. Always 96 lowercase hex chars. */
export const cufeSchema = z
  .string()
  .regex(/^[0-9a-f]{96}$/, 'CUFE must be a 96-character lowercase hex string');

export const listFiscalDocumentsInput = z
  .object({
    limit: z.number().int().positive().max(200).default(50),
    offset: z.number().int().nonnegative().default(0),
    kind: fiscalDocumentKindSchema.optional(),
    status: fiscalDocumentStatusSchema.optional(),
    source: fiscalDocumentSourceSchema.optional(),
    /** ISO datetime — include rows emitted on/after. */
    fromDate: z.string().datetime({ offset: true }).optional(),
    /** ISO datetime — include rows emitted on/before. */
    toDate: z.string().datetime({ offset: true }).optional(),
  })
  .default({ limit: 50, offset: 0 });

export type ListFiscalDocumentsInput = z.infer<typeof listFiscalDocumentsInput>;

export const getFiscalDocumentByCufeInput = z.object({
  cufe: cufeSchema,
});

export type GetFiscalDocumentByCufeInput = z.infer<typeof getFiscalDocumentByCufeInput>;

/** operator-driven retry of a stuck fiscal document. */
export const retryFiscalDocumentInput = z.object({
  fiscalDocumentId: z.string().min(1, 'fiscalDocumentId is required'),
});

export type RetryFiscalDocumentInput = z.infer<typeof retryFiscalDocumentInput>;

/**
 * lazy XML body fetch. Input is the internal
 * `fiscal_documents.id` (NOT the cufe) so the procedure can reuse the
 * tenant-scoped primary-key index. Cross-tenant access collapses to
 * `FISCAL_DOCUMENT_NOT_FOUND` so we never leak the row's existence.
 */
export const getFiscalXmlInput = z.object({
  documentId: z.string().min(1, 'documentId is required'),
});

export type GetFiscalXmlInput = z.infer<typeof getFiscalXmlInput>;
