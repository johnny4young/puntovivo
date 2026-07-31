import type { Category } from '@/types';
import type { CategoryLookupOption } from './categoryForm.types';

export interface CategoryTreeRow extends Category {
  depth: number;
  childCount: number;
}

export function buildCategoryTreeRows(categories: Category[]): CategoryTreeRow[] {
  const byParent = new Map<string | null, Category[]>();

  for (const category of categories) {
    const parentKey = category.parentId ?? null;
    const siblings = byParent.get(parentKey) ?? [];
    siblings.push(category);
    byParent.set(parentKey, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name));
  }

  const rows: CategoryTreeRow[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const siblings = byParent.get(parentId) ?? [];

    for (const category of siblings) {
      const children = byParent.get(category.id) ?? [];

      rows.push({
        ...category,
        depth,
        childCount: children.length,
      });

      visit(category.id, depth + 1);
    }
  };

  visit(null, 0);
  return rows;
}

export function getParentOptions(
  rows: CategoryTreeRow[],
  editingCategoryId: string | null
): CategoryLookupOption[] {
  const parentById = new Map(rows.map(row => [row.id, row.parentId ?? null]));

  const belongsToEditingSubtree = (row: CategoryTreeRow): boolean => {
    if (!editingCategoryId) return false;
    if (row.id === editingCategoryId) return true;

    let ancestorId = row.parentId ?? null;
    while (ancestorId) {
      if (ancestorId === editingCategoryId) return true;
      ancestorId = parentById.get(ancestorId) ?? null;
    }

    return false;
  };

  return rows
    .filter(row => !belongsToEditingSubtree(row))
    .map(row => ({
      id: row.id,
      name: row.name,
      depth: row.depth,
    }));
}
