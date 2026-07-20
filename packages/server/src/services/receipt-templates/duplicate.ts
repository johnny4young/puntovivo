/**
 * Duplicate a receipt template into a new non-default copy.
 *
 * @module services/receipt-templates/duplicate
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates, type ReceiptTemplateKind } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { receiptLayoutSchema } from '../../trpc/schemas/receiptTemplates.js';
import { createReceiptTemplate } from './create.js';
import type { ReceiptTemplateRecord } from './types.js';

export interface DuplicateReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
  // explicit `| undefined` on Zod-optional field.
  name?: string | undefined;
  actorId: string;
}

export function duplicateReceiptTemplate(
  db: DatabaseInstance,
  args: DuplicateReceiptTemplateArgs
): ReceiptTemplateRecord {
  // Wrap the read + insert in a single transaction so a concurrent
  // delete cannot remove the source after we've copied its layout but
  // before we've written the duplicate. Better-sqlite3 nests
  // transactions safely; the inner `createReceiptTemplate` call
  // joins this same SAVEPOINT.
  return db.transaction(tx => {
    const source = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(eq(receiptTemplates.id, args.templateId), eq(receiptTemplates.tenantId, args.tenantId))
      )
      .get();

    if (!source) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    const duplicateName = args.name?.trim() || `${source.name} (copy)`;

    return createReceiptTemplate(tx, {
      tenantId: args.tenantId,
      kind: source.kind as ReceiptTemplateKind,
      name: duplicateName,
      layout: receiptLayoutSchema.parse(source.layout),
      // Duplicates never inherit `isDefault` — promoting requires an
      // explicit `setDefault`. Avoids surprising the operator who
      // clicks "duplicate" expecting a copy and getting a silent
      // default-flip.
      isDefault: false,
      isActive: source.isActive ?? true,
      createdBy: args.actorId,
    });
  });
}
