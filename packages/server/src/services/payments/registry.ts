/**
 * Payment rail registry.
 *
 * Strategy/Factory entry point for payment rails. v1 returns
 * deterministic adapters for every manifest rail; real providers swap
 * into this table when credentials and contracts are ready.
 *
 * @module services/payments/registry
 */

import type { PaymentRailId } from '../../db/schema.js';
import type {
  PaymentRailAdapter,
  PaymentRailValidationContext,
  PaymentRailValidationResult,
} from './contracts.js';
import { DeterministicPaymentRailAdapter } from './mock-adapter.js';
import { StaticQrNotAProviderAdapter } from './static-qr-adapter.js';
import { PAYMENT_RAIL_IDS, PAYMENT_RAILS_MANIFEST, buildPaymentRailsContract } from './manifest.js';

const ADAPTERS: Record<PaymentRailId, PaymentRailAdapter> = {
  wompi: new DeterministicPaymentRailAdapter('wompi'),
  bold: new DeterministicPaymentRailAdapter('bold'),
  epayco: new DeterministicPaymentRailAdapter('epayco'),
  mercado_pago: new DeterministicPaymentRailAdapter('mercado_pago'),
  nequi: new DeterministicPaymentRailAdapter('nequi'),
  daviplata: new DeterministicPaymentRailAdapter('daviplata'),
  // A presentation is shown, never charged. Any attempt to reach a provider
  // through this identity fails loudly instead of pretending to succeed.
  static_qr: new StaticQrNotAProviderAdapter(),
};

const overrides = new Map<PaymentRailId, PaymentRailAdapter>();

export function getPaymentRailAdapter(railId: PaymentRailId): PaymentRailAdapter {
  return overrides.get(railId) ?? ADAPTERS[railId];
}

export function isPaymentRailLive(railId: PaymentRailId): boolean {
  return (
    getPaymentRailAdapter(railId).liveIntegration ?? PAYMENT_RAILS_MANIFEST[railId].liveIntegration
  );
}

/** Readiness of one rail; a rail that needs credentials but cannot check them is not ready. */
export async function validatePaymentRail(
  railId: PaymentRailId,
  ctx: PaymentRailValidationContext
): Promise<PaymentRailValidationResult> {
  const adapter = getPaymentRailAdapter(railId);
  if (adapter.validateConfig) return adapter.validateConfig(ctx);
  if (!adapter.capabilities.requiresExternalCredentials) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: [
      {
        code: 'PAYMENT_CREDENTIAL_MISSING',
        message: `Rail ${railId} cannot check its credentials`,
      },
    ],
  };
}

/** Swap one rail for a fake provider in tests. Returns the restore function. */
export function __overridePaymentRailForTests(
  railId: PaymentRailId,
  adapter: PaymentRailAdapter
): () => void {
  overrides.set(railId, adapter);
  return () => overrides.delete(railId);
}

export function listPaymentRailAdapters(): PaymentRailAdapter[] {
  return PAYMENT_RAIL_IDS.map(getPaymentRailAdapter);
}

export { PAYMENT_RAILS_MANIFEST, buildPaymentRailsContract };
