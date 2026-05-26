/**
 * Quotation Service (Phase 5 / Tier-2 #6 step 1).
 *
 * A quotation is a non-binding pre-sale document. Creating, updating status,
 * or deleting a draft quotation never touches `inventory_balances` or
 * `products.stock` — those mutations land in a future quote-to-sale slice.
 *
 * @module services/quotations
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  customers,
  products,
  quotationItems,
  quotations,
  sequentials,
  sites,
  users,
  type QuotationStatus,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';
import { writeAuditLog } from './audit-logs.js';

export interface QuotationItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export interface CreateQuotationArgs {
  tenantId: string;
  siteId: string;
  customerId: string | null;
  items: readonly QuotationItemInput[];
  validUntil: string | null;
  notes: string | null;
  createdBy: string;
}

export interface ResolvedQuotationLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface QuotationTotals {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  rows: ResolvedQuotationLine[];
}

export interface CreatedQuotation {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  fromSiteId: string;
  customerId: string | null;
  total: number;
  createdAt: string;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Per-line totals helper.
 *
 * Tax model (mirrors sales): the supplied `unitPrice` is treated as the
 * gross/with-tax amount per unit, so the line's tax is extracted from the
 * post-discount total. This matches how operators quote prices in the field
 * — they enter the customer-facing number, not the tax-exclusive base.
 */
export function computeQuotationTotals(
  rawLines: readonly QuotationItemInput[],
  productTaxRateById: ReadonlyMap<string, number>
): QuotationTotals {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;

  // ENG-176a-rounding — mirror completeSale.ts: round every derived
  // monetary quantity to two decimals before accumulation, and round
  // the running totals after each iteration so a long line list does
  // not stack sub-cent drift.
  const rows: ResolvedQuotationLine[] = rawLines.map(line => {
    const grossLine = roundMoney(line.unitPrice * line.quantity);
    const lineDiscountAmount = roundMoney(grossLine * (line.discount / 100));
    const lineTotal = roundMoney(grossLine - lineDiscountAmount);
    // Resolve VAT rate: per-line input wins; product VAT is the fallback.
    const effectiveTaxRate =
      line.taxRate > 0 ? line.taxRate : productTaxRateById.get(line.productId) ?? 0;
    const lineBase = roundMoney(
      effectiveTaxRate > 0 ? lineTotal / (1 + effectiveTaxRate / 100) : lineTotal
    );
    const lineTax = roundMoney(lineTotal - lineBase);

    subtotal = roundMoney(subtotal + lineBase);
    taxAmount = roundMoney(taxAmount + lineTax);
    discountAmount = roundMoney(discountAmount + lineDiscountAmount);

    return {
      id: nanoid(),
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: roundMoney(line.unitPrice),
      discount: roundMoney(line.discount),
      taxRate: effectiveTaxRate,
      taxAmount: lineTax,
      total: lineTotal,
    };
  });

  return {
    subtotal,
    taxAmount,
    discountAmount,
    total: roundMoney(subtotal + taxAmount),
    rows,
  };
}

/**
 * Resolve the (siteId, prefix, currentValue) sequential context for the
 * tenant's quotation numbering.
 *
 * Looks up a site-scoped row first, then falls back to the earliest active
 * site that has a quotation sequential configured. Throws
 * `QUOTATION_SEQUENTIAL_MISSING` if none is configured for the tenant.
 */
function resolveQuotationSequential(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string
): { id: string; prefix: string; currentValue: number } {
  // Guard the join on both `sequentials.tenantId` AND `sites.tenantId` so
  // the fallback cannot select a row that somehow references a sibling
  // tenant's site (defense in depth — nanoid id collisions are
  // astronomically unlikely but the schema doesn't enforce a cross-table
  // tenant constraint at the DB layer).
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'quotation'),
    eq(sites.isActive, true),
    eq(sites.tenantId, tenantId),
  ];

  const siteScoped = tx
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
    .get();

  if (siteScoped) {
    return siteScoped;
  }

  const fallback = tx
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.createdAt), asc(sites.id))
    .get();

  if (!fallback) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUOTATION_SEQUENTIAL_MISSING',
      message:
        'No active quotation sequential is configured for the current tenant',
      details: { tenantId, siteId },
    });
  }

  return fallback;
}

