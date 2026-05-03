/**
 * ENG-052b — MEGA seed: purchase orders distributed across the
 * historical window. Mix of `submitted` (pending), `partial_received`,
 * `received`, and `voided` so the orders page exercises every state.
 *
 * @module db/seed-mega/historical-orders
 */

import { nanoid } from 'nanoid';
import { orderItems, orders } from '../schema.js';
import type { orderStatusEnum } from '../schema.js';
import { randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

type OrderStatus = (typeof orderStatusEnum)[number];

interface CreatedHistoricalOrders {
  count: number;
  byState: Record<OrderStatus, number>;
}

export async function seedHistoricalOrders(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalOrders> {
  const { db, clock, tenantId, sites, products, providerIds, adminUserId } = ctx;
  const totalOrders = target.ordersPending + target.ordersCompleted;

  const orderRows: Array<typeof orders.$inferInsert> = [];
  const itemRows: Array<typeof orderItems.$inferInsert> = [];
  const byState: Record<OrderStatus, number> = {
    submitted: 0,
    partial_received: 0,
    received: 0,
    voided: 0,
  };

  for (let i = 0; i < totalOrders; i += 1) {
    const id = nanoid();
    const isPending = i < target.ordersPending;
    const status: OrderStatus = isPending
      ? (i % 3 === 0 ? 'partial_received' : 'submitted')
      : (i % 4 === 0 ? 'voided' : 'received');
    const provider = providerIds[i % providerIds.length] ?? providerIds[0];
    if (!provider) continue;
    const site = sites[i % sites.length]!;

    const itemsCount = 2 + (i % 3);
    let subtotal = 0;
    const itemsBuilt: Array<{ id: string; productId: string; quantity: number; cost: number; total: number; baseUnitId: string }> = [];
    for (let li = 0; li < itemsCount; li += 1) {
      const product = products[(i * 11 + li * 7) % products.length]!;
      const quantity = 10 + (i % 20);
      const total = product.cost * quantity;
      subtotal += total;
      itemsBuilt.push({
        id: nanoid(),
        productId: product.id,
        quantity,
        cost: product.cost,
        total,
        baseUnitId: product.baseUnitId,
      });
    }
    const total = subtotal;
    const createdAtIso = isPending
      ? randomDaysAgoIso(clock, 1, 14, i)
      : randomDaysAgoIso(clock, 15, target.historicalDays - 1, i);

    orderRows.push({
      id,
      tenantId,
      orderNumber: `OC-${String(i + 1).padStart(5, '0')}`,
      providerId: provider,
      siteId: site.id,
      status,
      subtotal,
      total,
      notes: `Orden de compra demo seed mega — ${status}`,
      createdBy: adminUserId,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    });
    itemsBuilt.forEach(item => {
      itemRows.push({
        id: item.id,
        orderId: id,
        productId: item.productId,
        quantity: item.quantity,
        unitId: item.baseUnitId,
        unitEquivalence: 1,
        costPerUnit: item.cost,
        baseUnitCost: item.cost,
        total: item.total,
      });
    });
    byState[status] += 1;
  }

  await chunkedInsert(db, orders, orderRows);
  await chunkedInsert(db, orderItems, itemRows);

  return { count: orderRows.length, byState };
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
