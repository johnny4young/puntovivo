import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import {
  quotationItemTaxComponents,
  quotationItems,
  quotationSaleLinks,
  quotations,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { ResolvedItemsBundle } from './item-resolution.js';
import type { CompleteSaleItemInput } from './types.js';

interface AssertQuotationConversionArgs {
  tenantId: string;
  siteId: string;
  quotationId: string;
  customerId: string | null;
  priceTier: 1 | 2 | 3;
  inputItems: CompleteSaleItemInput[];
  resolvedItems: ResolvedItemsBundle;
  saleTotals: { subtotal: number; taxAmount: number; total: number };
  saleCurrency: {
    currencyCode: string;
    exchangeRateAtSale: number;
    settleCurrencyCode: string | null;
  };
  now: string;
}

function mismatch(details: Record<string, unknown>): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'QUOTATION_CONVERSION_MISMATCH',
    message: 'The sale no longer matches the accepted quotation',
    details,
  });
}

/**
 * Re-validates the full accepted quote while the sale owns the SQLite writer.
 * Client cart state is only a transport: every frozen identity and amount is
 * compared with the server snapshot before any sale row is allowed to commit.
 */
export function assertQuotationConversion(
  tx: DatabaseInstance,
  args: AssertQuotationConversionArgs
): void {
  const quotation = tx
    .select({
      id: quotations.id,
      status: quotations.status,
      siteId: quotations.siteId,
      customerId: quotations.customerId,
      priceTier: quotations.priceTier,
      subtotal: quotations.subtotal,
      taxAmount: quotations.taxAmount,
      total: quotations.total,
      currencyCode: quotations.currencyCode,
      exchangeRateAtSale: quotations.exchangeRateAtSale,
      settleCurrencyCode: quotations.settleCurrencyCode,
      validUntil: quotations.validUntil,
    })
    .from(quotations)
    .where(and(eq(quotations.id, args.quotationId), eq(quotations.tenantId, args.tenantId)))
    .get();

  if (!quotation) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'QUOTATION_NOT_FOUND',
      message: 'Quotation not found',
    });
  }

  const existingLink = tx
    .select({ saleId: quotationSaleLinks.saleId })
    .from(quotationSaleLinks)
    .where(
      and(
        eq(quotationSaleLinks.tenantId, args.tenantId),
        eq(quotationSaleLinks.quotationId, args.quotationId)
      )
    )
    .get();
  if (existingLink || quotation.status === 'converted') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'QUOTATION_ALREADY_CONVERTED',
      message: 'Quotation has already been converted',
      details: { saleId: existingLink?.saleId ?? null },
    });
  }
  if (quotation.status !== 'accepted') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'QUOTATION_NOT_ACCEPTED',
      message: 'Only an accepted quotation can become a sale',
      details: { status: quotation.status },
    });
  }
  if (
    quotation.validUntil &&
    (!Number.isFinite(Date.parse(quotation.validUntil)) ||
      Date.parse(quotation.validUntil) < Date.parse(args.now))
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'QUOTATION_EXPIRED',
      message: 'Quotation has expired',
      details: { validUntil: quotation.validUntil },
    });
  }
  if (quotation.siteId !== args.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'QUOTATION_SITE_MISMATCH',
      message: 'Quotation belongs to a different site',
    });
  }
  if (quotation.customerId !== args.customerId || quotation.priceTier !== args.priceTier) {
    mismatch({
      field: quotation.customerId !== args.customerId ? 'customerId' : 'priceTier',
    });
  }
  if (
    quotation.currencyCode !== args.saleCurrency.currencyCode ||
    quotation.exchangeRateAtSale !== args.saleCurrency.exchangeRateAtSale ||
    quotation.settleCurrencyCode !== args.saleCurrency.settleCurrencyCode
  ) {
    mismatch({ field: 'currency' });
  }

  const quotedLines = tx
    .select({
      id: quotationItems.id,
      productId: quotationItems.productId,
      unitId: quotationItems.unitId,
      unitEquivalence: quotationItems.unitEquivalence,
      quantity: quotationItems.quantity,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      taxRate: quotationItems.taxRate,
      taxKind: quotationItems.taxKind,
      taxAmount: quotationItems.taxAmount,
      total: quotationItems.total,
    })
    .from(quotationItems)
    .where(eq(quotationItems.quotationId, args.quotationId))
    .orderBy(asc(quotationItems.createdAt), asc(quotationItems.id))
    .all();

  if (
    quotedLines.length !== args.inputItems.length ||
    quotedLines.length !== args.resolvedItems.rows.length
  ) {
    mismatch({ field: 'lineCount' });
  }
  const quotedById = new Map(quotedLines.map(line => [line.id, line] as const));
  const quotedComponents = quotedLines.length
    ? tx
        .select()
        .from(quotationItemTaxComponents)
        .where(
          and(
            eq(quotationItemTaxComponents.tenantId, args.tenantId),
            inArray(
              quotationItemTaxComponents.quotationItemId,
              quotedLines.map(line => line.id)
            )
          )
        )
        .orderBy(quotationItemTaxComponents.quotationItemId, quotationItemTaxComponents.position)
        .all()
    : [];
  const componentsByLine = new Map<string, typeof quotedComponents>();
  for (const component of quotedComponents) {
    const group = componentsByLine.get(component.quotationItemId) ?? [];
    group.push(component);
    componentsByLine.set(component.quotationItemId, group);
  }

  const seen = new Set<string>();
  for (const [index, input] of args.inputItems.entries()) {
    const quotationItemId = input.sourceQuotationItemId;
    if (!quotationItemId || seen.has(quotationItemId)) mismatch({ field: 'quotationItemId' });
    seen.add(quotationItemId);
    const quoted = quotedById.get(quotationItemId);
    const resolved = args.resolvedItems.rows[index];
    if (!quoted || !resolved || !quoted.unitId || quoted.unitEquivalence == null) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'QUOTATION_UNIT_SNAPSHOT_MISSING',
        message: 'Quotation line has no authoritative unit snapshot',
      });
    }
    const sameIdentity =
      quoted.productId === input.productId &&
      quoted.productId === resolved.productId &&
      quoted.unitId === input.unitId &&
      quoted.unitId === resolved.unitId;
    const sameAmounts =
      quoted.quantity === resolved.quantity &&
      roundQuantity(quoted.unitEquivalence, 9) === roundQuantity(resolved.unitEquivalence, 9) &&
      roundMoney(quoted.unitPrice) === roundMoney(resolved.unitPrice) &&
      roundMoney(quoted.discount) === roundMoney(resolved.discount) &&
      roundMoney(quoted.taxRate) === roundMoney(resolved.taxRate) &&
      quoted.taxKind === resolved.taxKind &&
      roundMoney(quoted.taxAmount) === roundMoney(resolved.taxAmount) &&
      roundMoney(quoted.total) === roundMoney(resolved.total);
    if (!sameIdentity || !sameAmounts) mismatch({ field: 'line', quotationItemId });

    const frozenComponents = componentsByLine.get(quotationItemId) ?? [];
    if (
      frozenComponents.length !== resolved.taxComponents.length ||
      frozenComponents.some((component, componentIndex) => {
        const current = resolved.taxComponents[componentIndex];
        return (
          !current ||
          component.componentKey !== current.componentKey ||
          component.vatRateId !== current.vatRateId ||
          component.taxKind !== current.taxKind ||
          roundMoney(component.taxRate) !== roundMoney(current.taxRate) ||
          roundMoney(component.taxableAmount) !== roundMoney(current.taxableAmount) ||
          roundMoney(component.taxAmount) !== roundMoney(current.taxAmount)
        );
      })
    ) {
      mismatch({ field: 'taxComponents', quotationItemId });
    }
  }

  if (
    roundMoney(quotation.subtotal) !== roundMoney(args.saleTotals.subtotal) ||
    roundMoney(quotation.taxAmount) !== roundMoney(args.saleTotals.taxAmount) ||
    roundMoney(quotation.total) !== roundMoney(args.saleTotals.total)
  ) {
    mismatch({ field: 'totals' });
  }
}

export function finalizeQuotationConversion(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    quotationId: string;
    saleId: string;
    saleNumber: string;
    actorId: string;
    operationId?: string | undefined;
    now: string;
  }
): void {
  const result = tx
    .update(quotations)
    .set({
      status: 'converted',
      statusChangedAt: args.now,
      statusChangedBy: args.actorId,
      syncStatus: 'pending',
      syncVersion: sql`${quotations.syncVersion} + 1`,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(quotations.id, args.quotationId),
        eq(quotations.tenantId, args.tenantId),
        eq(quotations.status, 'accepted')
      )
    )
    .run();
  if (result.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'QUOTATION_ALREADY_CONVERTED',
      message: 'Quotation conversion lost a concurrent race',
    });
  }

  tx.insert(quotationSaleLinks)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      quotationId: args.quotationId,
      saleId: args.saleId,
      convertedBy: args.actorId,
      createdAt: args.now,
    })
    .run();

  writeAuditLog({
    tx,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: 'quotation.convert',
    resourceType: 'quotation',
    resourceId: args.quotationId,
    before: { status: 'accepted' },
    after: { status: 'converted', saleId: args.saleId, saleNumber: args.saleNumber },
    operationId: args.operationId,
  });
}
