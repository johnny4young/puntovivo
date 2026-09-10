/**
 * `auth.me` must not publish the tenant settings blob verbatim.
 *
 * The blob stores payment-processor credentials in cleartext under
 * `payments.<railId>.credentials.*` and `auth.me` is `protectedProcedure` —
 * any authenticated user, cashiers included. Returning it whole handed every
 * cashier the merchant's live Wompi / Bold / ePayco / Mercado Pago keys, which
 * are enough to charge and refund against the merchant account from outside
 * the POS.
 *
 * The projection is an allowlist keyed to the client contract. These tests pin
 * both halves of that: the client keeps everything it declares, and anything
 * else — including a secret nobody has invented yet — is dropped.
 *
 * @module __tests__/tenant-settings-projection.test
 */

import { describe, expect, it } from 'vitest';

import {
  CLIENT_TENANT_SETTING_KEYS,
  projectTenantSettingsForClient,
} from '../services/tenant-settings-projection.js';
import { CREDENTIAL_FIELDS_BY_RAIL } from '../services/payments/manifest.js';

/** A tenant blob shaped the way a configured merchant's actually looks. */
function realisticSettings() {
  return {
    taxRate: 19,
    businessType: 'pharmacy',
    restaurant: { serviceChargeRate: 0.1 },
    cashClose: { blindClose: false },
    discount: { expiryTiers: [{ maxDays: 7, pct: 30 }] },
    telemetryOptIn: true,
    setupAcknowledgedAt: '2026-01-01T00:00:00.000Z',
    fiscal: { cl: { rut: '76.543.210-K', environment: 'produccion' } },
    payments: {
      wompi: {
        credentials: {
          publicKey: 'pub_prod_NOT_A_SECRET',
          privateKey: 'prv_prod_LIVE_MERCHANT_KEY',
        },
      },
      bold: { credentials: { apiKey: 'bold_live_key', secret: 'bold_live_secret' } },
    },
  };
}

describe('tenant settings projection', () => {
  it('keeps every key the client contract declares', () => {
    const projected = projectTenantSettingsForClient(realisticSettings());
    expect(projected).toEqual({
      taxRate: 19,
      businessType: 'pharmacy',
      restaurant: { serviceChargeRate: 0.1 },
      cashClose: { blindClose: false },
      discount: { expiryTiers: [{ maxDays: 7, pct: 30 }] },
    });
  });

  it('drops every credential the payment manifests declare sensitive', () => {
    // Sourced from the manifest rather than hardcoded, so a rail added later
    // is covered by this test the day it lands.
    const sensitiveKeys = Object.values(CREDENTIAL_FIELDS_BY_RAIL).flatMap(fields =>
      fields.filter(field => field.sensitive).map(field => field.key)
    );
    expect(sensitiveKeys.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(projectTenantSettingsForClient(realisticSettings()));
    expect(serialized).not.toContain('payments');
    for (const key of sensitiveKeys) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain('LIVE_MERCHANT_KEY');
    expect(serialized).not.toContain('bold_live_secret');
  });

  it('drops a secret nobody has invented yet', () => {
    // The reason this leaked was that the projection stopped at the tenant row,
    // so any new key published itself. An allowlist has to fail the other way.
    const projected = projectTenantSettingsForClient({
      ...realisticSettings(),
      someFutureIntegration: { apiToken: 'tok_live_whatever' },
    });
    expect(JSON.stringify(projected)).not.toContain('tok_live_whatever');
    expect(Object.keys(projected).sort()).toEqual(
      ['businessType', 'cashClose', 'discount', 'restaurant', 'taxRate'].sort()
    );
  });

  it('drops a secret hidden inside a nested shape the client does declare', () => {
    // Passing `restaurant` through whole would reopen the hole one level down.
    const projected = projectTenantSettingsForClient({
      restaurant: { serviceChargeRate: 0.1, posProviderSecret: 'sk_live_nested' },
      cashClose: { blindClose: true, overrideToken: 'tok_nested' },
    });
    expect(projected).toEqual({
      restaurant: { serviceChargeRate: 0.1 },
      cashClose: { blindClose: true },
    });
  });

  it('leaves an absent setting absent rather than explicitly undefined', () => {
    // The client merges this over its defaults, so an explicit undefined would
    // erase a default instead of falling through to it.
    const projected = projectTenantSettingsForClient({ taxRate: 0 });
    expect(Object.hasOwn(projected, 'businessType')).toBe(false);
    expect(projected).toEqual({ taxRate: 0 });
  });

  it('survives a blob that is missing, null, or not an object', () => {
    for (const input of [undefined, null, 'nope', 42, []]) {
      expect(projectTenantSettingsForClient(input)).toEqual({});
    }
  });

  it('publishes nothing outside the declared key set', () => {
    // Guards the allowlist itself: a key added to the projection without being
    // added to CLIENT_TENANT_SETTING_KEYS would slip past the tests above.
    const everyKeyPresent = Object.fromEntries(CLIENT_TENANT_SETTING_KEYS.map(key => [key, {}]));
    const projected = projectTenantSettingsForClient({
      ...everyKeyPresent,
      taxRate: 1,
      businessType: 'retail',
      logo: 'data:image/png;base64,AAA',
      theme: 'dark',
      unexpected: 'leak',
    });
    for (const key of Object.keys(projected)) {
      expect(CLIENT_TENANT_SETTING_KEYS).toContain(
        key as (typeof CLIENT_TENANT_SETTING_KEYS)[number]
      );
    }
    expect(JSON.stringify(projected)).not.toContain('leak');
  });
});
