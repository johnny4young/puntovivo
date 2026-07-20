/**
 * Create a receipt template.
 *
 * @module services/receipt-templates/create
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates, type ReceiptTemplateKind } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { nowIso, serializeLayout, toRecord } from './helpers.js';
import type { ReceiptTemplateRecord } from './types.js';

// explicit `| undefined` so the tRPC router can forward
// Zod-optional flag fields.
export interface CreateReceiptTemplateArgs {
  tenantId: string;
  kind: ReceiptTemplateKind;
  name: string;
  layout: ReceiptLayout;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
  createdBy: string;
}

/**
 * Insert a new template. If `isDefault` is true, demote any existing
 * default for the same `(tenantId, kind)` in the same transaction so the
 * invariant holds. If no template exists yet for this kind, the new one
 * is silently promoted to default regardless of input — empty kind +
 * non-default would leave the tenant with no rendering target.
 */
export function createReceiptTemplate(
  db: DatabaseInstance,
  args: CreateReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const existing = tx
      .select({ id: receiptTemplates.id, isDefault: receiptTemplates.isDefault })
      .from(receiptTemplates)
      .where(
        and(eq(receiptTemplates.tenantId, args.tenantId), eq(receiptTemplates.kind, args.kind))
      )
      .all();

    const requestedDefault = args.isDefault ?? false;
    const shouldBeDefault = requestedDefault || existing.length === 0;

    if (shouldBeDefault) {
      tx.update(receiptTemplates)
        .set({ isDefault: false, updatedAt: nowIso() })
        .where(
          and(
            eq(receiptTemplates.tenantId, args.tenantId),
            eq(receiptTemplates.kind, args.kind),
            eq(receiptTemplates.isDefault, true)
          )
        )
        .run();
    }

    const id = nanoid();
    const now = nowIso();
    tx.insert(receiptTemplates)
      .values({
        id,
        tenantId: args.tenantId,
        kind: args.kind,
        name: args.name,
        paperWidth: args.layout.paperWidth,
        layout: serializeLayout(args.layout),
        isDefault: shouldBeDefault,
        isActive: args.isActive ?? true,
        createdBy: args.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = tx.select().from(receiptTemplates).where(eq(receiptTemplates.id, id)).get();

    if (!created) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template insert returned no row',
        details: { tenantId: args.tenantId, templateId: id, operation: 'insert' },
      });
    }
    return toRecord(created);
  });
}
