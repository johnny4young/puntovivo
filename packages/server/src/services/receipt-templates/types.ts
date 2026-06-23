/**
 * Public types for the receipt-template service.
 *
 * @module services/receipt-templates/types
 */

import type { ReceiptTemplateKind, ReceiptTemplatePaperWidth } from '../../db/schema.js';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';

export interface ReceiptTemplateRecord {
  id: string;
  tenantId: string;
  kind: ReceiptTemplateKind;
  name: string;
  paperWidth: ReceiptTemplatePaperWidth;
  layout: ReceiptLayout;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
