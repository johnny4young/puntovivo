import { roundMoney } from '@/lib/money';
import type { ProductSearchSelection } from '@/types';
import {
  getSerializedQuantity,
  hasDuplicateSerialNumbers,
  parseSerialNumbers,
} from '@/features/inventory/serialNumbers';

export interface PurchaseCartItem {
  key: string;
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string;
  unitEquivalence: number;
  quantity: number;
  costPerUnit: number;
  currentStock: number;
  tracksSerials: boolean;
  serialNumbers: string;
}

export interface PurchaseCartSummary {
  itemCount: number;
  normalizedUnits: number;
  total: number;
}

export function getPurchaseCartKey(productId: string, unitId: string) {
  return `${productId}:${unitId}`;
}

export function buildPurchaseCartItem(selection: ProductSearchSelection): PurchaseCartItem {
  const unitName =
    selection.unit.unitName ??
    selection.unit.unitAbbreviation ??
    selection.product.baseUnitAbbreviation ??
    selection.unit.unitId;
  const costPerUnit = roundMoney((selection.product.cost ?? 0) * selection.unit.equivalence);

  return {
    key: getPurchaseCartKey(selection.product.id, selection.unit.unitId),
    productId: selection.product.id,
    productName: selection.product.name,
    productSku: selection.product.sku,
    unitId: selection.unit.unitId,
    unitName,
    unitEquivalence: selection.unit.equivalence,
    quantity: 1,
    costPerUnit,
    currentStock: selection.product.stock,
    tracksSerials: selection.product.tracksSerials === true,
    serialNumbers: '',
  };
}

export function mergePurchaseCartItem(
  items: PurchaseCartItem[],
  selection: ProductSearchSelection
) {
  const nextItem = buildPurchaseCartItem(selection);
  const existingIndex = items.findIndex(item => item.key === nextItem.key);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  if (nextItem.tracksSerials) {
    return items;
  }

  return items.map((item, index) =>
    index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
  );
}

export function updatePurchaseCartItem(
  item: PurchaseCartItem,
  updates: Partial<Pick<PurchaseCartItem, 'quantity' | 'costPerUnit'>>
): PurchaseCartItem {
  return {
    ...item,
    ...updates,
  };
}

export function updatePurchaseCartSerialNumbers(
  item: PurchaseCartItem,
  serialNumbers: string
): PurchaseCartItem {
  return {
    ...item,
    serialNumbers,
    quantity: getSerializedQuantity(parseSerialNumbers(serialNumbers).length, item.unitEquivalence),
  };
}

export function hasCompletePurchaseSerials(items: PurchaseCartItem[]): boolean {
  return items.every(
    item =>
      !item.tracksSerials ||
      (parseSerialNumbers(item.serialNumbers).length > 0 &&
        !hasDuplicateSerialNumbers(item.serialNumbers))
  );
}

export function getPurchaseLineTotal(item: PurchaseCartItem) {
  return roundMoney(item.costPerUnit * item.quantity);
}

export function getPurchaseNormalizedQuantity(item: PurchaseCartItem) {
  return item.quantity * item.unitEquivalence;
}

export function getPurchaseCartSummary(items: PurchaseCartItem[]): PurchaseCartSummary {
  return items.reduce<PurchaseCartSummary>(
    (summary, item) => ({
      itemCount: summary.itemCount + item.quantity,
      normalizedUnits: summary.normalizedUnits + getPurchaseNormalizedQuantity(item),
      total: roundMoney(summary.total + getPurchaseLineTotal(item)),
    }),
    {
      itemCount: 0,
      normalizedUnits: 0,
      total: 0,
    }
  );
}
