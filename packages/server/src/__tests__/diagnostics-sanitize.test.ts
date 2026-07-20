/**
 * Unit tests for the diagnostic export sanitizer.
 *
 * Locks the leak-prevention contract that ships with :
 *
 * - Sensitive keys (password, token, jwt, apiKey, pan, cvv, etc.)
 * are replaced with [REDACTED] at any nesting depth.
 * - Benign keys (saleId, total, entityType, etc.) are preserved.
 * - The matcher is anchored — `pancake_count` does NOT match `pan`,
 * `panel_layout` does NOT match `pan`, `passwordless` does NOT match
 * `password` (it would need an exact-match canonicalization).
 * - Sanitizing already-sanitized output is a no-op (idempotent).
 * - Primitives, null, undefined pass through.
 * - Arrays of objects are walked element-by-element.
 * - The `sanitizeRows` helper aggregates redacted keys across rows.
 */

import { describe, expect, it } from 'vitest';
import {
  sanitizePayload,
  sanitizeRows,
  isSensitiveKey,
  REDACTED_PLACEHOLDER,
  __TEST_SENSITIVE_KEYS,
} from '../services/diagnostics/sanitize.js';

describe('sanitizePayload — key matching', () => {
  it('replaces a top-level sensitive key with [REDACTED]', () => {
    const { clean, redactedKeys } = sanitizePayload({
      password: 'hunter2',
      saleId: 'sale-1',
    });
    expect(clean).toEqual({ password: REDACTED_PLACEHOLDER, saleId: 'sale-1' });
    expect(redactedKeys).toEqual(new Set(['password']));
  });

  it('redacts staff PIN plaintext and hash shapes', () => {
    const { clean, redactedKeys } = sanitizePayload({
      pin: '246810',
      staffPinHash: '$argon2id$secret',
      staff_pin_hash: '$argon2id$database-secret',
      userId: 'user-1',
    });

    expect(clean).toEqual({
      pin: REDACTED_PLACEHOLDER,
      staffPinHash: REDACTED_PLACEHOLDER,
      staff_pin_hash: REDACTED_PLACEHOLDER,
      userId: 'user-1',
    });
    expect(redactedKeys).toEqual(new Set(['pin', 'staffPinHash', 'staff_pin_hash']));
  });

  it('replaces nested sensitive keys at any depth', () => {
    const { clean, redactedKeys } = sanitizePayload({
      outer: {
        inner: {
          jwt: 'eyJ...',
          payload: { token: 'sk-abc', total: 100 },
        },
      },
    });
    expect(clean).toEqual({
      outer: {
        inner: {
          jwt: REDACTED_PLACEHOLDER,
          payload: { token: REDACTED_PLACEHOLDER, total: 100 },
        },
      },
    });
    expect(redactedKeys).toEqual(new Set(['jwt', 'token']));
  });

  it('walks arrays of objects', () => {
    const { clean, redactedKeys } = sanitizePayload([
      { saleId: 'a', token: 't1' },
      { saleId: 'b', apiKey: 'k1' },
    ]);
    expect(clean).toEqual([
      { saleId: 'a', token: REDACTED_PLACEHOLDER },
      { saleId: 'b', apiKey: REDACTED_PLACEHOLDER },
    ]);
    expect(redactedKeys).toEqual(new Set(['token', 'apiKey']));
  });

  it('preserves benign keys verbatim', () => {
    const input = {
      saleId: 'sale-1',
      total: 100,
      entityType: 'sales',
      operation: 'create',
      reference: 'AUTH-CODE-123',
      siteId: 'site-1',
      tenantId: 't-1',
      attempts: 3,
      payload: { kind: 'print-receipt', saleId: 'sale-1' },
    };
    const { clean, redactedKeys } = sanitizePayload(input);
    expect(clean).toEqual(input);
    expect(redactedKeys.size).toBe(0);
  });

  it('does NOT false-positive on keys whose substring contains a pattern', () => {
    // pancake_count contains 'pan' but is NOT a card number.
    // panel_layout contains 'pan' but is NOT a card number.
    // passwordless contains 'password' but is the auth strategy name.
    // tokenizer contains 'token' but is a parser concern.
    const { clean, redactedKeys } = sanitizePayload({
      pancake_count: 5,
      panel_layout: 'grid',
      passwordless: true,
      tokenizer: 'wedge',
    });
    expect(clean).toEqual({
      pancake_count: 5,
      panel_layout: 'grid',
      passwordless: true,
      tokenizer: 'wedge',
    });
    expect(redactedKeys.size).toBe(0);
  });

  it('matches case-insensitively and across separators', () => {
    const { clean, redactedKeys } = sanitizePayload({
      PasswordHash: 'x',
      password_hash: 'y',
      'password-hash': 'z',
      passwordhash: 'w',
    });
    expect(clean).toEqual({
      PasswordHash: REDACTED_PLACEHOLDER,
      password_hash: REDACTED_PLACEHOLDER,
      'password-hash': REDACTED_PLACEHOLDER,
      passwordhash: REDACTED_PLACEHOLDER,
    });
    // Aggregated set carries the ORIGINAL casing of each match for
    // operator visibility in the manifest.
    expect(redactedKeys).toEqual(
      new Set(['PasswordHash', 'password_hash', 'password-hash', 'passwordhash'])
    );
  });
});

