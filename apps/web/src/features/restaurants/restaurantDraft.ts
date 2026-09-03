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

/** A price delta is effective only while its structured modifier has a name. */
export function getRestaurantModifierPriceDelta(input: {
  modifierName: string;
  modifierPriceDelta: number;
}): number {
  if (input.modifierName.trim().length === 0 || !Number.isFinite(input.modifierPriceDelta)) {
    return 0;
  }
  return roundMoney(Math.max(0, input.modifierPriceDelta));
}
