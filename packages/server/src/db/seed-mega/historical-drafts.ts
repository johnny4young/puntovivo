/**
 * ENG-052b — MEGA seed: suspended drafts spread 0-7 days back.
 *
 * Each draft is a fully-shaped sale row with status='draft' +
 * suspended_at populated; sales lifecycle UI (SuspendedSalesPanel)
 * lists them under Ctrl+R.
 *
 * @module db/seed-mega/historical-drafts
 */

import { nanoid } from 'nanoid';
import {
  inventoryMovements,
  saleItems,
  sales,
} from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalDrafts {
  count: number;
  inventoryMovementsCount: number;
}

interface OpenSession {
  id: string;
  siteId: string;
  cashierId: string;
  openedAtIso: string;
}

export async function seedHistoricalDrafts(
  ctx: MegaContext,
  target: MegaTarget,
  openSessions: OpenSession[]
): Promise<CreatedHistoricalDrafts> {
  const { db, clock, tenantId, products, customers } = ctx;
  if (openSessions.length === 0) {
    return { count: 0, inventoryMovementsCount: 0 };
  }

  const saleRows: Array<typeof sales.$inferInsert> = [];
  const itemRows: Array<typeof saleItems.$inferInsert> = [];
  const movementRows: Array<typeof inventoryMovements.$inferInsert> = [];

  for (let i = 0; i < target.suspendedDrafts; i += 1) {
    const session = openSessions[i % openSessions.length]!;
    const id = nanoid();
    const itemsCount = 1 + (i % 3);
    let subtotal = 0;
    let taxAmount = 0;
    const itemsBuilt: Array<{ id: string; productId: string; quantity: number; unitPrice: number; taxRate: number; cost: number; taxLine: number; total: number; baseUnitId: string }> = [];
    for (let li = 0; li < itemsCount; li += 1) {
      const product = products[(i * 5 + li * 3) % products.length]!;
      const quantity = 1 + (i % 4);
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
        cost: product.cost,
        taxLine: lineTax,
        total: lineTotal,
        baseUnitId: product.baseUnitId,
      });
    }
    const total = subtotal + taxAmount;

    const customer = customers[i % (customers.length || 1)] ?? null;
    const createdAtIso = randomDaysAgoIso(clock, 0, 7, i);
    const suspendedAtIso = laterIso(createdAtIso, 30 * 60 * 1000);
    const labels = [
      'Cliente regresa más tarde',
      'Esperando código de descuento',
      'Verificar stock bodega',
      'Pendiente confirmar pago',
      null,
    ];

    saleRows.push({
      id,
      tenantId,
      saleNumber: `DRAFT-${String(i + 1).padStart(4, '0')}`,
      customerId: customer?.id ?? null,
      subtotal,
      taxAmount,
      discountAmount: 0,
      total,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      cashSessionId: session.id,
      notes: null,
      createdBy: session.cashierId,
      suspendedAt: suspendedAtIso,
      suspendedBy: session.cashierId,
      suspendedLabel: labels[i % labels.length],
      createdAt: createdAtIso,
      updatedAt: suspendedAtIso,
    });
    itemsBuilt.forEach(item => {
      itemRows.push({
        id: item.id,
        saleId: id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitId: item.baseUnitId,
        unitEquivalence: 1,
        discount: 0,
        taxRate: item.taxRate,
        taxAmount: item.taxLine,
        costAtSale: item.cost,
        total: item.total,
      });
      // Drafts also debit stock (the resume / discard flow restores it)
      movementRows.push({
        id: nanoid(),
        tenantId,
        productId: item.productId,
        type: 'sale',
        quantity: -item.quantity,
        previousStock: item.quantity * 5,
        newStock: item.quantity * 4,
        reference: `DRAFT-${String(i + 1).padStart(4, '0')}`,
        notes: 'Borrador suspendido seed mega',
        createdBy: session.cashierId,
        createdAt: createdAtIso,
      });
    });
  }

  if (saleRows.length > 0) {
    await db.insert(sales).values(saleRows).run();
  }
  if (itemRows.length > 0) {
    await db.insert(saleItems).values(itemRows).run();
  }
  if (movementRows.length > 0) {
    await db.insert(inventoryMovements).values(movementRows).run();
  }

  return {
    count: saleRows.length,
    inventoryMovementsCount: movementRows.length,
  };
}
