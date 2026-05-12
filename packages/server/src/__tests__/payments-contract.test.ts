/**
 * ENG-038 — Payment rail contract tests.
 *
 * Pins the v1 manifest and deterministic adapters before real provider
 * credentials exist.
 */

import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_FIELDS_BY_RAIL,
  PAYMENT_RAIL_IDS,
  PAYMENT_RAILS_MANIFEST,
} from '../services/payments/manifest.js';
import {
  buildPaymentRailsContract,
  getPaymentRailAdapter,
  listPaymentRailAdapters,
} from '../services/payments/registry.js';

describe('payment rail manifest (ENG-038)', () => {
  it('exposes every required LATAM rail id', () => {
    const contract = buildPaymentRailsContract();
    expect(contract.version).toBe(1);
    expect([...contract.railIds].sort()).toEqual([...PAYMENT_RAIL_IDS].sort());
    expect(Object.keys(contract.rails).sort()).toEqual([...PAYMENT_RAIL_IDS].sort());
  });

  it('registers one adapter per manifest rail', () => {
    const adapters = listPaymentRailAdapters();
    expect(adapters.map(adapter => adapter.railId).sort()).toEqual([...PAYMENT_RAIL_IDS].sort());
  });
});

describe('deterministic payment rail adapters (ENG-038)', () => {
  it('approves the happy-path charge fixture', async () => {
    const adapter = getPaymentRailAdapter('wompi');
    const result = await adapter.charge({
      tenantId: 'tenant-1',
      amount: 120_000,
      currencyCode: 'COP',
      reference: 'SALE-100',
      salePaymentId: 'sale-payment-1',
    });

    expect(result.status).toBe('approved');
    if (result.status === 'approved') {
      expect(result.providerTransactionId).toMatch(/^wompi_/);
      expect(result.authCode).toHaveLength(8);
    }
  });

  it('normalizes decline and timeout fixtures for every rail', async () => {
    for (const railId of PAYMENT_RAIL_IDS) {
      const adapter = getPaymentRailAdapter(railId);
      await expect(
        adapter.charge({
          tenantId: 'tenant-1',
          amount: 50_000,
          currencyCode: 'COP',
          reference: `SALE-decline-${railId}`,
        })
      ).resolves.toMatchObject({ status: 'declined' });
      await expect(
        adapter.charge({
          tenantId: 'tenant-1',
          amount: 50_000,
          currencyCode: 'COP',
          reference: `SALE-timeout-${railId}`,
        })
      ).resolves.toMatchObject({ status: 'timeout', retryable: true });
    }
  });

  it('supports refund and status polling through the same adapter contract', async () => {
    const adapter = getPaymentRailAdapter('mercado_pago');
    await expect(
      adapter.refund({
        tenantId: 'tenant-1',
        providerTransactionId: 'mercado_pago_tx_123',
        amount: 25_000,
        currencyCode: 'COP',
        reason: 'customer return',
      })
    ).resolves.toMatchObject({ status: 'refunded' });

    await expect(
      adapter.getStatus({
        tenantId: 'tenant-1',
        providerTransactionId: 'mercado_pago_timeout_123',
      })
    ).resolves.toMatchObject({
      status: 'timeout',
      raw: { deterministic: true, railId: 'mercado_pago' },
    });
  });
});

describe('validateConfig (ENG-038 slice 2)', () => {
  it('declares credential field descriptors for every manifest rail', () => {
    for (const railId of PAYMENT_RAIL_IDS) {
      const descriptors = CREDENTIAL_FIELDS_BY_RAIL[railId];
      expect(descriptors).toBeDefined();
      expect(descriptors.length).toBeGreaterThan(0);
      // requiresExternalCredentials in the manifest stays consistent
      // with the descriptor: every rail that needs credentials has
      // at least one required field, and vice-versa.
      const requiresCreds =
        PAYMENT_RAILS_MANIFEST[railId].capabilities.requiresExternalCredentials;
      const hasRequired = descriptors.some(field => field.required);
      expect(hasRequired).toBe(requiresCreds);
    }
  });

  it('reports every required credential as missing when settings are empty', async () => {
    for (const railId of PAYMENT_RAIL_IDS) {
      const adapter = getPaymentRailAdapter(railId);
      expect(adapter.validateConfig).toBeDefined();
      const result = await adapter.validateConfig!({
        tenantId: 'tenant-1',
        settings: {},
      });
      expect(result.ok).toBe(false);
      const required = CREDENTIAL_FIELDS_BY_RAIL[railId].filter(
        field => field.required
      );
      expect(result.issues.length).toBe(required.length);
      for (const issue of result.issues) {
        expect(issue.code).toBe('PAYMENT_CREDENTIAL_MISSING');
      }
    }
  });

  it('flips to ok=true once every required credential has a non-empty value', async () => {
    const adapter = getPaymentRailAdapter('bold');
    const result = await adapter.validateConfig!({
      tenantId: 'tenant-1',
      settings: {
        payments: {
          bold: {
            credentials: {
              apiKey: 'k',
              secret: 's',
              merchantId: 'm',
            },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('treats whitespace and empty string as missing', async () => {
    const adapter = getPaymentRailAdapter('mercado_pago');
    const emptyResult = await adapter.validateConfig!({
      tenantId: 'tenant-1',
      settings: {
        payments: { mercado_pago: { credentials: { accessToken: '' } } },
      },
    });
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.issues[0]?.field).toBe('accessToken');

    // A pre-existing settings blob with a whitespace-only value
    // (e.g. paste-from-clipboard with stray spaces) must surface
    // the same missing-field signal so the operator can fix it.
    const whitespaceResult = await adapter.validateConfig!({
      tenantId: 'tenant-1',
      settings: {
        payments: { mercado_pago: { credentials: { accessToken: '   ' } } },
      },
    });
    expect(whitespaceResult.ok).toBe(false);
    expect(whitespaceResult.issues[0]?.field).toBe('accessToken');
  });
});
