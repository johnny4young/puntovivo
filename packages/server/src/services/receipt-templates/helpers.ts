/**
 * Shared internals for the receipt-template service: timestamp,
 * layout serialization, and row → record projection.
 *
 * @module services/receipt-templates/helpers
 */

import type {
  ReceiptTemplate,
  ReceiptTemplateKind,
  ReceiptTemplatePaperWidth,
} from '../../db/schema.js';
import { receiptLayoutSchema, type ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import type { ReceiptTemplateRecord } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function serializeLayout(layout: ReceiptLayout): Record<string, unknown> {
  return JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;
}

export function toRecord(row: ReceiptTemplate): ReceiptTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ReceiptTemplateKind,
    name: row.name,
    paperWidth: row.paperWidth as ReceiptTemplatePaperWidth,
    layout: receiptLayoutSchema.parse(row.layout),
    isDefault: row.isDefault ?? false,
    isActive: row.isActive ?? true,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
