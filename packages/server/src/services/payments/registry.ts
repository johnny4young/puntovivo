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
import type { PaymentRailAdapter } from './contracts.js';
import { DeterministicPaymentRailAdapter } from './mock-adapter.js';
import { PAYMENT_RAIL_IDS, PAYMENT_RAILS_MANIFEST, buildPaymentRailsContract } from './manifest.js';

const ADAPTERS: Record<PaymentRailId, PaymentRailAdapter> = {
  wompi: new DeterministicPaymentRailAdapter('wompi'),
  bold: new DeterministicPaymentRailAdapter('bold'),
  epayco: new DeterministicPaymentRailAdapter('epayco'),
  mercado_pago: new DeterministicPaymentRailAdapter('mercado_pago'),
  nequi: new DeterministicPaymentRailAdapter('nequi'),
  daviplata: new DeterministicPaymentRailAdapter('daviplata'),
};

export function getPaymentRailAdapter(railId: PaymentRailId): PaymentRailAdapter {
  return ADAPTERS[railId];
}

export function listPaymentRailAdapters(): PaymentRailAdapter[] {
  return PAYMENT_RAIL_IDS.map(railId => ADAPTERS[railId]);
}

export { PAYMENT_RAILS_MANIFEST, buildPaymentRailsContract };
