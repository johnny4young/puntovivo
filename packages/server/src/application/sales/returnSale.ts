/**
 * Stable return application boundary.
 *
 * The normalized implementation lives in partialReturnSale while existing
 * application/router imports keep this long-lived module path. Keeping the
 * compatibility seam here avoids two independent return implementations and
 * makes every legacy test exercise the same transactional service.
 */
export { previewSaleReturn, returnSale } from './partialReturnSale.js';
export type { ReturnSaleInput } from './partialReturnSale.js';
