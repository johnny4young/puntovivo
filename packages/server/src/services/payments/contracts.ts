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

export interface PaymentRailAdapter {
  readonly railId: PaymentRailId;
  readonly capabilities: PaymentRailCapabilities;
  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
  getStatus(input: PaymentStatusInput): Promise<PaymentStatusResult>;
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
