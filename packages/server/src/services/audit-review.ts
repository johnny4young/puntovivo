/**
 * ENG-129f — curated sensitive-event review model and tenant summary.
 *
 * The audit table remains the immutable source of truth. This module adds a
 * stable risk-oriented projection so administrators can answer "what should I
 * review?" without treating every routine workflow event as equally urgent.
 */

import { and, count, eq, gte, inArray, lte, max } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { auditLogs, type AuditLogAction } from '../db/schema.js';

export const AUDIT_REVIEW_CATEGORIES = ['privacy', 'access', 'money', 'inventory', 'ai'] as const;

export type AuditReviewCategory = (typeof AUDIT_REVIEW_CATEGORIES)[number];

export const AUDIT_REVIEW_CATEGORY_ACTIONS = {
  privacy: [
    'customer.personal_data.export',
    'customer.personal_data.delete',
    'customer.personal_data.anonymize',
    'data_retention.policy.updated',
    'data_retention.sweep.run',
    'telemetry.opt_in.updated',
    // ENG-123b — bulk customer PII ingestion belongs in privacy review.
    'data_import.customers',
  ],
  access: [
    'user.create',
    'user.update',
    'user.pin.update',
    'auth.staff_switch',
    'device.revoke',
    'device.pairing.claimed',
    'module.toggle',
    'backup.restore_drill',
  ],
  money: [
    'sale.void',
    'sale.return',
    'sale.price_override',
    'sale.credit_override',
    'sale.reprint',
    'cash_session.open',
    'cash_session.close',
    'cash_session.movement',
    'cash_drawer.open',
    'loss_prevention.settings.updated',
    'loss_prevention.triggered',
    'purchase.void',
    'payment.retry',
    'payment.mark_settled',
    'customer.credit_limit.update',
    // ENG-123d — opening receivables directly establish money owed.
    'data_import.customer_balances',
    // ENG-123e — imported opening floats affect drawer accountability.
    'data_import.opening_cash',
    // ENG-123f — issuer configuration can affect legally binding documents.
    'data_import.fiscal_profile',
    'fiscal.xml.downloaded',
    // ENG-141b — irreversible financial attestation belongs in money review.
    'day_close.sign_off',
  ],
  inventory: [
    'inventory.adjust_stock',
    'transfer.void',
    'inventory.lot.discount_suggested',
    'inventory.lot.discount_suggestion_dismissed',
    // ENG-123a/ENG-123b — bulk catalog, stock, and supplier mutation.
    'data_import.products',
    'data_import.providers',
  ],
  ai: [
    'ai.anomaly.detected',
    'ai.anomaly.silenced',
    'ai.invoice_ocr.extract',
    'ai.invoice_ocr.confirm',
    'ai.copilot.query',
    'ai.semantic_search.regenerate_embeddings',
  ],
} as const satisfies Record<AuditReviewCategory, readonly AuditLogAction[]>;

const categoryByAction = new Map<string, AuditReviewCategory>();
for (const category of AUDIT_REVIEW_CATEGORIES) {
  for (const action of AUDIT_REVIEW_CATEGORY_ACTIONS[category]) {
    if (categoryByAction.has(action)) {
      throw new Error(`Sensitive audit action ${action} belongs to multiple review categories`);
    }
    categoryByAction.set(action, category);
  }
}

export const SENSITIVE_AUDIT_ACTIONS = [...categoryByAction.keys()] as AuditLogAction[];

export function getAuditReviewActions(category: AuditReviewCategory): readonly AuditLogAction[] {
  return AUDIT_REVIEW_CATEGORY_ACTIONS[category];
}

interface SensitiveAuditSummaryOptions {
  createdAfter?: string | undefined;
  createdBefore?: string | undefined;
}

export interface SensitiveAuditCategorySummary {
  category: AuditReviewCategory;
  count: number;
  latestAt: string | null;
}

export interface SensitiveAuditSummary {
  total: number;
  categories: SensitiveAuditCategorySummary[];
}

/**
 * Counts only the curated sensitive action set and always scopes by tenant.
 * The grouped query uses the existing tenant/action/created index and returns
 * aggregate metadata only — no before/after payload or actor PII.
 */
export function getSensitiveAuditSummary(
  db: DatabaseInstance,
  tenantId: string,
  options: SensitiveAuditSummaryOptions = {}
): SensitiveAuditSummary {
  const conditions = [
    eq(auditLogs.tenantId, tenantId),
    inArray(auditLogs.action, SENSITIVE_AUDIT_ACTIONS),
  ];
  if (options.createdAfter) {
    conditions.push(gte(auditLogs.createdAt, options.createdAfter));
  }
  if (options.createdBefore) {
    conditions.push(lte(auditLogs.createdAt, options.createdBefore));
  }

  const rows = db
    .select({
      action: auditLogs.action,
      count: count(),
      latestAt: max(auditLogs.createdAt),
    })
    .from(auditLogs)
    .where(and(...conditions))
    .groupBy(auditLogs.action)
    .all();

  const aggregate = new Map<AuditReviewCategory, { count: number; latestAt: string | null }>();
  for (const row of rows) {
    const category = categoryByAction.get(row.action);
    if (!category) continue;
    const current = aggregate.get(category) ?? { count: 0, latestAt: null };
    current.count += row.count;
    if (row.latestAt && (!current.latestAt || row.latestAt > current.latestAt)) {
      current.latestAt = row.latestAt;
    }
    aggregate.set(category, current);
  }

  const categories = AUDIT_REVIEW_CATEGORIES.map(category => ({
    category,
    count: aggregate.get(category)?.count ?? 0,
    latestAt: aggregate.get(category)?.latestAt ?? null,
  }));

  return {
    total: categories.reduce((sum, category) => sum + category.count, 0),
    categories,
  };
}
