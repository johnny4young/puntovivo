import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { vatRates, type TaxKind } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

const RATE_EPSILON = 1e-9;

export interface AllowedTaxRatesByKind {
  iva: readonly number[];
  inc: readonly number[];
}

/**
 * Load the active tenant-owned rate catalog once for a pricing operation.
 * Product snapshots remain readable when an old catalog row is disabled, but
 * a new numeric override must match an active rate of the product's tax kind.
 */
export function loadAllowedTaxRatesByKind(
  db: DatabaseInstance,
  tenantId: string
): AllowedTaxRatesByKind {
  const rows = db
    .select({ rate: vatRates.rate, kind: vatRates.kind })
    .from(vatRates)
    .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.isActive, true)))
    .all();

  return {
    iva: rows.filter(row => row.kind === 'iva').map(row => row.rate),
    inc: rows.filter(row => row.kind === 'inc').map(row => row.rate),
  };
}

function ratesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= RATE_EPSILON;
}

/**
 * An unchanged catalog snapshot is always accepted. A real override is
 * fail-closed unless the tenant currently owns an active rate with the same
 * kind and numeric value; changing the number never reclassifies IVA as INC.
 */
export function assertTaxRateOverrideAllowed(args: {
  allowedRates: AllowedTaxRatesByKind;
  catalogTaxRate: number;
  requestedTaxRate: number;
  taxKind: TaxKind;
  productId: string;
}): void {
  if (ratesEqual(args.catalogTaxRate, args.requestedTaxRate)) return;

  if (args.allowedRates[args.taxKind].some(rate => ratesEqual(rate, args.requestedTaxRate))) {
    return;
  }

  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'TAX_RATE_KIND_INVALID',
    message: 'The requested tax-rate override is not active for the product tax kind',
    details: {
      productId: args.productId,
      taxKind: args.taxKind,
      requestedTaxRate: args.requestedTaxRate,
      allowedTaxRates: args.allowedRates[args.taxKind],
    },
  });
}
