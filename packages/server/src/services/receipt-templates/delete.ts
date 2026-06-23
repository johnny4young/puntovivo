/**
 * Delete a receipt template, preserving the default-per-kind invariant.
 *
 * @module services/receipt-templates/delete
 */

import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { nowIso } from './helpers.js';

export interface DeleteReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
}

export function deleteReceiptTemplate(
  db: DatabaseInstance,
  args: DeleteReceiptTemplateArgs
): { id: string } {
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

    // Refuse to delete the last ACTIVE template for a kind — the
    // tenant would be left without a default rendering target. We only
    // count active siblings here (and the fallback promotion below
    // also requires `is_active = true`); counting inactive rows would
    // let an operator delete the active default when only inactive
    // siblings remain, leaving the kind silently with no usable
    // default. Operators can still mark a row inactive via `update` if
    // they want it hidden, but the invariant "every kind that has any
    // active template has a default" must hold so the renderer always
    // has something to fall back to.
    const activeSiblings = tx
      .select({
        id: receiptTemplates.id,
        isDefault: receiptTemplates.isDefault,
      })
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.tenantId, args.tenantId),
          eq(receiptTemplates.kind, existing.kind),
          eq(receiptTemplates.isActive, true)
        )
      )
      .all();

    // Allow deleting an inactive sibling even when no active ones
    // exist — the constraint only matters when removing an active
    // template. An inactive deletion never invalidates the default
    // invariant because inactive rows cannot be the default.
    const removingActiveLastOne = existing.isActive && activeSiblings.length <= 1;

    if (removingActiveLastOne) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message:
          'Cannot delete the only active template for this kind; create or activate a replacement first',
        details: { templateId: args.templateId, kind: existing.kind },
      });
    }

    tx.delete(receiptTemplates).where(eq(receiptTemplates.id, args.templateId)).run();

    // If the deleted row was the default, promote the most recently
    // updated remaining sibling to default so the kind still has one.
    if (existing.isDefault) {
      const fallback = tx
        .select({ id: receiptTemplates.id })
        .from(receiptTemplates)
        .where(
          and(
            eq(receiptTemplates.tenantId, args.tenantId),
            eq(receiptTemplates.kind, existing.kind),
            eq(receiptTemplates.isActive, true)
          )
        )
        .orderBy(desc(receiptTemplates.updatedAt))
        .get();

      if (fallback) {
        tx.update(receiptTemplates)
          .set({ isDefault: true, updatedAt: nowIso() })
          .where(eq(receiptTemplates.id, fallback.id))
          .run();
      }
    }

    return { id: args.templateId };
  });
}
