/**
 * Read-side queries for receipt templates: list + get-by-id.
 *
 * @module services/receipt-templates/read
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { receiptTemplates, type ReceiptTemplateKind } from '../../db/schema.js';
import { toRecord } from './helpers.js';
import type { ReceiptTemplateRecord } from './types.js';

// explicit `| undefined` on Zod-optional filter fields.
export interface ListReceiptTemplatesOptions {
  kind?: ReceiptTemplateKind | undefined;
  includeInactive?: boolean | undefined;
  limit?: number | undefined;
}

export function listReceiptTemplates(
  db: DatabaseInstance,
  tenantId: string,
  options: ListReceiptTemplatesOptions = {}
): ReceiptTemplateRecord[] {
  const conditions = [eq(receiptTemplates.tenantId, tenantId)];
  if (options.kind) {
    conditions.push(eq(receiptTemplates.kind, options.kind));
  }
  if (!options.includeInactive) {
    conditions.push(eq(receiptTemplates.isActive, true));
  }

  const rows = db
    .select()
    .from(receiptTemplates)
    .where(and(...conditions))
    .orderBy(
      // Defaults first, then by name, so the list reads naturally for an
      // admin scanning a kind.
      desc(receiptTemplates.isDefault),
      asc(receiptTemplates.name),
      desc(receiptTemplates.updatedAt)
    )
    .limit(Math.max(1, Math.min(options.limit ?? 100, 200)))
    .all();

  return rows.map(toRecord);
}

export function getReceiptTemplateById(
  db: DatabaseInstance,
  tenantId: string,
  templateId: string
): ReceiptTemplateRecord | null {
  const row = db
    .select()
    .from(receiptTemplates)
    .where(and(eq(receiptTemplates.tenantId, tenantId), eq(receiptTemplates.id, templateId)))
    .get();
  return row ? toRecord(row) : null;
}