export function createQuotation(
  db: DatabaseInstance,
  args: CreateQuotationArgs
): CreatedQuotation {
  if (args.items.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUOTATION_ITEMS_REQUIRED',
      message: 'A quotation must include at least one product line',
    });
  }

  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_QUANTITY_INVALID',
        message: 'Quotation quantity must be greater than zero',
        details: { productId: item.productId, quantity: item.quantity },
      });
    }
  }

  const now = getTimestamp();
  const quotationId = nanoid();
  const productIds = [...new Set(args.items.map(item => item.productId))];

  return db.transaction(tx => {
    // Validate site belongs to tenant and is active.
    const targetSite = tx
      .select({ id: sites.id, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.id, args.siteId), eq(sites.tenantId, args.tenantId)))
      .get();
    if (!targetSite || targetSite.isActive === false) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUOTATION_SITE_NOT_FOUND',
        message: 'Quotation site was not found or is inactive',
        details: { siteId: args.siteId },
      });
    }

    if (args.customerId) {
      const customer = tx
        .select({ id: customers.id, isActive: customers.isActive })
        .from(customers)
        .where(
          and(
            eq(customers.id, args.customerId),
            eq(customers.tenantId, args.tenantId)
          )
        )
        .get();
      if (!customer || customer.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'QUOTATION_CUSTOMER_NOT_FOUND',
          message: 'Quotation customer was not found or is inactive',
          details: { customerId: args.customerId },
        });
      }
    }

    const productRows = tx
      .select({
        id: products.id,
        isActive: products.isActive,
        taxRate: products.taxRate,
      })
      .from(products)
      .where(
        and(eq(products.tenantId, args.tenantId), inArray(products.id, productIds))
      )
      .all();
    const productById = new Map(productRows.map(product => [product.id, product]));

    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product || product.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'QUOTATION_PRODUCT_NOT_FOUND',
          message: 'Quotation product was not found or is inactive',
          details: { productId },
        });
      }
    }

    const productTaxRateById = new Map<string, number>(
      productRows.map(product => [product.id, product.taxRate ?? 0])
    );
    const totals = computeQuotationTotals(args.items, productTaxRateById);

    const sequential = resolveQuotationSequential(tx, args.tenantId, args.siteId);
    const nextValue = sequential.currentValue + 1;
    const quotationNumber = `${sequential.prefix}${String(nextValue).padStart(6, '0')}`;

    tx.update(sequentials)
      .set({ currentValue: nextValue, updatedAt: now })
      .where(eq(sequentials.id, sequential.id))
      .run();

    tx.insert(quotations)
      .values({
        id: quotationId,
        tenantId: args.tenantId,
        siteId: args.siteId,
        quotationNumber,
        customerId: args.customerId,
        status: 'draft',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        total: totals.total,
        validUntil: args.validUntil,
        notes: args.notes,
        createdBy: args.createdBy,
        statusChangedAt: now,
        statusChangedBy: args.createdBy,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const row of totals.rows) {
      tx.insert(quotationItems)
        .values({
          id: row.id,
          quotationId,
          productId: row.productId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          discount: row.discount,
          taxRate: row.taxRate,
          taxAmount: row.taxAmount,
          total: row.total,
          createdAt: now,
        })
        .run();
    }

    return {
      id: quotationId,
      quotationNumber,
      status: 'draft' as QuotationStatus,
      fromSiteId: args.siteId,
      customerId: args.customerId,
      total: totals.total,
      createdAt: now,
    };
  });
}

/**
 * Allowed status transitions. `draft` is the entry state. `accepted` can
 * close into either `expired` (time passed without becoming a sale) or
 * `converted` (operator linked the quote to a completed sale through the
 * regular POS flow — this is a terminal status with no deeper side effects;
 * inventory is mutated by the sale itself, not by the quote).
 */
const ALLOWED_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ['sent', 'rejected', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: ['expired', 'converted'],
  rejected: [],
  expired: [],
  converted: [],
};

export interface UpdateQuotationStatusArgs {
  tenantId: string;
  quotationId: string;
  /**
   * `draft` is the entry state and cannot be set via the status API (only
   * `create` produces drafts). Every other status — including `converted` —
   * may be requested, and the ALLOWED_TRANSITIONS map validates against the
   * current status.
   */
  nextStatus: Exclude<QuotationStatus, 'draft'>;
  actorId: string;
}

