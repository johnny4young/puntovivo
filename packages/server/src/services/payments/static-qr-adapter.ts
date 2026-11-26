/**
 * The static-QR "rail" has no provider.
 *
 * `payment_outbox.rail_id` is NOT NULL, so presentations carry an identity
 * there. That identity must never behave like an integration: every charge
 * processor already filters `kind = 'charge'`, and this adapter is the second
 * layer of that guarantee — if any future code path reaches a provider through
 * `static_qr`, it fails loudly instead of fabricating an approval.
 *
 * @module services/payments/static-qr-adapter
 */
import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentRailAdapter,
  PaymentRailCapabilities,
  PaymentRefundInput,
  PaymentRefundResult,
  PaymentStatusInput,
  PaymentStatusResult,
} from './contracts.js';

const NO_PROVIDER = 'static_qr is not a payment provider: it is shown, never charged';

const CAPABILITIES: PaymentRailCapabilities = {
  methods: [],
  currencies: [],
  supportsRefund: false,
  supportsStatusPolling: false,
  requiresExternalCredentials: false,
};

export class StaticQrNotAProviderAdapter implements PaymentRailAdapter {
  readonly capabilities = CAPABILITIES;
  readonly railId = 'static_qr' as const;

  async charge(_input: PaymentChargeInput): Promise<PaymentChargeResult> {
    throw new Error(NO_PROVIDER);
  }

  async refund(_input: PaymentRefundInput): Promise<PaymentRefundResult> {
    throw new Error(NO_PROVIDER);
  }

  async getStatus(_input: PaymentStatusInput): Promise<PaymentStatusResult> {
    throw new Error(NO_PROVIDER);
  }
}
