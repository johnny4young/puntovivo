/**
 * Client-side money rounding — single source of truth for the renderer.
 *
 * Mirror of the server's canonical `roundMoney` in
 * `packages/server/src/lib/money.ts` (ENG-176a). The formula MUST stay
 * byte-identical to the server's: the renderer only computes
 * display-side previews (cart summary, payment grand total, pricing
 * margins) and the server always recalculates before persisting, but a
 * preview that rounds differently from the receipt (e.g. the 0.005
 * half-cent boundary where plain `Math.round(v * 100) / 100` and the
 * EPSILON-corrected form disagree under IEEE-754 drift) reads as a
 * money bug to the operator at the register.
 *
 * The `Number.EPSILON` offset defeats the IEEE-754 representation
 * cases where a value like `1.005` is stored as `1.00499999...` and
 * would otherwise round down. See the server-side doc comment for the
 * full rationale and the storage-layer CHECK contract it upholds.
 */
export function roundMoney(value: number): number {
  const rounded =
    Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}
