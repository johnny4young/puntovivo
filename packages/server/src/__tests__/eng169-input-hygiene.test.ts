/**
 * input boundary hygiene (audit-closure W5).
 *
 * Covers three of the four bullets (the fourth, the backup-ZIP
 * allowlist, lives in the desktop suite `backup-restore.test.ts`):
 *
 * - Image-URL schemas reject dangerous URL schemes at the boundary
 * (companies.logoUrl, products.imageUrl) while keeping https +
 * data:image + relative paths valid.
 * - Contact-email fields on companies / customers / providers
 * normalise (trim + lowercase) like users/auth already do.
 * - createServer refuses to boot with verbose logging under
 * NODE_ENV=production unless PUNTOVIVO_ALLOW_VERBOSE_PROD=1.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';
import { upsertCompanyInput } from '../trpc/schemas/companies.js';
import { updateProductInput } from '../trpc/schemas/products.js';
import { updateCustomerInput } from '../trpc/schemas/customers.js';
import { updateProviderInput } from '../trpc/schemas/providers.js';

describe('image-URL scheme hardening', () => {
  it('rejects dangerous schemes on company logoUrl, allows https + data:image', () => {
    expect(() =>
      upsertCompanyInput.parse({ name: 'Acme', logoUrl: 'javascript:alert(1)' })
    ).toThrow();
    expect(() =>
      upsertCompanyInput.parse({ name: 'Acme', logoUrl: 'data:text/html,<script>' })
    ).toThrow();
    expect(
      upsertCompanyInput.parse({ name: 'Acme', logoUrl: 'https://cdn.example.com/logo.png' })
        .logoUrl
    ).toBe('https://cdn.example.com/logo.png');
    expect(
      upsertCompanyInput.parse({
        name: 'Acme',
        logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }).logoUrl
    ).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(upsertCompanyInput.parse({ name: 'Acme', logoUrl: null }).logoUrl).toBeNull();
  });

  it('rejects dangerous schemes on product imageUrl but keeps relative + data:image', () => {
    const base = { id: 'p-1', version: 0 } as const;
    expect(() => updateProductInput.parse({ ...base, imageUrl: 'javascript:alert(1)' })).toThrow();
    // Refine-only (no .url()): a relative path the field already accepted
    // stays valid, and data:image is allowed.
    expect(updateProductInput.parse({ ...base, imageUrl: '/uploads/p-1.png' }).imageUrl).toBe(
      '/uploads/p-1.png'
    );
    expect(
      updateProductInput.parse({ ...base, imageUrl: 'data:image/png;base64,AAAA' }).imageUrl
    ).toBe('data:image/png;base64,AAAA');
    expect(updateProductInput.parse({ ...base, imageUrl: null }).imageUrl).toBeNull();
  });
});

describe('contact-email normalisation', () => {
  const DIRTY = '  Mixed.Case@EXAMPLE.COM  ';
  const CLEAN = 'mixed.case@example.com';

  it('trims + lowercases company email', () => {
    expect(upsertCompanyInput.parse({ name: 'Acme', email: DIRTY }).email).toBe(CLEAN);
  });
  it('trims + lowercases customer email', () => {
    expect(updateCustomerInput.parse({ id: 'c-1', version: 0, email: DIRTY }).email).toBe(CLEAN);
  });
  it('trims + lowercases provider email', () => {
    expect(updateProviderInput.parse({ id: 'pr-1', version: 0, email: DIRTY }).email).toBe(CLEAN);
  });
  it('still rejects a malformed email and preserves null', () => {
    expect(() => upsertCompanyInput.parse({ name: 'Acme', email: 'not-an-email' })).toThrow();
    expect(upsertCompanyInput.parse({ name: 'Acme', email: null }).email).toBeNull();
  });
});

describe('verbose+prod boot guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOverride = process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD;

  afterEach(() => {
    // Restore the process-global env regardless of how the test exited.
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD;
    else process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD = originalOverride;
  });

  it('refuses to boot with verbose logging in production without the override', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD;
    await expect(createServer({ dbPath: ':memory:', verbose: true })).rejects.toThrow(
      /verbose logging is enabled/i
    );
  });

  it('boots in production with verbose logging when the override is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD = '1';
    const server = await createServer({ dbPath: ':memory:', verbose: true });
    try {
      expect(server).toBeDefined();
    } finally {
      await server.close();
    }
  });
});
