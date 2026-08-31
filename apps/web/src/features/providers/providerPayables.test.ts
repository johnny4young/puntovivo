import { describe, expect, it } from 'vitest';
import { allocateOldestInvoices, allocationTotal } from './providerPayables';

describe('provider payable UI helpers', () => {
  it('allocates oldest invoices without exceeding their outstanding balances', () => {
    const allocations = allocateOldestInvoices(
      [
        { id: 'oldest', outstanding: 25.55 },
        { id: 'newer', outstanding: 100 },
      ],
      80
    );

    expect(allocations).toEqual([
      { invoiceId: 'oldest', amount: 25.55 },
      { invoiceId: 'newer', amount: 54.45 },
    ]);
    expect(allocationTotal(allocations)).toBe(80);
  });

  it('leaves a visible shortfall when the requested amount exceeds all open debt', () => {
    const allocations = allocateOldestInvoices([{ id: 'invoice', outstanding: 20 }], 25);
    expect(allocationTotal(allocations)).toBe(20);
  });
});
