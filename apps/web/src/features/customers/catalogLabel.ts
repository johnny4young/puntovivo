/**
 * Resolve a customer-catalog reference to a human-readable label.
 *
 * `customers.identification_type_id` / `client_type_id` are unconstrained
 * `text` columns (no FK in `schema.ts`), and the app writes them
 * inconsistently: the dev seed stores the catalog row's `id` (a nanoid),
 * while `CustomerCatalogSelect` stores its `code` (e.g. "CC"). Reading the
 * column raw therefore leaks a nanoid into the UI for seeded / id-valued
 * rows (e.g. `Ch0-W7mj_qvHl2oxUr67x` instead of `CC`).
 *
 * This resolver maps the stored value to a catalog row by `id` and returns
 * the requested display `field`; when no row matches (the value is already a
 * `code`, or the catalog list has not loaded yet) it falls back to the raw
 * value, so it is correct for BOTH the id-valued and code-valued shapes and
 * never renders an empty cell where data exists.
 *
 * NOTE: this only normalizes the read side. The underlying write-contract
 * ambiguity (a `*_type_id` column holding a code) is a separate data-model
 * decision for the operator — see the UI-test report.
 *
 * @param items - The catalog rows (identification types, client types, ...).
 * @param value - The stored reference: a catalog `id`, a legacy `code`, or nullish.
 * @param field - Which catalog column to display. Defaults to `code`.
 * @returns The resolved label, the raw value when unresolved, or `undefined` when `value` is empty.
 */
import type { CustomerCatalogItem } from '@/types';

export function resolveCatalogLabel(
  items: readonly CustomerCatalogItem[],
  value: string | null | undefined,
  field: 'code' | 'name' = 'code'
): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = items.find(item => item.id === value);
  return match ? match[field] : value;
}
