/**
 * Type contract for the sale payment modal.
 *
 * extracted verbatim from the former single-file
 * `SalePaymentModal.tsx` (1048 LOC) during the megafile decomposition. The
 * shell re-exports `SaleTipMethod` / `SalePaymentTenderValue` /
 * `SalePaymentValues` so the sibling importers (SalesModals, SalesPage,
 * checkoutPayment) resolve the same names at the same path.
 *
 * @module features/sales/salePaymentModal.types
 */
import type { Customer, PaymentMethod } from '@/types';
import type {
  CheckoutApprovalAction,
  CheckoutApprovalItem,
} from '@puntovivo/shared/checkout-approval';

// split-tender method now mirrors PaymentMethod so a sale
// can mix instant tenders with a credit portion ("apartado"). The
// modal still gates the credit option behind canLendCredit + an
// attached customer; the server enforces the same gate at the router
// and rejects credit tenders without a customerId via Zod refine.
export type SplitTenderMethod = PaymentMethod;

// propina tip method. `null` (the default) means the
// operator did not capture a tip; the server interprets that the same
// as `tipAmount: 0`.
export type SaleTipMethod = 'percentage' | 'fixed';

export interface SalePaymentTenderValue {
  method: SplitTenderMethod;
  amount: number;
  reference: string;
}

export interface SalePaymentValues {
  customerId: string;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  notes: string;
  /**
   * Optional multi-tender breakdown. When non-empty, the server ignores
   * `paymentMethod` + `amountReceived` for persistence and uses this list.
   */
  tenders: SalePaymentTenderValue[];
  /**
   * tip / propina captured at checkout. `tipAmount` rolls
   * into the persisted total server-side, so split-tender Σ and
   * single-tender `amountReceived` are compared against `total + tip`.
   * `tipMethod` is informational (`percentage` if the operator clicked
   * a preset, `fixed` if they typed a custom amount, `null` when the
   * tip is zero).
   */
  tipAmount: number;
  tipMethod: SaleTipMethod | null;
  /**
   * /  — credit-limit override. Admins opt in
   * directly; cashiers and managers can only submit true with a matching,
   * payload-bound admin approval that the server consumes atomically.
   */
  creditOverride: boolean;
  /**
   * restaurant service charge / propina sugerida. Auto
   * applied from the tenant's `serviceChargeRate` (a per-tenant
   * percentage). `serviceChargeAmount` rolls into the persisted total
   * after tip so split-tender Σ + single-tender `amountReceived`
   * compare against `total + tip + service`. `serviceChargeRate` is
   * the percentage active at submit time (null when disabled).
   */
  serviceChargeAmount: number;
  serviceChargeRate: number | null;
  /** One approved, payload-bound request per sensitive checkout action. */
  approvalRequests?:
    | Array<{
        action: CheckoutApprovalAction;
        requestId: string;
      }>
    | undefined;
}

export interface SalePaymentModalProps {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  error: string | null;
  /**
   * tenant-configured service charge percentage (0–30). The
   * modal hides the entire service section when this is 0; when > 0 it
   * auto-applies `total × rate / 100` as a read-only line and folds it
   * into the grand total. Defaults to 0 so non-restaurant tenants pay
   * zero contract cost.
   */
  serviceChargeRate?: number | undefined;
  /**
   * /  — caller's role drives credit-method gating.
   * Cashiers, managers, and admins can select credit with a customer;
   * cashiers request manager approval and non-admin cupo overrides request
   * admin approval. Viewers and unknown roles cannot select credit.
   */
  userRole?: 'admin' | 'manager' | 'cashier' | 'viewer' | undefined;
  /** immutable financial inputs used to bind one-time grants. */
  approvalSaleId?: string | null | undefined;
  approvalCustomerId?: string | null | undefined;
  approvalItems?: CheckoutApprovalItem[] | undefined;
  approvalDiscountAmount?: number | undefined;
  currencyCode?: string | undefined;
  /**
   * observable counter that triggers the fast-cash flow
   * while opening the modal or while it is already open. The parent
   * increments this on every F2 press; `0` means normal F1 open.
   * The modal re-applies the exact amount + Confirm focus on each
   * change, and captures the mount-time baseline so it never
   * double-fires on the initial render.
   */
  fastCashTrigger?: number | undefined;
  /**
   * explicit cashier-flow focus target. The payment drawer
   * restores focus here after cancel, Escape, backdrop close, or a
   * successful checkout instead of relying on whichever opener happened
   * to be active.
   */
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
  onClose: () => void;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}
