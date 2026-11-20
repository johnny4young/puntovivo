import type { PreflightItem } from './useCheckoutPreflight';

interface SalesDockGatesInput {
  canCharge: boolean;
  hubReachable: boolean | undefined;
  /** Server readiness items; unlike cart preflight they hold while the ticket is empty. */
  readinessItems: readonly PreflightItem[];
}

/** What the register strip and the dock keys may offer, before any sale-specific check. */
export function getSalesDockGates({
  canCharge,
  hubReachable,
  readinessItems,
}: SalesDockGatesInput) {
  return {
    // The customer and invoice keys open the charge drawer, so the hub gate applies.
    canOpenDrawerFromDock: canCharge && hubReachable !== false,
    printerMissing: readinessItems.find(item => item.id === 'receipt_hardware_missing'),
  };
}
