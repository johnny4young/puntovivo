import { useMemo } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { pharmacyCheckoutInput } from './pharmacyCheckout';
import {
  pharmacyCustomerNote,
  pharmacyLineHint,
  type PharmacyCustomerNote,
  type PharmacyLineHint,
  type PharmacyTicketRequirement,
} from './pharmacyRegister';

interface TicketLine {
  productId: string;
  quantity: number;
  unitEquivalence?: number | undefined;
}

export interface PharmacyTicket {
  /** Keyed by product id: lot, class and prescription state for each medicine line. */
  lines: ReadonlyMap<string, PharmacyLineHint>;
  customerNote: PharmacyCustomerNote | null;
  hasControlled: boolean;
  hasNotices: boolean;
  prescriptionLineCount: number;
}

const EMPTY: PharmacyTicket = {
  lines: new Map(),
  customerNote: null,
  hasControlled: false,
  hasNotices: false,
  prescriptionLineCount: 0,
};

/** Quantity taps settle before the preflight runs again. */
const INPUT_DEBOUNCE_MS = 250;

/**
 * The register's read of the pharmacy checkout preflight, so each line shows
 * its lot and prescription state before Cobrar. Same query as the charge drawer.
 */
export function usePharmacyTicket(
  items: readonly TicketLine[],
  customerId: string | null,
  siteId: string | null | undefined
): PharmacyTicket {
  const zoneOn = useRegisterZone('pharmacy-lot');
  const input = useMemo(() => pharmacyCheckoutInput(items, customerId), [items, customerId]);
  const settledInput = useDebouncedValue(input, INPUT_DEBOUNCE_MS);
  const enabled = zoneOn && Boolean(siteId) && items.length > 0;
  const query = trpc.pharmacy.checkoutRequirements.useQuery(settledInput, {
    enabled: enabled && settledInput.items.length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const requirements: readonly PharmacyTicketRequirement[] | undefined = enabled
    ? query.data?.requirements
    : undefined;

  return useMemo(() => {
    if (!requirements || requirements.length === 0) return EMPTY;
    const lines = new Map(
      requirements.map(requirement => [requirement.productId, pharmacyLineHint(requirement)])
    );
    const customerNote = pharmacyCustomerNote(requirements, customerId !== null);
    const hasControlled = requirements.some(
      requirement => requirement.classification === 'controlled'
    );
    return {
      lines,
      customerNote,
      hasControlled,
      hasNotices: customerNote !== null || hasControlled,
      prescriptionLineCount: items.filter(
        item => lines.get(item.productId)?.classification === 'prescription'
      ).length,
    };
  }, [requirements, customerId, items]);
}
