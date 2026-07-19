/**
 * ENG-105b — Coverage for `useCheckoutPreflight`.
 *
 * One test per blocker / warning + happy path + empty cart + resumed
 * draft skip. The hook is pure (only depends on its input), so we
 * invoke it via `renderHook` and snapshot the result.
 *
 * @module features/sales/useCheckoutPreflight.test
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useCheckoutPreflight,
  type PreflightInput,
  type PreflightCustomerInput,
} from './useCheckoutPreflight';
import type { SaleCartItem, SaleCartSummary } from './saleCart';
import type { CashSession } from '@/types';

function buildCartItem(overrides?: Partial<SaleCartItem>): SaleCartItem {
  return {
    key: 'p1:u1',
    productId: 'p1',
    productName: 'Test Product',
    productSku: 'SKU-001',
    unitId: 'u1',
    unitName: 'unit',
    unitEquivalence: 1,
    quantity: 2,
    unitPrice: 100,
    discount: 0,
    taxRate: 0,
    availableStock: 50,
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    ...overrides,
  };
}

function buildCartSummary(overrides?: Partial<SaleCartSummary>): SaleCartSummary {
  return {
    itemCount: 2,
    subtotal: 200,
    taxAmount: 0,
    total: 200,
    ...overrides,
  };
}

function buildCashSession(overrides?: Partial<CashSession>): CashSession {
  return {
    id: 'cs-1',
    tenantId: 't-1',
    siteId: 's-1',
    cashierId: 'u-1',
    registerId: 'r-1',
    registerName: 'Caja 1',
    status: 'open',
    openedAt: new Date('2026-05-21T10:00:00Z').toISOString(),
    openedBy: 'u-1',
    closedAt: null,
    closedBy: null,
    openingFloat: 100000,
    expectedClosing: null,
    actualClosing: null,
    discrepancy: null,
    notes: null,
    ...overrides,
  } as CashSession;
}

function buildCustomer(overrides?: Partial<PreflightCustomerInput>): PreflightCustomerInput {
  return {
    id: 'cu-1',
    currentBalance: 0,
    creditLimit: null,
    ...overrides,
  };
}

function buildInput(overrides?: Partial<PreflightInput>): PreflightInput {
  return {
    cartItems: [buildCartItem()],
    cartSummary: buildCartSummary(),
    cashSession: buildCashSession(),
    paymentMethod: 'cash',
    selectedCustomer: null,
    pendingDiscountAmount: 0,
    isResumedDraft: false,
    recovery: undefined,
    ...overrides,
  };
}

describe('useCheckoutPreflight', () => {
  it('returns isReady=true and zero items on the happy path (cash session, cart, cash method)', () => {
    const { result } = renderHook(() => useCheckoutPreflight(buildInput()));
    expect(result.current.isReady).toBe(true);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.primaryBlocker).toBeNull();
  });

  it('returns isReady=true and zero items when the cart is empty (nothing to charge)', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cartItems: [],
          cartSummary: buildCartSummary({ itemCount: 0, subtotal: 0, total: 0 }),
          cashSession: null,
        })
      )
    );
    expect(result.current.isReady).toBe(true);
    expect(result.current.items).toHaveLength(0);
  });

  it('flags cash_session_required when the cart has items and no session is open', () => {
    const onOpenCashSession = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cashSession: null,
          recovery: { onOpenCashSession },
        })
      )
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.blockerCount).toBe(1);
    // `blockerCount === 1` above guarantees `items[0]`; `!` narrows for
    // `noUncheckedIndexedAccess`. reason: post-count-check invariant.
    expect(result.current.items[0]!.id).toBe('cash_session_required');
    expect(result.current.items[0]!.severity).toBe('blocker');
    expect(result.current.items[0]!.recoveryAction?.labelKey).toBe(
      'preflight.items.cash_session_required.recovery'
    );

    result.current.items[0]!.recoveryAction?.onClick();
    expect(onOpenCashSession).toHaveBeenCalledTimes(1);
  });

  it('skips cash_session_required when the workspace is a resumed draft', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cashSession: null,
          isResumedDraft: true,
        })
      )
    );
    expect(result.current.isReady).toBe(true);
    expect(result.current.items).toHaveLength(0);
  });

  it('flags credit_sale_customer_required when credit method has no customer', () => {
    const onFocusCustomerPicker = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          paymentMethod: 'credit',
          selectedCustomer: null,
          recovery: { onFocusCustomerPicker },
        })
      )
    );
    const item = result.current.items.find(i => i.id === 'credit_sale_customer_required');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('blocker');
    item?.recoveryAction?.onClick();
    expect(onFocusCustomerPicker).toHaveBeenCalledTimes(1);
  });

  it('flags credit_limit_exceeded when projection > creditLimit', () => {
    const onFocusMethodPicker = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          paymentMethod: 'credit',
          selectedCustomer: buildCustomer({
            currentBalance: 400000,
            creditLimit: 500000,
          }),
          cartSummary: buildCartSummary({ subtotal: 200000, total: 200000 }),
          recovery: { onFocusMethodPicker },
        })
      )
    );
    const item = result.current.items.find(i => i.id === 'credit_limit_exceeded');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('warning');
    expect(item?.messageValues?.projection).toBe('600000');
    expect(item?.messageValues?.limit).toBe('500000');
    item?.recoveryAction?.onClick();
    expect(onFocusMethodPicker).toHaveBeenCalledTimes(1);
  });

  it('does not flag credit_limit_exceeded when projection is within limit', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          paymentMethod: 'credit',
          selectedCustomer: buildCustomer({
            currentBalance: 100000,
            creditLimit: 500000,
          }),
          cartSummary: buildCartSummary({ subtotal: 200000, total: 200000 }),
        })
      )
    );
    expect(result.current.items.find(i => i.id === 'credit_limit_exceeded')).toBeUndefined();
  });

  it('does not flag credit_limit_exceeded when customer has no creditLimit cap', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          paymentMethod: 'credit',
          selectedCustomer: buildCustomer({
            currentBalance: 999999,
            creditLimit: null,
          }),
        })
      )
    );
    expect(result.current.items.find(i => i.id === 'credit_limit_exceeded')).toBeUndefined();
  });

  it('flags discount_exceeds_total when pending discount > total', () => {
    const onFocusDiscountField = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          pendingDiscountAmount: 1500,
          cartSummary: buildCartSummary({ subtotal: 1000, total: 1000 }),
          recovery: { onFocusDiscountField },
        })
      )
    );
    const item = result.current.items.find(i => i.id === 'discount_exceeds_total');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('blocker');
    expect(item?.messageValues?.discount).toBe('1500');
    expect(item?.messageValues?.total).toBe('1000');
    item?.recoveryAction?.onClick();
    expect(onFocusDiscountField).toHaveBeenCalledTimes(1);
  });

  it('does not flag discount_exceeds_total when no discount is pending', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(buildInput({ pendingDiscountAmount: 0 }))
    );
    expect(result.current.items.find(i => i.id === 'discount_exceeds_total')).toBeUndefined();
  });

  it('flags insufficient_stock as a WARNING (not a blocker) so Cobrar stays enabled', () => {
    const onRemoveCartItem = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cartItems: [
            buildCartItem({
              key: 'p1:u1',
              productName: 'Aceite 1L',
              quantity: 100,
              availableStock: 5,
              unitEquivalence: 1,
            }),
          ],
          recovery: { onRemoveCartItem },
        })
      )
    );
    const item = result.current.items.find(i => i.id === 'insufficient_stock');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('warning');
    expect(item?.messageValues?.product).toBe('Aceite 1L');
    expect(item?.messageValues?.count).toBe(1);
    expect(item?.messageValues?.otherCount).toBe(0);
    // Cobrar stays enabled — only blockers stop isReady.
    expect(result.current.isReady).toBe(true);
    expect(result.current.warningCount).toBe(1);

    item?.recoveryAction?.onClick();
    expect(onRemoveCartItem).toHaveBeenCalledWith('p1:u1');
  });

  it('sets the plural stock count separately from the other-item count', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cartItems: [
            buildCartItem({
              key: 'p1:u1',
              productName: 'Aceite 1L',
              quantity: 100,
              availableStock: 5,
            }),
            buildCartItem({
              key: 'p2:u1',
              productId: 'p2',
              productName: 'Arroz 1kg',
              quantity: 20,
              availableStock: 1,
            }),
          ],
        })
      )
    );

    const item = result.current.items.find(i => i.id === 'insufficient_stock');
    expect(item?.messageValues).toMatchObject({
      product: 'Aceite 1L',
      count: 2,
      otherCount: 1,
    });
  });

  it('stacks multiple items in order: blockers first, warnings after, and primaryBlocker is first blocker', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cashSession: null,
          paymentMethod: 'credit',
          cartItems: [buildCartItem({ quantity: 999, availableStock: 1 })],
          pendingDiscountAmount: 10_000,
          cartSummary: buildCartSummary({ total: 100 }),
        })
      )
    );
    // Expect: cash_session_required, customer required, discount excess, then
    // insufficient_stock (warning). Role escalation belongs to the modal.
    const ids = result.current.items.map(i => i.id);
    expect(ids).toContain('cash_session_required');
    expect(ids).toContain('discount_exceeds_total');
    expect(ids).toContain('insufficient_stock');
    expect(result.current.blockerCount).toBe(3);
    expect(result.current.warningCount).toBe(1);
    expect(result.current.isReady).toBe(false);
    expect(result.current.primaryBlocker?.id).toBe('cash_session_required');
  });

  it('merges server-derived checkout reminders as warnings without blocking Cobrar (ENG-184)', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          serverItems: [
            {
              id: 'fiscal_not_active',
              severity: 'warning',
              messageKey: 'preflight.items.fiscal_not_active.message',
            },
            {
              id: 'receipt_hardware_missing',
              severity: 'warning',
              messageKey: 'preflight.items.receipt_hardware_missing.message',
            },
          ],
        })
      )
    );
    const ids = result.current.items.map(i => i.id);
    expect(ids).toContain('fiscal_not_active');
    expect(ids).toContain('receipt_hardware_missing');
    // Server reminders are warnings — Cobrar stays enabled.
    expect(result.current.isReady).toBe(true);
    expect(result.current.warningCount).toBe(2);
  });

  it('ignores serverItems when the cart is empty (nothing to charge) (ENG-184)', () => {
    const { result } = renderHook(() =>
      useCheckoutPreflight(
        buildInput({
          cartItems: [],
          cartSummary: buildCartSummary({ itemCount: 0, subtotal: 0, total: 0 }),
          serverItems: [
            {
              id: 'fiscal_not_active',
              severity: 'warning',
              messageKey: 'preflight.items.fiscal_not_active.message',
            },
          ],
        })
      )
    );
    expect(result.current.items).toHaveLength(0);
  });

  it('memoizes the result across re-renders with identical inputs', () => {
    const input = buildInput();
    const { result, rerender } = renderHook(props => useCheckoutPreflight(props), {
      initialProps: input,
    });
    const first = result.current;
    rerender(input);
    expect(result.current).toBe(first);
  });
});