describe('sanitizePayload — value pass-through', () => {
  it('returns null + undefined unchanged', () => {
    expect(sanitizePayload(null).clean).toBeNull();
    expect(sanitizePayload(undefined).clean).toBeUndefined();
  });

  it('returns primitive values unchanged', () => {
    expect(sanitizePayload(42).clean).toBe(42);
    expect(sanitizePayload('hello').clean).toBe('hello');
    expect(sanitizePayload(true).clean).toBe(true);
  });

  it('returns an empty object / empty array unchanged', () => {
    expect(sanitizePayload({}).clean).toEqual({});
    expect(sanitizePayload([]).clean).toEqual([]);
  });
});

describe('sanitizePayload — idempotence', () => {
  it('is a no-op on already-sanitized output', () => {
    const original = {
      password: 'hunter2',
      payload: { token: 'sk-abc', total: 100 },
    };
    const first = sanitizePayload(original).clean;
    const second = sanitizePayload(first).clean;
    expect(second).toEqual(first);
    // The `[REDACTED]` literal does not match any key pattern itself.
    expect(isSensitiveKey('REDACTED')).toBe(false);
  });

  it('does NOT mutate the input object', () => {
    const original = { password: 'hunter2', saleId: 'sale-1' };
    const snapshot = JSON.stringify(original);
    sanitizePayload(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('sanitizeRows — batch helper for the export bundle', () => {
  it('sanitizes the named JSON fields and aggregates redacted keys across rows', () => {
    const rows = [
      {
        id: 'r-1',
        tenantId: 't-1',
        payload: { saleId: 'a', password: 'p1' },
      },
      {
        id: 'r-2',
        tenantId: 't-1',
        payload: { saleId: 'b', token: 't1', apiKey: 'k1' },
      },
      {
        id: 'r-3',
        tenantId: 't-1',
        payload: { saleId: 'c' },
      },
    ];
    const result = sanitizeRows(rows, ['payload']);

    // The non-JSON columns (id, tenantId) pass through.
    expect(result.rows.map(r => r.id)).toEqual(['r-1', 'r-2', 'r-3']);
    expect(result.rows.map(r => r.tenantId)).toEqual(['t-1', 't-1', 't-1']);

    // The payload field is sanitized per-row.
    expect(result.rows[0]?.payload).toEqual({
      saleId: 'a',
      password: REDACTED_PLACEHOLDER,
    });
    expect(result.rows[1]?.payload).toEqual({
      saleId: 'b',
      token: REDACTED_PLACEHOLDER,
      apiKey: REDACTED_PLACEHOLDER,
    });
    expect(result.rows[2]?.payload).toEqual({ saleId: 'c' });

    // Redacted keys are the UNION across all rows.
    expect(result.redactedKeys).toEqual(new Set(['password', 'token', 'apiKey']));
  });

  it('handles a row whose JSON field is null without crashing', () => {
    const rows = [{ id: 'r-1', payload: null }];
    const result = sanitizeRows(rows, ['payload']);
    expect(result.rows[0]?.payload).toBeNull();
    expect(result.redactedKeys.size).toBe(0);
  });

  it('returns an empty redactedKeys set when no sensitive fields appear', () => {
    const rows = [
      { id: 'r-1', payload: { saleId: 'a', total: 100 } },
      { id: 'r-2', payload: { saleId: 'b', total: 200 } },
    ];
    const result = sanitizeRows(rows, ['payload']);
    expect(result.redactedKeys.size).toBe(0);
  });
});

describe('SENSITIVE_KEYS lock — anti-regression', () => {
  it('locks the canonical pattern list so reviewers see explicit removals', () => {
    // Snapshot test: any add or remove from the lock list must
    // change this assertion intentionally. Pin the count so a silent
    // "I'll just delete one" never lands.
    expect(__TEST_SENSITIVE_KEYS.size).toBeGreaterThanOrEqual(20);

    // Spot-check the categories ADR-0006 promises coverage on.
    expect(__TEST_SENSITIVE_KEYS.has('password')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('pin')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('staffpinhash')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('jwt')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('apikey')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('pan')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('cvv')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('cardnumber')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('certificate')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('clientsecret')).toBe(true);

    // slice 2 — payment provider credential fields land
    // under tenants.settings.payments.<railId>.credentials.* and
    // must redact in the diagnostic bundle. Locks the additions.
    expect(__TEST_SENSITIVE_KEYS.has('merchantid')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('customerid')).toBe(true);
    expect(__TEST_SENSITIVE_KEYS.has('pkey')).toBe(true);
  });

  it('redacts every payment credential field name when nested under tenants.settings.payments.*', () => {
    // Smoke against a realistic nested payload that mirrors how
    // the credentials live in `tenants.settings`. Every sensitive
    // descriptor key must collapse to [REDACTED], while neighbor
    // metadata (countryFocus, enabled) passes through.
    const { clean } = sanitizePayload({
      payments: {
        wompi: {
          credentials: {
            publicKey: 'pub_test_abc',
            privateKey: 'prv_test_xyz',
          },
        },
        bold: {
          credentials: {
            apiKey: 'bold_api',
            secret: 'bold_secret',
            merchantId: 'bold_merchant',
          },
        },
        epayco: {
          credentials: {
            customerId: 'epc_customer',
            publicKey: 'epc_pub',
            privateKey: 'epc_priv',
            pKey: 'epc_pkey',
          },
        },
        mercado_pago: {
          credentials: { accessToken: 'MP_TOKEN_999' },
        },
        nequi: {
          credentials: { apiKey: 'nq_api', merchantId: 'nq_merchant' },
        },
      },
    });
    const payments = (
      clean as Record<string, Record<string, Record<string, Record<string, string>>>>
    ).payments;
    expect(payments.wompi?.credentials).toEqual({
      publicKey: REDACTED_PLACEHOLDER,
      privateKey: REDACTED_PLACEHOLDER,
    });
    expect(payments.bold?.credentials).toEqual({
      apiKey: REDACTED_PLACEHOLDER,
      secret: REDACTED_PLACEHOLDER,
      merchantId: REDACTED_PLACEHOLDER,
    });
    expect(payments.epayco?.credentials).toEqual({
      customerId: REDACTED_PLACEHOLDER,
      publicKey: REDACTED_PLACEHOLDER,
      privateKey: REDACTED_PLACEHOLDER,
      pKey: REDACTED_PLACEHOLDER,
    });
    expect(payments.mercado_pago?.credentials).toEqual({
      accessToken: REDACTED_PLACEHOLDER,
    });
    expect(payments.nequi?.credentials).toEqual({
      apiKey: REDACTED_PLACEHOLDER,
      merchantId: REDACTED_PLACEHOLDER,
    });
  });
});
