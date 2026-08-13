import { describe, expect, it } from 'vitest';

import { buildProductFtsQuery, productSearchTenantScope } from './fts-search.js';

describe('product FTS query boundary', () => {
  it('encodes tenant ids as one stable tokenizer token', () => {
    expect(productSearchTenantScope('tenant-1')).toBe('t74656e616e742d31');
    expect(productSearchTenantScope('tienda/ñ')).toMatch(/^t[0-9a-f]+$/);
  });

  it('quotes bounded Unicode tokens so input cannot inject FTS operators', () => {
    expect(buildProductFtsQuery('tenant-1', '  Café " OR (milk)* - NEAR  ')).toBe(
      'tenant_scope:"t74656e616e742d31" AND {name sku barcode description}:("Café"* AND "OR"* AND "milk"* AND "NEAR"*)'
    );
    expect(buildProductFtsQuery('tenant-1', '--- *** ()')).toBeNull();
    expect(buildProductFtsQuery('tenant-1', '')).toBeNull();
  });

  it('supports a sanitized OR shortlist without changing the literal AND default', () => {
    expect(buildProductFtsQuery('tenant-1', 'vino reserva', 'OR')).toBe(
      'tenant_scope:"t74656e616e742d31" AND {name sku barcode description}:("vino"* OR "reserva"*)'
    );
    expect(buildProductFtsQuery('tenant-1', 'vino reserva')).toContain('("vino"* AND "reserva"*)');
  });

  it('bounds token count and truncates by Unicode code point', () => {
    const astralLetter = '𠀀';
    const query = `${astralLetter.repeat(60)} two three four five six seven eight nine`;
    const match = buildProductFtsQuery('tenant-1', query);

    expect(match).not.toContain('"nine"*');
    expect(match).toContain(`"${astralLetter.repeat(48)}"*`);
    expect(match).not.toContain('\uFFFD');
  });
});