export function updateQuotationStatus(
  db: DatabaseInstance,
  args: UpdateQuotationStatusArgs
): { id: string; status: QuotationStatus; statusChangedAt: string } {
  const now = getTimestamp();

  return db.transaction(tx => {
    const current = tx
      .select({ id: quotations.id, status: quotations.status })
      .from(quotations)
      .where(
        and(
          eq(quotations.id, args.quotationId),
          eq(quotations.tenantId, args.tenantId)
        )
      )
      .get();

    if (!current) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUOTATION_NOT_FOUND',
        message: 'Quotation not found',
        details: { quotationId: args.quotationId },
      });
    }

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(args.nextStatus)) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_INVALID_STATUS_TRANSITION',
        message: `Cannot move quotation from ${current.status} to ${args.nextStatus}`,
        details: { from: current.status, to: args.nextStatus },
      });
    }

    tx.update(quotations)
      .set({
        status: args.nextStatus,
        statusChangedAt: now,
        statusChangedBy: args.actorId,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(
        and(
          eq(quotations.id, args.quotationId),
          eq(quotations.tenantId, args.tenantId)
        )
      )
      .run();

    // Phase 8 / Tier-2 #8 — audit the terminal-close transitions that
    // carry business impact. Intermediate transitions (draft → sent, sent
    // → accepted) are not audited because they represent normal workflow
    // progress; a reviewer looking at the log wants to see *outcomes*.
    if (args.nextStatus === 'converted') {
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'quotation.convert',
        resourceType: 'quotation',
        resourceId: args.quotationId,
        before: { status: current.status },
        after: { status: args.nextStatus },
      });
    }

    return {
      id: args.quotationId,
      status: args.nextStatus as QuotationStatus,
      statusChangedAt: now,
    };
  });
}

export interface DeleteQuotationArgs {
  tenantId: string;
  quotationId: string;
  /**
   * The user requesting the delete; recorded against the audit row. The
   * current caller in the tRPC layer passes the authenticated user id.
   */
  actorId: string;
}

export function deleteQuotation(
  db: DatabaseInstance,
  args: DeleteQuotationArgs
): { id: string } {
  return db.transaction(tx => {
    // Load the snapshot we want to persist in the audit trail BEFORE deleting
    // — the row (and its cascade children) is gone after the DELETE.
    const current = tx
      .select({
        id: quotations.id,
        quotationNumber: quotations.quotationNumber,
        status: quotations.status,
        customerId: quotations.customerId,
        siteId: quotations.siteId,
        total: quotations.total,
      })
      .from(quotations)
      .where(
        and(
          eq(quotations.id, args.quotationId),
          eq(quotations.tenantId, args.tenantId)
        )
      )
      .get();

    if (!current) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUOTATION_NOT_FOUND',
        message: 'Quotation not found',
        details: { quotationId: args.quotationId },
      });
    }

    if (current.status !== 'draft') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_DELETE_NOT_DRAFT',
        message: 'Only draft quotations can be deleted',
        details: { quotationId: args.quotationId, status: current.status },
      });
    }

    // Items are removed by the FK ON DELETE CASCADE. The tenant guard on the
    // DELETE mirrors updateQuotationStatus — even though the SELECT above
    // already filtered by tenant, repeating the check at the write layer
    // keeps the invariant consistent and blocks any TOCTOU race against a
    // hypothetical second caller.
    tx.delete(quotations)
      .where(
        and(
          eq(quotations.id, args.quotationId),
          eq(quotations.tenantId, args.tenantId)
        )
      )
      .run();

    // Phase 8 / Tier-2 #8 — record the deletion with the pre-delete snapshot
    // as `before` so the audit trail can reconstruct what was removed.
    // `after` is null by design (the row no longer exists).
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'quotation.delete',
      resourceType: 'quotation',
      resourceId: args.quotationId,
      before: {
        quotationNumber: current.quotationNumber,
        status: current.status,
        customerId: current.customerId,
        siteId: current.siteId,
        total: current.total,
      },
      after: null,
    });

    return { id: args.quotationId };
  });
}

