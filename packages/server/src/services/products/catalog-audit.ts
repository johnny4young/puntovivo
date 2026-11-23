/** Fields whose change decides what a receipt charges or how a product is found. */
const AUDITED_PRODUCT_FIELDS = [
  'name',
  'sku',
  'barcode',
  'categoryId',
  'price',
  'price2',
  'price3',
  'cost',
  'initialCost',
  'taxRate',
  'taxKind',
  'vatRateId',
  'isActive',
] as const;

export function productAuditSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(AUDITED_PRODUCT_FIELDS.map(field => [field, row[field] ?? null]));
}

/** Changed audited fields only, or null when none changed. */
export function productAuditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changed = AUDITED_PRODUCT_FIELDS.filter(
    field => field in after && (before[field] ?? null) !== (after[field] ?? null)
  );
  if (changed.length === 0) return null;
  return {
    before: Object.fromEntries(changed.map(field => [field, before[field] ?? null])),
    after: Object.fromEntries(changed.map(field => [field, after[field] ?? null])),
  };
}
