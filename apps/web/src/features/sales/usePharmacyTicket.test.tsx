import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePharmacyTicket } from './usePharmacyTicket';

const zone = vi.hoisted(() => ({ on: true }));
vi.mock('@/features/modules/useRegisterZone', () => ({ useRegisterZone: () => zone.on }));

const queryState = { data: undefined as unknown };
const checkoutRequirementsUseQuery = vi.fn((..._args: unknown[]) => queryState);
vi.mock('@/lib/trpc', () => ({
  trpc: {
    pharmacy: {
      checkoutRequirements: {
        useQuery: (...args: unknown[]) => checkoutRequirementsUseQuery(...args),
      },
    },
  },
}));

const items = [
  { productId: 'amox', quantity: 1, unitEquivalence: 1 },
  { productId: 'clona', quantity: 2 },
  { productId: 'water', quantity: 1, unitEquivalence: 6 },
];

const requirement = (productId: string, overrides: Record<string, unknown>) => ({
  productId,
  productName: productId,
  policyVersion: 'co-v1',
  professionalApprovalRequired: true,
  classification: 'prescription',
  requestedQuantity: 1,
  evidenceRequired: true,
  customerRequired: true,
  blockedErrorCode: null,
  nextLot: null,
  eligibleEvidence: [],
  ...overrides,
});

beforeEach(() => {
  zone.on = true;
  queryState.data = undefined;
  checkoutRequirementsUseQuery.mockClear();
});

describe('usePharmacyTicket', () => {
  it('asks the checkout preflight for the ticket lines and its customer', () => {
    renderHook(() => usePharmacyTicket(items, 'customer-1', 'site-1'));
    expect(checkoutRequirementsUseQuery).toHaveBeenLastCalledWith(
      {
        customerId: 'customer-1',
        items: [
          { productId: 'amox', quantity: 1, unitEquivalence: 1 },
          { productId: 'clona', quantity: 2, unitEquivalence: 1 },
          { productId: 'water', quantity: 1, unitEquivalence: 6 },
        ],
      },
      expect.objectContaining({ enabled: true })
    );
  });

  it('stays off with the zone off, without a site or with an empty ticket', () => {
    zone.on = false;
    renderHook(() => usePharmacyTicket(items, null, 'site-1'));
    expect(checkoutRequirementsUseQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
    zone.on = true;
    renderHook(() => usePharmacyTicket(items, null, null));
    expect(checkoutRequirementsUseQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
    queryState.data = { requirements: [requirement('amox', {})] };
    const { result } = renderHook(() => usePharmacyTicket([], null, 'site-1'));
    expect(result.current.lines.size).toBe(0);
  });

  it('keeps the last answer through quantity edits but never across a customer change', () => {
    renderHook(() => usePharmacyTicket(items, 'customer-2', 'site-1'));
    const options = checkoutRequirementsUseQuery.mock.lastCall?.[1] as {
      placeholderData: (previous: unknown, previousQuery?: { queryKey: unknown[] }) => unknown;
    };
    const previous = { requirements: [] };
    const keyFor = (customerId: string | null) => [
      ['pharmacy', 'checkoutRequirements'],
      { input: { customerId, items: [] }, type: 'query' },
    ];
    expect(options.placeholderData(previous, { queryKey: keyFor('customer-2') })).toBe(previous);
    expect(options.placeholderData(previous, { queryKey: keyFor('customer-1') })).toBeUndefined();
    expect(options.placeholderData(previous, { queryKey: keyFor(null) })).toBeUndefined();
  });

  it('ignores requirements of products no longer on the ticket', () => {
    queryState.data = {
      requirements: [
        requirement('gone', {
          classification: 'controlled',
          blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
        }),
      ],
    };
    const { result } = renderHook(() => usePharmacyTicket(items, null, 'site-1'));
    expect(result.current.hasControlled).toBe(false);
    expect(result.current.hasNotices).toBe(false);
  });

  it('maps medicine lines, the customer card, controlled lines and the prescription count', () => {
    queryState.data = {
      requirements: [
        requirement('amox', { blockedErrorCode: 'PHARMACY_CUSTOMER_REQUIRED' }),
        requirement('clona', {
          classification: 'controlled',
          blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
        }),
      ],
    };
    const { result } = renderHook(() => usePharmacyTicket(items, null, 'site-1'));
    expect(result.current.lines.get('amox')?.status).toEqual({ kind: 'missing' });
    expect(result.current.lines.get('clona')?.status).toBeNull();
    expect(result.current.lines.has('water')).toBe(false);
    expect(result.current.customerNote).toEqual({ missing: true });
    expect(result.current.hasNotices).toBe(true);
    expect(result.current.hasControlled).toBe(true);
    expect(result.current.prescriptionLineCount).toBe(1);
  });
});
