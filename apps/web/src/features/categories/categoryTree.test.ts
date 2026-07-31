import { describe, expect, it } from 'vitest';

import type { Category } from '@/types';
import { buildCategoryTreeRows, getParentOptions } from './categoryTree';

function category(id: string, name: string, parentId: string | null = null): Category {
  return {
    id,
    tenantId: 'tenant-1',
    name,
    description: null,
    parentId,
    version: 1,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('category tree presentation', () => {
  it('returns no rows or parent options for an empty catalog', () => {
    const rows = buildCategoryTreeRows([]);

    expect(rows).toEqual([]);
    expect(getParentOptions(rows, null)).toEqual([]);
  });

  it('orders siblings and preserves hierarchy metadata', () => {
    const rows = buildCategoryTreeRows([
      category('bakery', 'Bakery'),
      category('bread', 'Bread', 'bakery'),
      category('beverages', 'Beverages'),
    ]);

    expect(rows.map(row => [row.name, row.depth, row.childCount])).toEqual([
      ['Bakery', 0, 1],
      ['Bread', 1, 0],
      ['Beverages', 0, 0],
    ]);
  });

  it('prevents a category and its descendants from becoming its own parent', () => {
    const rows = buildCategoryTreeRows([
      category('food', 'Food'),
      category('bakery', 'Bakery', 'food'),
      category('bread', 'Bread', 'bakery'),
      category('beverages', 'Beverages'),
    ]);

    expect(getParentOptions(rows, 'food').map(option => option.id)).toEqual(['beverages']);
    expect(getParentOptions(rows, 'bakery').map(option => option.id)).toEqual([
      'beverages',
      'food',
    ]);
  });
});
