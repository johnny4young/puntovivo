/** ENG-110c — canonical client-side serial identity normalization. */
function normalizeSerialLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(item => item.trim().normalize('NFKC').toLocaleUpperCase('en-US'))
    .filter(Boolean);
}

export function parseSerialNumbers(value: string): string[] {
  return [...new Set(normalizeSerialLines(value))];
}

export function hasDuplicateSerialNumbers(value: string): boolean {
  const serialNumbers = normalizeSerialLines(value);
  return new Set(serialNumbers).size !== serialNumbers.length;
}

/** Resolve a physical-unit count back to the selected purchasing unit. */
export function getSerializedQuantity(serialCount: number, unitEquivalence: number): number {
  if (!Number.isFinite(unitEquivalence) || unitEquivalence <= 0) return 0;
  return serialCount / unitEquivalence;
}
