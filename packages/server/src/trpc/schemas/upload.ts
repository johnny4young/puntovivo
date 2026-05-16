/**
 * Upload tRPC schemas.
 *
 * Sprint-1 invoice OCR uses a two-step contract: upload the document
 * first, then pass the opaque `uploadId` to the AI router. This keeps
 * OCR providers from seeing tenant/user metadata and lets cloud
 * deployments swap local SQLite storage for S3 later.
 *
 * @module trpc/schemas/upload
 */
import { z } from 'zod';

import {
  INVOICE_OCR_MAX_BYTES,
  INVOICE_OCR_MIME_TYPES,
} from '../../services/ai/vision/invoice-ocr.js';

const dataUrlPrefix = /^data:[^;]+;base64,/;

export const uploadInvoiceInput = z.object({
  fileName: z.string().trim().min(1).max(240).optional(),
  mimeType: z.enum(INVOICE_OCR_MIME_TYPES),
  imageBase64: z
    .string()
    .min(1)
    .max(Math.ceil(INVOICE_OCR_MAX_BYTES * 1.4) + 32 * 1024)
    .transform(value => value.replace(dataUrlPrefix, '')),
});

export type UploadInvoiceInput = z.infer<typeof uploadInvoiceInput>;
