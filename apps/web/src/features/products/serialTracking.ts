/** every sale unit for a serialized product is one physical unit. */
export function validateSerialUnitEquivalence(
  tracksSerials: boolean,
  equivalence: number,
  errorMessage: string
): true | string {
  return !tracksSerials || Math.abs(equivalence - 1) <= 1e-9 || errorMessage;
}
