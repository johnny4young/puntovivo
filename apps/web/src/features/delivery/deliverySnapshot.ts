import { formatCurrency } from '@/lib/utils';
/** Small display-only shape; it must never be used to compute financial settlement. */
export interface DeliverySnapshotItem {
  name: string;
  qty: number;
  unitPrice: number;
}
/** Historical snapshots are untrusted JSON. Invalid values must not crash React or fabricate item data. */
export function parseDeliveryItems(snapshot: string | null | undefined): DeliverySnapshotItem[] {
  if (!snapshot || snapshot.length > 256_000) return [];
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!Array.isArray(value) || value.length > 200) return [];
    const valid = value.every((item: unknown): item is DeliverySnapshotItem => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return (
        typeof row.name === 'string' &&
        row.name.length <= 255 &&
        typeof row.qty === 'number' &&
        Number.isFinite(row.qty) &&
        row.qty > 0 &&
        typeof row.unitPrice === 'number' &&
        Number.isFinite(row.unitPrice) &&
        row.unitPrice >= 0
      );
    });
    return valid ? (value as DeliverySnapshotItem[]) : [];
  } catch {
    return [];
  }
}

/** Historical rows without a frozen currency must not inherit today's tenant currency. */
export function formatDeliveryAmount(
  amount: number,
  currency: string | null,
  unknownLabel: string
): string {
  return currency && /^[A-Z]{3}$/.test(currency)
    ? formatCurrency(amount, currency)
    : `${amount.toFixed(2)} · ${unknownLabel}`;
}
