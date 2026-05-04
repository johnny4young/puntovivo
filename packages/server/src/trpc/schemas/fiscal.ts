/**
 * ENG-020 — Fiscal reports Zod schemas.
 *
 * The fiscal reports surface is the first consumer of
 * `fiscal_documents` + `fiscal_document_items`. Inputs are deliberately
 * minimal for Fase A — kind/status filters, paged list, and
 * `getByCufe` lookup. ENG-021 will widen the filters (issuer/buyer
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

/** ENG-057 — operator-driven retry of a stuck fiscal document. */
export const retryFiscalDocumentInput = z.object({
  fiscalDocumentId: z.string().min(1, 'fiscalDocumentId is required'),
});

export type RetryFiscalDocumentInput = z.infer<typeof retryFiscalDocumentInput>;
