/**
 * Payment rails manifest.
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

/**
 * slice 2 — per-rail credential descriptor.
 *
 * Declares the exact fields a rail needs from the operator before the
 * future worker slice can dispatch a real charge. The admin UI iterates
 * this list to render the form; the adapter's `validateConfig` iterates
 * the same list to compute readiness; the persistence layer iterates
 * it to enforce that no undeclared field sneaks into
 * `tenants.settings.payments.<railId>.credentials.*`.
 *
 * `sensitive: true` flags fields the UI must render as password inputs
 * and the response layer must mask (only last 3 characters visible). Every
 * sensitive key name listed here MUST be covered by the diagnostic
 * sanitizer's `SENSITIVE_KEYS` set in `services/diagnostics/sanitize.ts`
 * so the export bundle redacts it automatically (audited in the
 * companion sanitize test).
 */
export interface PaymentCredentialFieldDescriptor {
  readonly key: string;
  /** i18n key suffix; resolves under `operations.payments.settings.fields.<key>`. */
  readonly labelKey: string;
  readonly required: boolean;
  readonly sensitive: boolean;
}

export const CREDENTIAL_FIELDS_BY_RAIL: Record<
  PaymentRailId,
  readonly PaymentCredentialFieldDescriptor[]
> = {
  wompi: [
    { key: 'publicKey', labelKey: 'publicKey', required: true, sensitive: true },
    { key: 'privateKey', labelKey: 'privateKey', required: true, sensitive: true },
  ],
  bold: [
    { key: 'apiKey', labelKey: 'apiKey', required: true, sensitive: true },
    { key: 'secret', labelKey: 'secret', required: true, sensitive: true },
    { key: 'merchantId', labelKey: 'merchantId', required: true, sensitive: true },
  ],
  epayco: [
    { key: 'customerId', labelKey: 'customerId', required: true, sensitive: true },
    { key: 'publicKey', labelKey: 'publicKey', required: true, sensitive: true },
    { key: 'privateKey', labelKey: 'privateKey', required: true, sensitive: true },
    { key: 'pKey', labelKey: 'pKey', required: true, sensitive: true },
  ],
  mercado_pago: [{ key: 'accessToken', labelKey: 'accessToken', required: true, sensitive: true }],
  nequi: [
    { key: 'apiKey', labelKey: 'apiKey', required: true, sensitive: true },
    { key: 'merchantId', labelKey: 'merchantId', required: true, sensitive: true },
  ],
  daviplata: [
    { key: 'apiKey', labelKey: 'apiKey', required: true, sensitive: true },
    { key: 'merchantId', labelKey: 'merchantId', required: true, sensitive: true },
  ],
};
