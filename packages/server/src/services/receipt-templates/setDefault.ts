/**
 * Promote a receipt template to default for its kind.
 *
 * @module services/receipt-templates/setDefault
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { nowIso, toRecord } from './helpers.js';
import type { ReceiptTemplateRecord } from './types.js';

export interface SetDefaultReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
}

/**
 * Promote the given template to default for its kind. Demotes the prior
 * default within the same transaction so both updates land atomically
 * — no window where both are true (would violate the partial unique
 * index) and no window where neither is true.
 */
export function setDefaultReceiptTemplate(
  db: DatabaseInstance,
  args: SetDefaultReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const target = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(eq(receiptTemplates.id, args.templateId), eq(receiptTemplates.tenantId, args.tenantId))
      )
      .get();

    if (!target) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    if (!target.isActive) {
      // Promoting an inactive template is nonsensical — the renderer
      // would skip it. Force the operator to reactivate first.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message: 'Cannot promote an inactive template to default; activate it first',
        details: { templateId: args.templateId },
      });
    }

    if (target.isDefault) {
      // Idempotent: already default. Return as-is so callers can use this
      // procedure as a "make sure X is default" without branching.
      return toRecord(target);
    }

    tx.update(receiptTemplates)
      .set({ isDefault: false, updatedAt: nowIso() })
      .where(
        and(
          eq(receiptTemplates.tenantId, args.tenantId),
          eq(receiptTemplates.kind, target.kind),
          eq(receiptTemplates.isDefault, true)
        )
      )
      .run();

    tx.update(receiptTemplates)
      .set({ isDefault: true, updatedAt: nowIso() })
      .where(eq(receiptTemplates.id, args.templateId))
      .run();

    const refreshed = tx
      .select()
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, args.templateId))
      .get();

    if (!refreshed) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template setDefault returned no row',
        details: {
          tenantId: args.tenantId,
          templateId: args.templateId,
          operation: 'setDefault',
        },
      });
    }
    return toRecord(refreshed);
  });
}
