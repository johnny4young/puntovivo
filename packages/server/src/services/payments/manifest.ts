/**
 * ENG-038 — Payment rails manifest.
 *
 * Single source of truth for rail ids, labels and deterministic v1
 * capabilities. Real credentials remain out of scope for this slice;
 * `liveIntegration=false` tells the UI and docs this is a contract
 * foundation, not a production processor hookup.
 *
 * @module services/payments/manifest
 */

import type { PaymentRailId } from '../../db/schema.js';
import type { PaymentRailCapabilities } from './contracts.js';

export const PAYMENT_RAILS_VERSION = 1;

export const PAYMENT_RAIL_IDS = [
  'wompi',
  'bold',
  'epayco',
  'mercado_pago',
  'nequi',
  'daviplata',
] as const satisfies readonly PaymentRailId[];

export interface PaymentRailManifestEntry {
  railId: PaymentRailId;
  label: string;
  countryFocus: readonly string[];
  liveIntegration: boolean;
  capabilities: PaymentRailCapabilities;
}

export const PAYMENT_RAILS_MANIFEST = {
  wompi: {
    railId: 'wompi',
    label: 'Wompi',
    countryFocus: ['CO'],
    liveIntegration: false,
    capabilities: {
      methods: ['card', 'bank_transfer', 'wallet', 'cash_reference', 'qr'],
      currencies: ['COP'],
      supportsRefund: true,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
  bold: {
    railId: 'bold',
    label: 'Bold',
    countryFocus: ['CO'],
    liveIntegration: false,
    capabilities: {
      methods: ['terminal_card'],
      currencies: ['COP'],
      supportsRefund: true,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
  epayco: {
    railId: 'epayco',
    label: 'ePayco',
    countryFocus: ['CO'],
    liveIntegration: false,
    capabilities: {
      methods: ['card', 'bank_transfer', 'wallet', 'cash_reference'],
      currencies: ['COP', 'USD'],
      supportsRefund: true,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
  mercado_pago: {
    railId: 'mercado_pago',
    label: 'Mercado Pago',
    countryFocus: ['AR', 'BR', 'CL', 'CO', 'MX', 'PE', 'UY'],
    liveIntegration: false,
    capabilities: {
      methods: ['card', 'wallet', 'terminal_card', 'qr'],
      currencies: ['ARS', 'BRL', 'CLP', 'COP', 'MXN', 'PEN', 'UYU'],
      supportsRefund: true,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
  nequi: {
    railId: 'nequi',
    label: 'Nequi',
    countryFocus: ['CO'],
    liveIntegration: false,
    capabilities: {
      methods: ['wallet', 'qr'],
      currencies: ['COP'],
      supportsRefund: false,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
  daviplata: {
    railId: 'daviplata',
    label: 'Daviplata',
    countryFocus: ['CO'],
    liveIntegration: false,
    capabilities: {
      methods: ['wallet'],
      currencies: ['COP'],
      supportsRefund: false,
      supportsStatusPolling: true,
      requiresExternalCredentials: true,
    },
  },
} as const satisfies Record<PaymentRailId, PaymentRailManifestEntry>;

export interface PaymentRailsContract {
  version: number;
  railIds: readonly PaymentRailId[];
  rails: Record<PaymentRailId, PaymentRailManifestEntry>;
}

export function buildPaymentRailsContract(): PaymentRailsContract {
  return {
    version: PAYMENT_RAILS_VERSION,
    railIds: PAYMENT_RAIL_IDS,
    rails: PAYMENT_RAILS_MANIFEST,
  };
}

export function isPaymentRailId(value: string): value is PaymentRailId {
  return (PAYMENT_RAIL_IDS as readonly string[]).includes(value);
}
