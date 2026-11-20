/** Prefix grammar of the register command bar; scanner bursts never reach it. */
export type CommandBarMode =
  | { kind: 'search'; query: string }
  | { kind: 'customer'; query: string }
  | { kind: 'action'; query: string };

export const MAX_COMMAND_QUANTITY = 9999;

const QUANTITY_PREFIX = /^\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*\*(.*)$/s;

/** Reads a leading `N*`; null when absent, zero or above the cap. */
export function parseQuantityPrefix(raw: string): { quantity: number; rest: string } | null {
  const match = QUANTITY_PREFIX.exec(raw);
  if (!match) return null;
  const quantity = Number(match[1]!.replace(',', '.'));
  if (!(quantity > 0) || quantity > MAX_COMMAND_QUANTITY) return null;
  return { quantity, rest: match[2]!.trimStart() };
}

export function parseCommandBarMode(raw: string): CommandBarMode {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('@')) return { kind: 'customer', query: trimmed.slice(1).trim() };
  if (trimmed.startsWith('/')) return { kind: 'action', query: trimmed.slice(1).trim() };
  return { kind: 'search', query: raw.trim() };
}

/** Whole units unless the product sells by fraction. */
export function quantityFitsProduct(quantity: number, product: { sellByFraction: boolean }) {
  return product.sellByFraction || Number.isInteger(quantity);
}
