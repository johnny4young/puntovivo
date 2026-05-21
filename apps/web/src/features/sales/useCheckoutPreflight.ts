/**
 * ENG-105b — Checkout preflight hook.
 *
 * Computes the list of blockers + warnings that would stop the cashier
 * from completing the current cart, BEFORE the F1/Cobrar press. The
 * hook is pure: it reads the same primitives `SalesPage` already feeds
 * `SalesCheckoutPanel` (cash session, cart items, customer with credit
 * info, user role, payment method draft) and returns a stable
 * `PreflightResult` via `useMemo`. Zero round-trip — every data point
 * is already in the renderer when this hook is called.
 *
 * Severity contract:
 * - `blocker` → disables the Cobrar button and short-circuits F1 with
 *   a toast pointing at the first item.
 * - `warning` → leaves Cobrar enabled but surfaces the concern (stock
 *   estimates can race a parallel cashier; the server will still throw
 *   `SALE_INSUFFICIENT_STOCK` if the race lands badly).
 *
 * The recovery wiring is owned by the caller: `SalesPage` passes the
 * callbacks (open cash session modal, focus customer picker, flip
 * payment method, remove cart row, focus discount field) and this
 * hook embeds them on the items so the `CheckoutPreflightPanel` can
 * render them without re-deriving context.
 *
 * Server-side blockers NOT modelled here:
 * - `CASH_SESSION_SITE_REQUIRED` — handled by site/setup redirects,
 *   not a per-checkout decision.
 * - `SALE_PRODUCT_INVALID` / `SALE_UNIT_INVALID` — bad seed data,
 *   should never reach the preflight in normal operation.
 * - `SALE_SERVICE_CHARGE_DRIFT` — race condition only surfaced at
 *   mutation time; the toast fallback stays.
 * - `SALE_AMOUNT_RECEIVED_BELOW_TOTAL` — payment-modal-only state,
 *   not visible from `SalesPage`.
 *
 * @module features/sales/useCheckoutPreflight
 */

import { useMemo } from 'react';
import type { SaleCartItem, SaleCartSummary } from './saleCart';
import type { CashSession } from '@/types';

export type PreflightBlockerId =
  | 'cash_session_required'
  | 'credit_sale_forbidden'
  | 'credit_sale_customer_required'
  | 'credit_limit_exceeded'
  | 'discount_exceeds_total'
  | 'insufficient_stock';

export type PreflightSeverity = 'blocker' | 'warning';

export interface PreflightRecoveryAction {
  labelKey: string;
  onClick: () => void;
}

export interface PreflightItem {
  id: PreflightBlockerId;
  severity: PreflightSeverity;
  /** i18n key under `sales:preflight.items.<id>.message`. */
  messageKey: string;
  /** Values interpolated into the message (e.g. projection numbers). */
  messageValues?: Record<string, string | number>;
  recoveryAction?: PreflightRecoveryAction;
}

export interface PreflightCustomerInput {
  id: string;
  /** Current outstanding balance in tenant currency. */
  currentBalance: number;
  /** Credit ceiling — `null` means no configured cap. */
  creditLimit: number | null;
}

export interface PreflightRecoveryWiring {
  onOpenCashSession?: () => void;
  onFocusCustomerPicker?: () => void;
  onFocusMethodPicker?: () => void;
  onFocusDiscountField?: () => void;
  onRemoveCartItem?: (itemKey: string) => void;
}

export interface PreflightInput {
  cartItems: SaleCartItem[];
  cartSummary: SaleCartSummary;
  cashSession: CashSession | null;
  /** `null` when the cashier has not picked a method yet. */
  paymentMethod: 'cash' | 'card' | 'transfer' | 'credit' | null;
  selectedCustomer: PreflightCustomerInput | null;
  /** Discount the cashier typed in the checkout modal draft, in absolute currency. */
  pendingDiscountAmount: number;
  /** Caller role from `useAuth().user.role`. */
  userRole: string;
  /** `true` when the workspace was hydrated from a resumed server draft. */
  isResumedDraft: boolean;
  recovery?: PreflightRecoveryWiring;
}

export interface PreflightResult {
  items: PreflightItem[];
  blockerCount: number;
  warningCount: number;
  /** `true` when no blocker would stop the F1 press. */
  isReady: boolean;
  /** The first blocker (used by the F1 toast). `null` when no blockers. */
  primaryBlocker: PreflightItem | null;
}

const MANAGER_OR_ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'manager']);

