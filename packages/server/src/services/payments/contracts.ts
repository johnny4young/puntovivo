/**
 * ENG-038 — Payment rail adapter contract.
 *
 * Rails model software payment providers and semi-integrated terminal
 * providers without storing raw card data. v1 ships deterministic
 * adapters so the POS can test reconciliation and outbox plumbing
 * before real credentials are available.
 *
 * @module services/payments/contracts
 */

import type { PaymentRailId } from '../../db/schema.js';

export type PaymentRailMethod =
  | 'card'
  | 'bank_transfer'
  | 'wallet'
  | 'cash_reference'
  | 'terminal_card'
  | 'qr';

export interface PaymentRailCapabilities {
  readonly methods: readonly PaymentRailMethod[];
  readonly currencies: readonly string[];
  readonly supportsRefund: boolean;
  readonly supportsStatusPolling: boolean;
  readonly requiresExternalCredentials: boolean;
}

export interface PaymentChargeInput {
  tenantId: string;
  amount: number;
  currencyCode: string;
  reference: string;
  salePaymentId?: string | null;
  metadata?: Record<string, unknown>;
}

export type PaymentChargeResult =
  | {
      status: 'approved';
      providerTransactionId: string;
      authCode: string;
      reference: string;
    }
  | {
      status: 'declined';
      providerTransactionId: string;
      reason: string;
    }
  | {
      status: 'pending';
      providerTransactionId: string;
      reference: string;
    }
  | {
      status: 'timeout';
      providerTransactionId: string;
      retryable: true;
    };

export interface PaymentRefundInput {
  tenantId: string;
  providerTransactionId: string;
  amount: number;
  currencyCode: string;
  reason?: string | null;
}

export type PaymentRefundResult =
  | { status: 'refunded'; providerTransactionId: string; refundId: string }
  | { status: 'declined'; providerTransactionId: string; reason: string }
  | { status: 'timeout'; providerTransactionId: string; retryable: true };

export interface PaymentStatusInput {
  tenantId: string;
  providerTransactionId: string;
}

export type PaymentStatusResult = {
  status: 'approved' | 'declined' | 'pending' | 'timeout' | 'refunded' | 'settled' | 'unknown';
  providerTransactionId: string;
  raw?: Record<string, unknown>;
};

/**
 * ENG-038 slice 2 — readiness probe for a payment rail.
 *
 * Adapters declare which credential fields the rail needs and expose
 * `validateConfig` so the admin UI can render a readiness badge before
 * any real charge is attempted. Returning `ok:true` does NOT promise
 * the provider will accept the credentials at runtime — it only
 * confirms the operator entered every required field with a non-empty
 * value. Deeper validation (RFC-style algorithmic checks, sandbox
 * ping) lands per-rail as real workers come online.
 */
export interface PaymentRailValidationIssue {
  /** Stable identifier suitable for i18n key lookup. */
  readonly code: string;
  /** Human-readable English fallback. */
  readonly message: string;
  /** Optional reference to the credential field that triggered the issue. */
  readonly field?: string;
}

export interface PaymentRailValidationResult {
  readonly ok: boolean;
  readonly issues: readonly PaymentRailValidationIssue[];
}

export interface PaymentRailValidationContext {
  readonly tenantId: string;
  /** Full `tenants.settings` blob; the adapter reads its own rail branch. */
  readonly settings: Record<string, unknown> | null | undefined;
}

export interface PaymentRailAdapter {
  readonly railId: PaymentRailId;
  readonly capabilities: PaymentRailCapabilities;
  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
  getStatus(input: PaymentStatusInput): Promise<PaymentStatusResult>;
  /**
   * Optional readiness probe. When omitted the registry treats the rail
   * as ready by default — keeping the contract additive for any future
   * adapter that doesn't need credentials (e.g. a cash-only rail).
   */
  validateConfig?(
    ctx: PaymentRailValidationContext
  ): Promise<PaymentRailValidationResult> | PaymentRailValidationResult;
}

export interface NormalizedPaymentError {
  kind:
    | 'PROVIDER_DECLINED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'INVALID_CONFIG'
    | 'MALFORMED_REQUEST'
    | 'UNKNOWN';
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown> | null;
}
