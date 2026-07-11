/**
 * Type contract for the sale payment modal.
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `SalePaymentModal.tsx` (1048 LOC) during the megafile decomposition. The
 * shell re-exports `SaleTipMethod` / `SalePaymentTenderValue` /
 * `SalePaymentValues` so the sibling importers (SalesModals, SalesPage,
 * checkoutPayment) resolve the same names at the same path.
 *
 * @module features/sales/salePaymentModal.types
 */
import type { Customer, PaymentMethod } from '@/types';

// ENG-014 — split-tender method now mirrors PaymentMethod so a sale
// can mix instant tenders with a credit portion ("apartado"). The
// modal still gates the credit option behind canLendCredit + an
// attached customer; the server enforces the same gate at the router
// and rejects credit tenders without a customerId via Zod refine.
export type SplitTenderMethod = PaymentMethod;

// ENG-039d — propina tip method. `null` (the default) means the
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
   * ENG-039d — tip / propina captured at checkout. `tipAmount` rolls
   * into the persisted total server-side, so split-tender Σ and
   * single-tender `amountReceived` are compared against `total + tip`.
   * `tipMethod` is informational (`percentage` if the operator clicked
   * a preset, `fixed` if they typed a custom amount, `null` when the
   * tip is zero).
   */
  tipAmount: number;
  tipMethod: SaleTipMethod | null;
  /**
   * ENG-090 — admin override for the credit-limit invariant. Only
   * surfaces in the UI when an admin opens the modal and the
   * projected balance exceeds the customer's `creditLimit`. The
   * server still enforces the admin role on the `creditOverride`
   * flag at the router gate.
   */
  creditOverride: boolean;
  /**
   * ENG-039d3 — restaurant service charge / propina sugerida. Auto
   * applied from the tenant's `serviceChargeRate` (a per-tenant
   * percentage). `serviceChargeAmount` rolls into the persisted total
   * after tip so split-tender Σ + single-tender `amountReceived`
   * compare against `total + tip + service`. `serviceChargeRate` is
   * the percentage active at submit time (null when disabled).
   */
  serviceChargeAmount: number;
  serviceChargeRate: number | null;
}

export interface SalePaymentModalProps {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  error: string | null;
  /**
   * ENG-039d3 — tenant-configured service charge percentage (0–30). The
   * modal hides the entire service section when this is 0; when > 0 it
   * auto-applies `total × rate / 100` as a read-only line and folds it
   * into the grand total. Defaults to 0 so non-restaurant tenants pay
   * zero contract cost.
   */
  serviceChargeRate?: number | undefined;
  /**
   * ENG-090 — caller's role drives credit-method gating. Cashier never
   * sees the credit tile; manager + admin do. Admin additionally sees
   * the override checkbox when the projected balance exceeds the
   * customer's cupo. Undefined or any other role hides credit
   * entirely. The server still enforces the gate on
   * `creditOverride: true`.
   */
  userRole?: 'admin' | 'manager' | 'cashier' | 'viewer' | undefined;
  /**
   * ENG-105e — observable counter that triggers the fast-cash flow
   * while opening the modal or while it is already open. The parent
   * increments this on every F2 press; `0` means normal F1 open.
   * The modal re-applies the exact amount + Confirm focus on each
   * change, and captures the mount-time baseline so it never
   * double-fires on the initial render.
   */
  fastCashTrigger?: number | undefined;
  /**
   * ENG-105h — explicit cashier-flow focus target. The payment drawer
   * restores focus here after cancel, Escape, backdrop close, or a
   * successful checkout instead of relying on whichever opener happened
   * to be active.
   */
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
  onClose: () => void;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}
