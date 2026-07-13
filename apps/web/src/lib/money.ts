/**
 * Renderer compatibility facade for the shared money primitive (ENG-203).
 *
 * The renderer only computes
 * display-side previews (cart summary, payment grand total, pricing
 * margins) and the server always recalculates before persisting. Keeping
 * this import path preserves existing call sites while
 * `@puntovivo/shared/money` owns the cross-runtime implementation.
 */
export { roundMoney } from '@puntovivo/shared/money';
