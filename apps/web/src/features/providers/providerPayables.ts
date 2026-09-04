import { roundMoney } from '@/lib/money';

export interface OpenProviderInvoice {
  id: string;
  outstanding: number;
}

/**
 * Allocate a payment/credit against the oldest open invoices returned by the
 * server. The server owns the final outstanding check inside BEGIN IMMEDIATE;
 * this helper only builds the operator-visible proposal.
 */
export function allocateOldestInvoices(
  openInvoices: readonly OpenProviderInvoice[],
  amount: number
): Array<{ invoiceId: string; amount: number }> {
  let remaining = roundMoney(Math.max(0, amount));
  const allocations: Array<{ invoiceId: string; amount: number }> = [];
  for (const invoice of openInvoices) {
    if (remaining <= 0) break;
    const allocated = roundMoney(Math.min(remaining, invoice.outstanding));
    if (allocated <= 0) continue;
    allocations.push({ invoiceId: invoice.id, amount: allocated });
    remaining = roundMoney(remaining - allocated);
  }
  return allocations;
}

export function allocationTotal(allocations: ReadonlyArray<{ amount: number }>): number {
  return roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
}
