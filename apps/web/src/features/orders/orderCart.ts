import type { ProductSearchSelection } from '@/types';

export interface OrderCartItem {
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
}

export interface OrderCartSummary {
  itemCount: number;
  normalizedUnits: number;
  total: number;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function getOrderCartKey(productId: string, unitId: string) {
  return `${productId}:${unitId}`;
}

export function buildOrderCartItem(selection: ProductSearchSelection): OrderCartItem {
  const unitName =
    selection.unit.unitName ??
    selection.unit.unitAbbreviation ??
    selection.product.baseUnitAbbreviation ??
    selection.unit.unitId;
  const costPerUnit = roundCurrency((selection.product.cost ?? 0) * selection.unit.equivalence);

  return {
    key: getOrderCartKey(selection.product.id, selection.unit.unitId),
    productId: selection.product.id,
    productName: selection.product.name,
    productSku: selection.product.sku,
    unitId: selection.unit.unitId,
    unitName,
    unitEquivalence: selection.unit.equivalence,
    quantity: 1,
    costPerUnit,
    currentStock: selection.product.stock,
  };
}

export function mergeOrderCartItem(items: OrderCartItem[], selection: ProductSearchSelection) {
  const nextItem = buildOrderCartItem(selection);
  const existingIndex = items.findIndex(item => item.key === nextItem.key);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item, index) =>
    index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
  );
}

export function updateOrderCartItem(
  item: OrderCartItem,
  updates: Partial<Pick<OrderCartItem, 'quantity' | 'costPerUnit'>>
): OrderCartItem {
  return {
    ...item,
    ...updates,
  };
}

export function getOrderLineTotal(item: OrderCartItem) {
  return roundCurrency(item.costPerUnit * item.quantity);
}

export function getOrderNormalizedQuantity(item: OrderCartItem) {
  return item.quantity * item.unitEquivalence;
}

export function getOrderCartSummary(items: OrderCartItem[]): OrderCartSummary {
  return items.reduce<OrderCartSummary>(
    (summary, item) => ({
      itemCount: summary.itemCount + item.quantity,
      normalizedUnits: summary.normalizedUnits + getOrderNormalizedQuantity(item),
      total: roundCurrency(summary.total + getOrderLineTotal(item)),
    }),
    {
      itemCount: 0,
      normalizedUnits: 0,
      total: 0,
    }
  );
}
