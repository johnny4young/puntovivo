/**
 * Tests for resolveCatalogLabel — the read-side normalizer that keeps a
 * customer-catalog reference from leaking a raw nanoid into the UI.
 *
 * The column is unconstrained text written two ways (catalog `id` by the seed,
 * `code` by the form select), so the resolver must handle BOTH shapes plus the
 * not-yet-loaded / empty cases without ever rendering an empty cell.
 *
 * @module features/customers/catalogLabel.test
 */
import { describe, expect, it } from 'vitest';
import type { CustomerCatalogItem } from '@/types';
import { resolveCatalogLabel } from './catalogLabel';

const types: CustomerCatalogItem[] = [
  {
    id: 'Ch0-W7mj_qvHl2oxUr67x',
    tenantId: 't1',
    code: 'CC',
    name: 'Cédula de ciudadanía',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'aJ2_mayoristaId',
    tenantId: 't1',
    code: 'MAY',
    name: 'Mayorista',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('resolveCatalogLabel', () => {
  it('resolves a stored nanoid id to its code (the seeded / FK shape)', () => {
    expect(resolveCatalogLabel(types, 'Ch0-W7mj_qvHl2oxUr67x')).toBe('CC');
  });

  it('resolves to the name when field is "name"', () => {
    expect(resolveCatalogLabel(types, 'aJ2_mayoristaId', 'name')).toBe('Mayorista');
  });

  it('falls back to the raw value when it is already a code (the form shape)', () => {
    // CustomerCatalogSelect stores option.code, so the column may hold "CC"
    // directly; that must render as-is, not collapse to a placeholder.
    expect(resolveCatalogLabel(types, 'CC')).toBe('CC');
  });

  it('falls back to the raw value when the catalog has not loaded yet', () => {
    expect(resolveCatalogLabel([], 'Ch0-W7mj_qvHl2oxUr67x')).toBe('Ch0-W7mj_qvHl2oxUr67x');
  });

  it('returns undefined for nullish / empty values', () => {
    expect(resolveCatalogLabel(types, null)).toBeUndefined();
    expect(resolveCatalogLabel(types, undefined)).toBeUndefined();
    expect(resolveCatalogLabel(types, '')).toBeUndefined();
  });
});
