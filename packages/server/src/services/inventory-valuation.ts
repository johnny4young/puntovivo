/**
 * Integer-cent carrying values complement, never replace, physical stock.
 * A rounded unit price is a display/default price, not enough information to
 * reconstruct the value left by a fractional transformation. Partial debits
 * allocate the current total and retain the remainder for the next debit.
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { roundMoney, tryRoundMoneyToSafeCents } from '../lib/money.js';

const QUANTITY_SCALE = 12;

/** Safe signed cents; no hidden rounding of an authoritative stored total. */
function cents(value: number): bigint {
  const rounded = tryRoundMoneyToSafeCents(value);
  if (rounded === null || rounded !== value) throw new RangeError('Invalid inventory value');
  return BigInt(Math.round(value * 100));
}

function money(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Inventory value exceeds the exact cent range');
  }
  const result = roundMoney(Number(value) / 100);
  if (cents(result) !== value) throw new RangeError('Inventory cents cannot round-trip exactly');
  return result;
}

/** Normalize physical quantities at the existing twelve-decimal stock boundary. */
function quantityUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid inventory quantity');
  const normalized = roundQuantity(value, QUANTITY_SCALE);
  if (!Number.isFinite(normalized) || (value > 0 && normalized === 0)) {
    throw new RangeError('Invalid inventory quantity');
  }
  const [mantissa, exponentText = '0'] = normalized.toString().split('e');
  const [whole, fraction = ''] = mantissa!.split('.');
  const exponent = Number(exponentText) + QUANTITY_SCALE - fraction.length;
  const digits = BigInt(whole! + fraction);
  return exponent >= 0 ? digits * 10n ** BigInt(exponent) : digits / 10n ** BigInt(-exponent);
}

/** Exact cent allocation for a debit; the final physical unit owns every remaining cent. */
export interface InventoryValueAllocation {
  consumedValue: number;
  remainingValue: number;
}

/**
 * Apportion an existing carrying value using exact integer quantity ratios.
 * Half-cent ties round away from zero, matching the shared money convention.
 * Repeated partial consumption cannot create/discard the final cent.
 */
export function allocateInventoryValue(
  value: number,
  availableQuantity: number,
  consumedQuantity: number
): InventoryValueAllocation {
  const total = cents(value);
  const available = quantityUnits(availableQuantity);
  const consumed = quantityUnits(consumedQuantity);
  if (available === 0n || consumed > available) {
    throw new RangeError('Inventory value allocation exceeds physical stock');
  }
  const magnitude = total < 0n ? -total : total;
  const numerator = magnitude * consumed;
  const quotient = numerator / available;
  const remainder = numerator % available;
  const rounded = quotient + (2n * remainder >= available ? 1n : 0n);
  const taken = total < 0n ? -rounded : rounded;
  return { consumedValue: money(taken), remainingValue: money(total - taken) };
}

/** Add already-rounded carrying values without a floating-point accumulation step. */
export function addInventoryValues(...values: readonly number[]): number {
  return money(values.reduce((sum, value) => sum + cents(value), 0n));
}

/** Persist amounts as safe integer cents without silently accepting a rounded input. */
export function toInventoryCents(value: number): number {
  return Number(cents(value));
}

/** Decode storage cents only when both the integer and money representation round-trip. */
export function fromInventoryCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Invalid inventory cents');
  return money(BigInt(value));
}

/**
 * Adopt the currently observable legacy basis only; do not invent historical
 * transaction values. New exact totals bypass this compatibility calculation.
 */
export function legacyInventoryValue(quantity: number, unitCost: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost) || unitCost < 0) {
    throw new RangeError('Invalid legacy inventory basis');
  }
  const value = tryRoundMoneyToSafeCents(quantity * unitCost);
  if (value === null) throw new RangeError('Inventory value exceeds the exact cent range');
  return value;
}

/** Split one authoritative receipt total, leaving rounding residuals with later identities. */
export function partitionInventoryValue(value: number, quantities: readonly number[]): number[] {
  if (cents(value) < 0n) throw new RangeError('Receipt value cannot be negative');
  if (quantities.length === 0) {
    if (value !== 0) throw new RangeError('Receipt value requires physical identities');
    return [];
  }
  for (const quantity of quantities) {
    if (quantityUnits(quantity) === 0n) throw new RangeError('Receipt quantity must be positive');
  }
  let remainingQuantity = quantities.reduce(
    (sum, quantity) => roundQuantity(sum + quantity, 12),
    0
  );
  let remainingValue = value;
  return quantities.map(quantity => {
    const allocation = allocateInventoryValue(remainingValue, remainingQuantity, quantity);
    remainingQuantity = roundQuantity(remainingQuantity - quantity, 12);
    remainingValue = allocation.remainingValue;
    return allocation.consumedValue;
  });
}
