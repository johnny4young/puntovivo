import { useState } from 'react';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { SaleCartItem } from '@/features/sales/saleCart';

export interface LastRead {
  key: string;
  /** Changes on every repeat read of the same line. */
  quantity: number;
  productName: string;
  unitPrice: number;
  /** Base units left after this ticket; null for lines that hold no stock. */
  remaining: number | null;
}

/**
 * The line a scan or add just touched: a new line, or one whose quantity grew.
 * Other edits keep the current read; undoing or removing its line clears it.
 */
export function nextReadKey(
  previous: readonly SaleCartItem[],
  next: readonly SaleCartItem[],
  current: string | null
): string | null {
  const before = new Map(previous.map(item => [item.key, item.quantity]));
  const grown = next.filter(item => item.quantity > (before.get(item.key) ?? 0));
  const latest = grown[grown.length - 1];
  if (latest) return latest.key;
  const held = next.find(item => item.key === current);
  return held && held.quantity >= (before.get(held.key) ?? 0) ? held.key : null;
}

// Callers may hand a fresh array every render, so lines are compared by content.
function quantitiesChanged(a: readonly SaleCartItem[], b: readonly SaleCartItem[]): boolean {
  return (
    a.length !== b.length ||
    a.some((item, index) => item.key !== b[index]?.key || item.quantity !== b[index]?.quantity)
  );
}

/** Tracks the last read of one ticket; `scopeKey` is the ticket identity. */
export function useLastRead(items: SaleCartItem[], scopeKey: string | null): LastRead | null {
  const [tracked, setTracked] = useState({ scopeKey, items, key: null as string | null });
  let key = tracked.key;
  if (tracked.scopeKey !== scopeKey) {
    key = null;
    setTracked({ scopeKey, items, key });
  } else if (tracked.items !== items && quantitiesChanged(tracked.items, items)) {
    key = nextReadKey(tracked.items, items, tracked.key);
    setTracked({ scopeKey, items, key });
  }

  const item = key ? items.find(candidate => candidate.key === key) : undefined;
  if (!item) return null;
  const tracksStock = item.tracksStock !== false && Number.isFinite(item.availableStock);
  // Another unit or a price-label line of the same product draws on the same stock.
  const onTicket = items
    .filter(line => line.productId === item.productId)
    .reduce((sum, line) => sum + line.quantity * line.unitEquivalence, 0);
  return {
    key: item.key,
    quantity: item.quantity,
    productName: item.productName,
    unitPrice: item.unitPrice,
    remaining: tracksStock ? Math.max(0, roundQuantity(item.availableStock - onTicket)) : null,
  };
}
