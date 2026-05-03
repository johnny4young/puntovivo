/**
 * ENG-052b — MEGA seed: quotations distributed across all 5 states
 * (draft, sent, accepted, rejected, expired) so the /quotations page
 * exercises every filter and chip color.
 *
 * @module db/seed-mega/historical-quotations
 */

import { nanoid } from 'nanoid';
import { quotationItems, quotations } from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

const QUOTATION_STATES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const;

interface CreatedHistoricalQuotations {
  count: number;
  byState: Record<(typeof QUOTATION_STATES)[number], number>;
}

export async function seedHistoricalQuotations(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalQuotations> {
  const { db, clock, tenantId, sites, products, customers, adminUserId } = ctx;
  const totalQuotations = Math.round((target.historicalDays / 7) * target.quotationsPerWeek);

  const quoteRows: Array<typeof quotations.$inferInsert> = [];
  const itemRows: Array<typeof quotationItems.$inferInsert> = [];
  const byState: Record<(typeof QUOTATION_STATES)[number], number> = {
    draft: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
    expired: 0,
  };

  for (let i = 0; i < totalQuotations; i += 1) {
    const id = nanoid();
    const state = QUOTATION_STATES[i % QUOTATION_STATES.length]!;
    const customer = customers[i % (customers.length || 1)] ?? null;
    const site = sites[i % sites.length]!;

    const itemsCount = 2 + (i % 3);
    let subtotal = 0;
    let taxAmount = 0;
    const itemsBuilt: Array<{ id: string; productId: string; quantity: number; unitPrice: number; taxRate: number; taxLine: number; total: number }> = [];
    for (let li = 0; li < itemsCount; li += 1) {
      const product = products[(i * 7 + li * 5) % products.length]!;
      const quantity = 1 + (i % 3) + li;
      const lineSubtotal = product.price * quantity;
      const lineTax = lineSubtotal * (product.taxRate / 100);
      const lineTotal = lineSubtotal + lineTax;
      subtotal += lineSubtotal;
      taxAmount += lineTax;
      itemsBuilt.push({
        id: nanoid(),
        productId: product.id,
        quantity,
        unitPrice: product.price,
        taxRate: product.taxRate,
        taxLine: lineTax,
        total: lineTotal,
      });
    }
    const total = subtotal + taxAmount;

    const createdAtIso = randomDaysAgoIso(clock, 2, target.historicalDays - 1, i);
    const validUntilIso = laterIso(createdAtIso, 14 * 24 * 60 * 60 * 1000);
    const isActedOn = state !== 'draft';
    const statusChangedAtIso = isActedOn
      ? laterIso(createdAtIso, 24 * 60 * 60 * 1000)
      : null;

    quoteRows.push({
      id,
      tenantId,
      siteId: site.id,
      quotationNumber: `COT-${String(i + 1).padStart(5, '0')}`,
      customerId: customer?.id ?? null,
      status: state,
      subtotal,
      taxAmount,
      discountAmount: 0,
      total,
      validUntil: state === 'expired' ? randomDaysAgoIso(clock, 1, 5, i) : validUntilIso,
      notes: `Cotización demo seed mega — estado ${state}`,
      createdBy: adminUserId,
      statusChangedAt: statusChangedAtIso,
      statusChangedBy: isActedOn ? adminUserId : null,
      createdAt: createdAtIso,
      updatedAt: statusChangedAtIso ?? createdAtIso,
    });
    itemsBuilt.forEach(item => {
      itemRows.push({
        id: item.id,
        quotationId: id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: 0,
        taxRate: item.taxRate,
        taxAmount: item.taxLine,
        total: item.total,
        createdAt: createdAtIso,
      });
    });
    byState[state] += 1;
  }

  await chunkedInsert(db, quotations, quoteRows);
  await chunkedInsert(db, quotationItems, itemRows);

  return { count: quoteRows.length, byState };
}

async function chunkedInsert<T extends Record<string, unknown>>(
  db: MegaContext['db'],
  table: Parameters<typeof db.insert>[0],
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert(table) as any).values(chunk).run();
  }
}
