import { useMemo } from 'react';
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

function queryCustomerId(queryKey: readonly unknown[] | undefined): string | null | undefined {
  const params = queryKey?.[1] as { input?: { customerId?: string | null } } | undefined;
  return params?.input?.customerId;
}

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
  const settledItems = useDebouncedValue(items, INPUT_DEBOUNCE_MS);
  const input = useMemo(
    () => pharmacyCheckoutInput(settledItems, customerId),
    [settledItems, customerId]
  );
  const enabled = zoneOn && Boolean(siteId) && items.length > 0;
  const query = trpc.pharmacy.checkoutRequirements.useQuery(input, {
    enabled: enabled && input.items.length > 0,
    staleTime: 15_000,
    // Keep the last answer through quantity edits, never across a customer change.
    placeholderData: (previous, previousQuery) =>
      queryCustomerId(previousQuery?.queryKey) === customerId ? previous : undefined,
  });
  const requirements: readonly PharmacyTicketRequirement[] | undefined = enabled
    ? query.data?.requirements
    : undefined;

  return useMemo(() => {
    // A kept-previous answer can still list products that already left the ticket.
    const onTicket = new Set(items.map(item => item.productId));
    const current = requirements?.filter(requirement => onTicket.has(requirement.productId));
    if (!current || current.length === 0) return EMPTY;
    const lines = new Map(
      current.map(requirement => [requirement.productId, pharmacyLineHint(requirement)])
    );
    const customerNote = pharmacyCustomerNote(current, customerId !== null);
    const hasControlled = current.some(requirement => requirement.classification === 'controlled');
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
