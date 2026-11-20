import { describe, expect, it } from 'vitest';
import { getSalesDockGates } from './salesDockGates';
import type { PreflightItem } from './useCheckoutPreflight';

const printer: PreflightItem = {
  id: 'receipt_hardware_missing',
  severity: 'warning',
  messageKey: 'preflight.items.receipt_hardware_missing.message',
};

describe('getSalesDockGates', () => {
  it('reports the missing printer from readiness, even on an empty ticket', () => {
    expect(
      getSalesDockGates({ canCharge: false, hubReachable: true, readinessItems: [printer] })
        .printerMissing
    ).toBe(printer);
    expect(
      getSalesDockGates({ canCharge: false, hubReachable: true, readinessItems: [] }).printerMissing
    ).toBeUndefined();
  });

  it('keeps the drawer keys closed while the hub is unreachable', () => {
    const gate = (hubReachable: boolean | undefined) =>
      getSalesDockGates({ canCharge: true, hubReachable, readinessItems: [] })
        .canOpenDrawerFromDock;
    expect(gate(false)).toBe(false);
    expect(gate(true)).toBe(true);
    expect(gate(undefined)).toBe(true);
    expect(
      getSalesDockGates({ canCharge: false, hubReachable: true, readinessItems: [] })
        .canOpenDrawerFromDock
    ).toBe(false);
  });
});
