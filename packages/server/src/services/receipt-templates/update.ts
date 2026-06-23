/**
 * Update a receipt template (name / layout / active flag).
 *
 * @module services/receipt-templates/update
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { nowIso, serializeLayout, toRecord } from './helpers.js';
import type { ReceiptTemplateRecord } from './types.js';

export interface UpdateReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
  // ENG-179b — explicit `| undefined` on Zod-optional fields.
  name?: string | undefined;
  layout?: ReceiptLayout | undefined;
  isActive?: boolean | undefined;
  actorId: string;
}

export function updateReceiptTemplate(
  db: DatabaseInstance,
  args: UpdateReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const existing = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(eq(receiptTemplates.id, args.templateId), eq(receiptTemplates.tenantId, args.tenantId))
      )
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    if (args.isActive === false && existing.isDefault) {
      // Cannot deactivate the active default — the tenant would lose its
      // rendering target for that kind.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message:
          'Cannot deactivate the default template for this kind; promote another template to default first',
        details: { templateId: args.templateId, kind: existing.kind },
      });
    }

    tx.update(receiptTemplates)
      .set({
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.layout !== undefined
          ? {
              layout: serializeLayout(args.layout),
              paperWidth: args.layout.paperWidth,
            }
          : {}),
        ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
        updatedBy: args.actorId,
        updatedAt: nowIso(),
      })
      .where(eq(receiptTemplates.id, args.templateId))
      .run();

    const updated = tx
      .select()
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, args.templateId))
      .get();

    if (!updated) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template update returned no row',
        details: {
          tenantId: args.tenantId,
          templateId: args.templateId,
          operation: 'update',
        },
      });
    }
    return toRecord(updated);
  });
}
