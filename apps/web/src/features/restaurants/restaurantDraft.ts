import { roundMoney } from '@/lib/money';

const MAX_RESTAURANT_GUESTS = 200;

/** Keep editable guest counts inside the server contract and table capacity. */
export function normalizeRestaurantGuestCount(
  value: number,
  maximum = MAX_RESTAURANT_GUESTS
): number {
  const normalizedMaximum = Number.isFinite(maximum)
    ? Math.max(1, Math.min(MAX_RESTAURANT_GUESTS, Math.trunc(maximum)))
    : MAX_RESTAURANT_GUESTS;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(normalizedMaximum, Math.trunc(value)));
}

/** Local row identity never enters the frozen server snapshot. Prices are per add-on unit. */
export interface RestaurantModifierDraft {
  /** Frozen catalog authority, never overwritten by a background refresh. */
  catalogId?: string | undefined;
  catalogVersion?: number | undefined;
  maxQuantity?: number | undefined;
  /** Set when the option came from one of the dish's groups on the plate sheet. */
  groupId?: string | undefined;
  groupKind?: RestaurantModifierGroupKind | undefined;
  id: string;
  name: string;
  quantity: number;
  unitPriceDelta: number;
}

export type RestaurantModifierGroupKind = 'choice' | 'without' | 'extra';
export const RESTAURANT_COURSE_KEYS = ['starter', 'main', 'dessert', 'drink', 'other'] as const;
type RestaurantCourseKey = (typeof RESTAURANT_COURSE_KEYS)[number];

/** Editable restaurant-only metadata kept outside the generic sale cart. */
export interface RestaurantLineDraft {
  courseKey: RestaurantCourseKey;
  /** Null shares the plate with the whole table. */
  seatNumber: number | null;
  modifiers: RestaurantModifierDraft[];
  /** Groups the sheet showed; sending them makes their minimums binding on the server. */
  modifierGroups?: { id: string; version: number }[] | undefined;
}

export const RESTAURANT_MODIFIER_LIMIT = 20;
export const RESTAURANT_MODIFIER_PRICE_MAX = 1_000_000_000;
export const DEFAULT_LINE_DETAILS: RestaurantLineDraft = {
  courseKey: 'main',
  seatNumber: 1,
  modifiers: [],
};

/** Blank optional rows contribute nothing; snapshots use the server's per-unit money rounding. */
export function restaurantModifierSnapshot(modifiers: readonly RestaurantModifierDraft[]) {
  return modifiers
    .filter(modifier => modifier.name.trim().length > 0)
    .map(modifier => ({
      ...(modifier.catalogId
        ? { catalogId: modifier.catalogId, catalogVersion: modifier.catalogVersion }
        : {}),
      ...(modifier.catalogId && modifier.groupId ? { groupId: modifier.groupId } : {}),
      name: modifier.name.trim(),
      quantity: modifier.quantity,
      unitPriceDelta: roundMoney(modifier.unitPriceDelta),
    }));
}

/** Mirrors the server's locale-independent uniqueness rule without hiding invalid rows. */
export function hasDuplicateRestaurantModifiers(
  modifiers: readonly RestaurantModifierDraft[]
): boolean {
  const names = modifiers.map(modifier => modifier.name.trim().toLowerCase()).filter(Boolean);
  return new Set(names).size !== names.length;
}

/** Round each unit price before multiplying, then round each accumulated addition, as on the server. */
export function getRestaurantModifierPriceDelta(
  modifiers: readonly RestaurantModifierDraft[]
): number {
  return restaurantModifierSnapshot(modifiers).reduce(
    (total, modifier) => roundMoney(total + modifier.quantity * modifier.unitPriceDelta),
    0
  );
}