function computeItems(input: PreflightInput): PreflightItem[] {
  const items: PreflightItem[] = [];
  const {
    cartItems,
    cartSummary,
    cashSession,
    paymentMethod,
    selectedCustomer,
    pendingDiscountAmount,
    userRole,
    isResumedDraft,
    recovery,
  } = input;

  // Empty cart → nothing to preflight.
  if (cartItems.length === 0) {
    return items;
  }

  // 1. CASH_SESSION_REQUIRED — only applies to fresh carts. Resumed
  //    drafts can be charged via `sales.completeDraft` without a cash
  //    session (the server already booked them when the draft was
  //    created).
  if (!cashSession && !isResumedDraft) {
    items.push({
      id: 'cash_session_required',
      severity: 'blocker',
      messageKey: 'preflight.items.cash_session_required.message',
      recoveryAction: recovery?.onOpenCashSession
        ? {
            labelKey: 'preflight.items.cash_session_required.recovery',
            onClick: recovery.onOpenCashSession,
          }
        : undefined,
    });
  }

  // 2. CREDIT_SALE_FORBIDDEN — only manager/admin can register credit
  //    sales. Cashier sees the blocker with no recovery (must escalate).
  if (paymentMethod === 'credit' && !MANAGER_OR_ADMIN_ROLES.has(userRole)) {
    items.push({
      id: 'credit_sale_forbidden',
      severity: 'blocker',
      messageKey: 'preflight.items.credit_sale_forbidden.message',
    });
  }

  // 3. CREDIT_SALE_CUSTOMER_REQUIRED — credit method without a customer.
  if (paymentMethod === 'credit' && !selectedCustomer) {
    items.push({
      id: 'credit_sale_customer_required',
      severity: 'blocker',
      messageKey: 'preflight.items.credit_sale_customer_required.message',
      recoveryAction: recovery?.onFocusCustomerPicker
        ? {
            labelKey: 'preflight.items.credit_sale_customer_required.recovery',
            onClick: recovery.onFocusCustomerPicker,
          }
        : undefined,
    });
  }

  // 4. CREDIT_LIMIT_EXCEEDED — credit method + customer with creditLimit
  //    and (currentBalance + cartTotal) > creditLimit.
  if (paymentMethod === 'credit' && selectedCustomer && selectedCustomer.creditLimit !== null) {
    const projection = selectedCustomer.currentBalance + cartSummary.total;
    if (projection > selectedCustomer.creditLimit) {
      items.push({
        id: 'credit_limit_exceeded',
        severity: 'blocker',
        messageKey: 'preflight.items.credit_limit_exceeded.message',
        messageValues: {
          projection: projection.toFixed(0),
          limit: selectedCustomer.creditLimit.toFixed(0),
        },
        recoveryAction: recovery?.onFocusMethodPicker
          ? {
              labelKey: 'preflight.items.credit_limit_exceeded.recovery',
              onClick: recovery.onFocusMethodPicker,
            }
          : undefined,
      });
    }
  }

  // 5. DISCOUNT_EXCEEDS_TOTAL — pending discount > cart total.
  if (pendingDiscountAmount > 0 && pendingDiscountAmount > cartSummary.total) {
    items.push({
      id: 'discount_exceeds_total',
      severity: 'blocker',
      messageKey: 'preflight.items.discount_exceeds_total.message',
      messageValues: {
        discount: pendingDiscountAmount.toFixed(0),
        total: cartSummary.total.toFixed(0),
      },
      recoveryAction: recovery?.onFocusDiscountField
        ? {
            labelKey: 'preflight.items.discount_exceeds_total.recovery',
            onClick: recovery.onFocusDiscountField,
          }
        : undefined,
    });
  }

  // 6. INSUFFICIENT_STOCK — qty * unitEquivalence > availableStock for
  //    any item. WARNING, not blocker — the snapshot can race; the
  //    server will throw the hard error if the race lands badly.
  const stockShortItems = cartItems.filter(item => {
    const normalizedQuantity = item.quantity * item.unitEquivalence;
    return normalizedQuantity > item.availableStock;
  });
  if (stockShortItems.length > 0) {
    const firstShortItem = stockShortItems[0];
    const shortItemCount = stockShortItems.length;
    items.push({
      id: 'insufficient_stock',
      severity: 'warning',
      messageKey: 'preflight.items.insufficient_stock.message',
      messageValues: {
        product: firstShortItem.productName,
        count: shortItemCount,
        otherCount: shortItemCount - 1,
      },
      recoveryAction: recovery?.onRemoveCartItem
        ? {
            labelKey: 'preflight.items.insufficient_stock.recovery',
            onClick: () => recovery.onRemoveCartItem?.(firstShortItem.key),
          }
        : undefined,
    });
  }

  return items;
}

export function useCheckoutPreflight(input: PreflightInput): PreflightResult {
  // Deps spelled out so a fresh SalesPage render with the same data
  // does not recompute. `recovery` callbacks intentionally stay out of
  // the dep list — they re-bind every render in the parent but the
  // computed items embed only the IDs/severity/i18n keys plus closure
  // references that React forwards on click; recomputing on every
  // closure swap would defeat the memo without changing behaviour.
  return useMemo(() => {
    const items = computeItems(input);
    const blockers = items.filter(item => item.severity === 'blocker');
    const warnings = items.filter(item => item.severity === 'warning');
    return {
      items,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      isReady: blockers.length === 0,
      primaryBlocker: blockers[0] ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.cartItems,
    input.cartSummary.total,
    input.cashSession?.id,
    input.paymentMethod,
    input.selectedCustomer?.id,
    input.selectedCustomer?.currentBalance,
    input.selectedCustomer?.creditLimit,
    input.pendingDiscountAmount,
    input.userRole,
    input.isResumedDraft,
  ]);
}
