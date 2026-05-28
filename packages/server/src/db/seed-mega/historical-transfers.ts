/**
 * ENG-052b — MEGA seed: inter-site transfers across the historical
 * window. A subset is "in transit" (recent, awaiting receive); the
 * rest are completed with a destination receipt + variance note.
 *
 * @module db/seed-mega/historical-transfers
 */

import { nanoid } from 'nanoid';
import {
  inventoryMovements,
  transferOrderItems,
  transferOrders,
} from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalTransfers {
  count: number;
  inTransit: number;
  inventoryMovementsCount: number;
}

export async function seedHistoricalTransfers(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalTransfers> {
  const { db, clock, tenantId, sites, products, adminUserId } = ctx;
  if (sites.length < 2) {
    return { count: 0, inTransit: 0, inventoryMovementsCount: 0 };
  }
  const totalTransfers = Math.round((target.historicalDays / 7) * target.transfersPerWeek);

  const orderRows: Array<typeof transferOrders.$inferInsert> = [];
  const itemRows: Array<typeof transferOrderItems.$inferInsert> = [];
  const movementRows: Array<typeof inventoryMovements.$inferInsert> = [];
  let inTransit = 0;

  for (let i = 0; i < totalTransfers; i += 1) {
    const transferId = nanoid();
    const fromSite = sites[i % sites.length]!;
    const toSite = sites[(i + 1) % sites.length]!;
    if (fromSite.id === toSite.id) continue;

    const product = products[(i * 11) % products.length]!;
    const quantity = 3 + (i % 8);
    const isInTransit = i < 2; // 2 most-recent transfers are in_transit

    const createdAtIso = isInTransit
      ? randomDaysAgoIso(clock, 1, 3, i)
      : randomDaysAgoIso(clock, 5, target.historicalDays - 1, i);
    const receivedAtIso = isInTransit ? null : laterIso(createdAtIso, 24 * 60 * 60 * 1000);
    const receivedQty = isInTransit ? null : quantity - (i % 3 === 0 ? 1 : 0);

    orderRows.push({
      id: transferId,
      tenantId,
      fromSiteId: fromSite.id,
      toSiteId: toSite.id,
      status: isInTransit ? 'in_transit' : 'completed',
      notes: `Traslado mega seed ${i + 1}`,
      createdBy: adminUserId,
      receivedAt: receivedAtIso,
      receivedBy: isInTransit ? null : adminUserId,
      discrepancyNotes:
        !isInTransit && i % 3 === 0 ? 'Faltó 1 unidad recibida — registrada por seed' : null,
      createdAt: createdAtIso,
      updatedAt: receivedAtIso ?? createdAtIso,
    });
    itemRows.push({
      id: nanoid(),
      transferOrderId: transferId,
      productId: product.id,
      quantity,
      receivedQuantity: receivedQty,
      createdAt: createdAtIso,
    });
    movementRows.push({
      id: nanoid(),
      tenantId,
      productId: product.id,
      type: 'transfer',
      quantity: -quantity,
      previousStock: quantity * 2,
      newStock: quantity,
      reference: `XFER-${String(i + 1).padStart(4, '0')}`,
      notes: `Transferencia hacia ${toSite.name}`,
      createdBy: adminUserId,
      createdAt: createdAtIso,
    });
    if (!isInTransit && receivedQty !== null) {
      movementRows.push({
        id: nanoid(),
        tenantId,
        productId: product.id,
        type: 'transfer',
        quantity: receivedQty,
        previousStock: 0,
        newStock: receivedQty,
        reference: `XFER-${String(i + 1).padStart(4, '0')}`,
        notes: `Recepción desde ${fromSite.name}`,
        createdBy: adminUserId,
        createdAt: receivedAtIso!,
      });
    } else {
      inTransit += 1;
    }
  }

  await chunkedInsert(db, transferOrders, orderRows);
  await chunkedInsert(db, transferOrderItems, itemRows);
  await chunkedInsert(db, inventoryMovements, movementRows);

  return { count: orderRows.length, inTransit, inventoryMovementsCount: movementRows.length };
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: seed bulk-insert into a parametric Drizzle table (Parameters<typeof db.insert>[0]); the generic-table builder rejects the typed ref. Seed-only, exempt per ENG-179c.
    await (db.insert(table) as any).values(chunk).run();
  }
}
