import { formatCalendarDay, formatDate } from '@/lib/utils';

const QUANTITY_EPSILON = 1e-6;

let lotDraftSequence = 0;

export interface LotReceiptDraft {
  id: string;
  lotNumber: string;
  expiresAt: string;
  baseQuantity: string;
  notes: string;
}

export interface LotReceiptPayload {
  lotNumber: string;
  expiresAt?: string | null;
  baseQuantity: number;
  notes?: string | null;
}

export interface ExactLotOption {
  id: string;
  lotNumber: string;
  expiresAt?: string | null;
  status?: string | null;
  availableQuantity: number;
}

export type ExactLotAllocationDraft = Record<string, string>;

/** Match the server's fail-closed treatment of malformed or elapsed lot dates. */
export function isLotExpiredAt(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    const expiryTime = Date.parse(`${expiresAt}T00:00:00.000Z`);
    if (
      !Number.isFinite(expiryTime) ||
      new Date(expiryTime).toISOString().slice(0, 10) !== expiresAt
    ) {
      return true;
    }
    return expiresAt < new Date(now).toISOString().slice(0, 10);
  }
  const epoch = Date.parse(expiresAt);
  return !Number.isFinite(epoch) || epoch <= now;
}

/** Avoid replacing a stable allocation option array during query refreshes. */
export function haveSameExactLotOptions(
  left: readonly ExactLotOption[] | undefined,
  right: readonly ExactLotOption[]
): boolean {
  return (
    left?.length === right.length &&
    right.every((option, index) => {
      const previous = left[index];
      return (
        previous?.id === option.id &&
        previous.lotNumber === option.lotNumber &&
        previous.expiresAt === option.expiresAt &&
        previous.status === option.status &&
        previous.availableQuantity === option.availableQuantity
      );
    })
  );
}

/**
 * Lot expiries may be calendar days or full instants. Date-only values must
 * never be interpreted as midnight UTC because that renders as the previous
 * day for tenants west of Greenwich.
 */
export function formatLotExpiryDate(expiresAt: string, locale?: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
    ? formatCalendarDay(expiresAt, locale)
    : formatDate(expiresAt, undefined, locale);
}

export function createLotReceiptDraft(
  initial: Partial<Omit<LotReceiptDraft, 'id'>> = {}
): LotReceiptDraft {
  lotDraftSequence += 1;
  return {
    id: `lot-receipt-${lotDraftSequence}`,
    lotNumber: initial.lotNumber ?? '',
    expiresAt: initial.expiresAt ?? '',
    baseQuantity: initial.baseQuantity ?? '',
    notes: initial.notes ?? '',
  };
}

export function parsePositiveQuantity(raw: string): number {
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function sumLotReceiptQuantity(rows: readonly LotReceiptDraft[]): number {
  return rows.reduce((sum, row) => sum + parsePositiveQuantity(row.baseQuantity), 0);
}

export function normalizeLotReceipts(rows: readonly LotReceiptDraft[]): LotReceiptPayload[] | null {
  const nonEmptyRows = rows.filter(
    row => row.lotNumber.trim().length > 0 || row.baseQuantity.trim().length > 0
  );
  if (nonEmptyRows.length === 0) return null;

  const seen = new Set<string>();
  const normalized: LotReceiptPayload[] = [];
  for (const row of nonEmptyRows) {
    const lotNumber = row.lotNumber.trim();
    const baseQuantity = parsePositiveQuantity(row.baseQuantity);
    const identity = lotNumber.toLocaleLowerCase();
    if (!lotNumber || baseQuantity <= 0 || seen.has(identity)) return null;
    seen.add(identity);
    normalized.push({
      lotNumber,
      baseQuantity,
      ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
    });
  }
  return normalized;
}

export function quantitiesMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= QUANTITY_EPSILON;
}

export function sumExactLotAllocations(value: ExactLotAllocationDraft): number {
  return Object.values(value).reduce((sum, raw) => sum + parsePositiveQuantity(raw), 0);
}

export function normalizeExactLotAllocations(
  options: readonly ExactLotOption[],
  value: ExactLotAllocationDraft
): Array<{ lotId: string; quantity: number }> | null {
  const optionById = new Map(options.map(option => [option.id, option]));
  const normalized: Array<{ lotId: string; quantity: number }> = [];
  for (const [lotId, raw] of Object.entries(value)) {
    const quantity = parsePositiveQuantity(raw);
    if (quantity <= 0) continue;
    const option = optionById.get(lotId);
    if (!option || quantity - option.availableQuantity > QUANTITY_EPSILON) return null;
    normalized.push({ lotId, quantity });
  }
  return normalized.length > 0 ? normalized : null;
}

export function isExactLotAllocationValid(
  options: readonly ExactLotOption[],
  value: ExactLotAllocationDraft,
  expectedQuantity?: number
): boolean {
  const normalized = normalizeExactLotAllocations(options, value);
  if (!normalized) return false;
  return (
    expectedQuantity === undefined ||
    quantitiesMatch(
      normalized.reduce((sum, allocation) => sum + allocation.quantity, 0),
      expectedQuantity
    )
  );
}
