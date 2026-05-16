import { createHash } from 'node:crypto';

import { nanoid } from 'nanoid';

import { invoiceUploads } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { INVOICE_OCR_MAX_BYTES } from '../../services/ai/vision/invoice-ocr.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { uploadInvoiceInput } from '../schemas/upload.js';

function decodedByteLength(base64: string): number {
  const stripped = base64.replace(/=+$/, '').length;
  return Math.floor((stripped * 3) / 4);
}

export const uploadRouter = router({
  uploadInvoice: managerOrAdminProcedure.input(uploadInvoiceInput).mutation(async ({ ctx, input }) => {
    const sizeBytes = decodedByteLength(input.imageBase64);
    if (sizeBytes > INVOICE_OCR_MAX_BYTES) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'AI_VISION_IMAGE_TOO_LARGE',
        message: `Invoice document exceeds the ${INVOICE_OCR_MAX_BYTES / (1024 * 1024)} MB limit`,
        details: { sizeBytes, limitBytes: INVOICE_OCR_MAX_BYTES },
      });
    }

    const uploadId = nanoid();
    const payloadHash = createHash('sha256').update(input.imageBase64).digest('hex');
    await ctx.db.insert(invoiceUploads).values({
      id: uploadId,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.user!.id,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType,
      sizeBytes,
      payloadBase64: input.imageBase64,
      payloadHash,
      createdAt: new Date().toISOString(),
    });

    return { uploadId, sizeBytes, payloadHash };
  }),
});
