/** Tenant-wide exact pools retain the existing global (not site-average) cost policy. */
import { inventoryValueGuard } from './inventory-value-errors.js';
import { and, eq, isNull } from 'drizzle-orm';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { DatabaseInstance } from '../db/index.js';
import { products } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { getProductStockTotal } from './inventory-balances/derive.js';
import {
  addInventoryValues,
  allocateInventoryValue,
  fromInventoryCents,
  legacyInventoryValue,
  toInventoryCents,
} from './inventory-valuation.js';

/** Immutable pre-debit pool observation; physical quantity is always read from the rollup. */
export interface ProductValuationState {
  tenantId: string;
  productId: string;
  quantity: number;
  inventoryValue: number;
  cogsValue: number;
  initialCost: number;
  cost: number;
  version: number;
  storedInventoryCents: number | null;
  storedCogsCents: number | null;
  storedQuantity: number | null;
}

/** Signed amounts accompany a physical delta and can be frozen for exact reversal/transit. */
export interface InventoryValueDelta {
  inventoryValue: number;
  cogsValue: number;
}

/** Resulting revision makes stale undo sensitive to activity in every site in the pool. */
export interface AppliedInventoryValueDelta extends InventoryValueDelta {
  version: number;
}

function stale(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'INVENTORY_VALUE_CHANGED',
    message: 'Inventory valuation changed or lacks an exact quantity basis',
  });
}

/** Read before any balance update; lots and serialized identities retain their own cost authority. */
export function readProductValuation(
  db: DatabaseInstance,
  tenantId: string,
  productId: string
): ProductValuationState | null {
  return inventoryValueGuard(() => {
    const row = db
      .select({
        initialCost: products.initialCost,
        cost: products.cost,
        tracksLots: products.tracksLots,
        tracksSerials: products.tracksSerials,
        inventoryValueCents: products.inventoryValueCents,
        cogsValueCents: products.cogsValueCents,
        valuationQuantity: products.valuationQuantity,
        valuationVersion: products.valuationVersion,
      })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .get();
    if (!row || row.tracksLots || row.tracksSerials) return null;
    const quantity = roundQuantity(getProductStockTotal(db, tenantId, productId), 12);
    if (!Number.isFinite(quantity))
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
        message: 'Global physical stock exceeds the supported quantity range',
      });
    const adopted =
      row.inventoryValueCents !== null ||
      row.cogsValueCents !== null ||
      row.valuationQuantity !== null;
    if (
      adopted &&
      (row.inventoryValueCents === null ||
        row.cogsValueCents === null ||
        row.valuationQuantity !== quantity)
    )
      stale();
    return {
      tenantId,
      productId,
      quantity,
      inventoryValue:
        row.inventoryValueCents === null
          ? legacyInventoryValue(quantity, row.initialCost)
          : fromInventoryCents(row.inventoryValueCents),
      cogsValue:
        row.cogsValueCents === null
          ? legacyInventoryValue(quantity, row.cost)
          : fromInventoryCents(row.cogsValueCents),
      initialCost: row.initialCost,
      cost: row.cost,
      version: row.valuationVersion,
      storedInventoryCents: row.inventoryValueCents,
      storedCogsCents: row.cogsValueCents,
      storedQuantity: row.valuationQuantity,
    };
  }, 'INVENTORY_VALUE_INVALID');
}

/** Preserve legacy negative-stock behavior without dividing by a non-positive pool quantity. */
function debitValue(value: number, quantity: number, debit: number, unitCost: number): number {
  if (quantity <= 0) return legacyInventoryValue(debit, unitCost);
  if (debit <= quantity) return allocateInventoryValue(value, quantity, debit).consumedValue;
  return addInventoryValues(
    value,
    legacyInventoryValue(roundQuantity(debit - quantity, 12), unitCost)
  );
}

/** Compute a default debit from the pool or a receipt at the current explicit catalog basis. */
export function planProductValueDelta(
  state: ProductValuationState,
  delta: number
): InventoryValueDelta {
  return inventoryValueGuard(() => {
    if (delta < 0)
      return {
        inventoryValue: -debitValue(
          state.inventoryValue,
          state.quantity,
          -delta,
          state.initialCost
        ),
        cogsValue: -debitValue(state.cogsValue, state.quantity, -delta, state.cost),
      };
    return {
      inventoryValue: legacyInventoryValue(delta, state.initialCost),
      cogsValue: legacyInventoryValue(delta, state.cost),
    };
  }, 'INVENTORY_VALUE_INVALID');
}

/** Persist immediately after the matching balance update, inside the same caller-owned transaction. */
export function applyProductValueDelta(
  db: DatabaseInstance,
  before: ProductValuationState,
  quantityDelta: number,
  values: InventoryValueDelta = planProductValueDelta(before, quantityDelta)
): AppliedInventoryValueDelta {
  return inventoryValueGuard(() => {
    const quantity = roundQuantity(before.quantity + quantityDelta, 12);
    if (roundQuantity(getProductStockTotal(db, before.tenantId, before.productId), 12) !== quantity)
      stale();
    const inventoryValue = addInventoryValues(before.inventoryValue, values.inventoryValue);
    const cogsValue = addInventoryValues(before.cogsValue, values.cogsValue);
    if (quantity === 0 && (inventoryValue !== 0 || cogsValue !== 0)) stale();
    const changed = db
      .update(products)
      .set({
        inventoryValueCents: toInventoryCents(inventoryValue),
        cogsValueCents: toInventoryCents(cogsValue),
        valuationQuantity: quantity,
        valuationVersion: before.version + 1,
      })
      .where(
        and(
          eq(products.tenantId, before.tenantId),
          eq(products.id, before.productId),
          eq(products.valuationVersion, before.version),
          before.storedInventoryCents === null
            ? isNull(products.inventoryValueCents)
            : eq(products.inventoryValueCents, before.storedInventoryCents),
          before.storedCogsCents === null
            ? isNull(products.cogsValueCents)
            : eq(products.cogsValueCents, before.storedCogsCents),
          before.storedQuantity === null
            ? isNull(products.valuationQuantity)
            : eq(products.valuationQuantity, before.storedQuantity)
        )
      )
      .run();
    if (changed.changes !== 1) stale();
    return { ...values, version: before.version + 1 };
  }, 'INVENTORY_VALUE_INVALID');
}

/** Freeze only authoritative applied amounts; null is unknown, not a zero-valued movement. */
export function inventoryMovementValueSnapshot(values: InventoryValueDelta | null) {
  return inventoryValueGuard(
    () => ({
      inventoryValueDeltaCents: values === null ? null : toInventoryCents(values.inventoryValue),
      cogsValueDeltaCents: values === null ? null : toInventoryCents(values.cogsValue),
    }),
    'INVENTORY_VALUE_INVALID'
  );
}
