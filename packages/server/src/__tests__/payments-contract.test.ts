/**
 * ENG-038 — Payment rail contract tests.
 *
 * Pins the v1 manifest and deterministic adapters before real provider
 * credentials exist.
 */

import { describe, expect, it } from 'vitest';
import { PAYMENT_RAIL_IDS } from '../services/payments/manifest.js';
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