export interface QuotationListEntry {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  siteId: string;
  siteName: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  itemCount: number;
  validUntil: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ListQuotationsOptions {
  limit?: number;
  status?: QuotationStatus;
  customerId?: string;
}

export function listQuotations(
  db: DatabaseInstance,
  tenantId: string,
  options: ListQuotationsOptions = {}
): QuotationListEntry[] {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  const conditions = [eq(quotations.tenantId, tenantId)];
  if (options.status) {
    conditions.push(eq(quotations.status, options.status));
  }
  if (options.customerId) {
    conditions.push(eq(quotations.customerId, options.customerId));
  }

  const rows = db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      customerId: quotations.customerId,
      customerName: customers.name,
      siteId: quotations.siteId,
      siteName: sites.name,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      total: quotations.total,
      validUntil: quotations.validUntil,
      createdAt: quotations.createdAt,
      createdBy: quotations.createdBy,
    })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .innerJoin(sites, eq(quotations.siteId, sites.id))
    .where(and(...conditions))
    .orderBy(desc(quotations.createdAt))
    .limit(limit)
    .all();

  if (rows.length === 0) {
    return [];
  }

  // Single grouped lookup for line-item counts — keeps the read path O(1)
  // queries regardless of page size and avoids the misleading async fan-out
  // pattern that better-sqlite3 (synchronous driver) cannot actually
  // parallelize.
  const itemCountRows = db
    .select({
      quotationId: quotationItems.quotationId,
      count: sql<number>`count(*)`,
    })
    .from(quotationItems)
    .where(
      inArray(
        quotationItems.quotationId,
        rows.map(row => row.id)
      )
    )
    .groupBy(quotationItems.quotationId)
    .all();
  const itemCountById = new Map<string, number>(
    itemCountRows.map(row => [row.quotationId, Number(row.count)])
  );

  return rows.map(row => ({
    ...row,
    itemCount: itemCountById.get(row.id) ?? 0,
  }));
}

export interface QuotationDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  siteId: string;
  siteName: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  statusChangedByName: string | null;
  updatedAt: string;
  items: QuotationDetailLine[];
}

export function getQuotationById(
  db: DatabaseInstance,
  tenantId: string,
  quotationId: string
): QuotationDetail | null {
  const header = db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      status: quotations.status,
      customerId: quotations.customerId,
      customerName: customers.name,
      customerTaxId: customers.taxId,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      siteId: quotations.siteId,
      siteName: sites.name,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      discountAmount: quotations.discountAmount,
      total: quotations.total,
      validUntil: quotations.validUntil,
      notes: quotations.notes,
      createdAt: quotations.createdAt,
      createdBy: quotations.createdBy,
      createdByName: users.name,
      statusChangedAt: quotations.statusChangedAt,
      statusChangedBy: quotations.statusChangedBy,
      updatedAt: quotations.updatedAt,
    })
    .from(quotations)
    .leftJoin(customers, eq(quotations.customerId, customers.id))
    .innerJoin(sites, eq(quotations.siteId, sites.id))
    .leftJoin(users, eq(quotations.createdBy, users.id))
    .where(
      and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId))
    )
    .get();

  if (!header) {
    return null;
  }

  // Resolve the status-change actor with a single point lookup. A second
  // `leftJoin(users, …)` in the main query would require an explicit alias
  // (Drizzle disallows joining the same table twice without one), and the
  // 99% case is `statusChangedBy === createdBy` so the lookup is essentially
  // free.
  let statusChangedByName: string | null = null;
  if (header.statusChangedBy) {
    if (header.statusChangedBy === header.createdBy) {
      statusChangedByName = header.createdByName;
    } else {
      const actor = db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, header.statusChangedBy))
        .get();
      statusChangedByName = actor?.name ?? null;
    }
  }

  const items = db
    .select({
      id: quotationItems.id,
      productId: quotationItems.productId,
      quantity: quotationItems.quantity,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      taxRate: quotationItems.taxRate,
      taxAmount: quotationItems.taxAmount,
      total: quotationItems.total,
      productName: products.name,
      productSku: products.sku,
    })
    .from(quotationItems)
    .innerJoin(products, eq(quotationItems.productId, products.id))
    .where(eq(quotationItems.quotationId, quotationId))
    .orderBy(asc(quotationItems.createdAt), asc(quotationItems.id))
    .all();

  return {
    ...header,
    statusChangedByName,
    items,
  };
}
