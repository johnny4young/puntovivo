import type { Category } from '@/types';

export interface CategoryLookupOption {
  id: string;
  name: string;
  depth: number;
}

export interface CategoryFormValues {
  name: string;
  description: string;
  parentId: string;
}

const defaultValues: CategoryFormValues = {
  name: '',
  description: '',
  parentId: '',
};

export function createCategoryFormValues(category: Category | null): CategoryFormValues {
  if (!category) return defaultValues;

  return {
    name: category.name,
    description: category.description ?? '',
    parentId: category.parentId ?? '',
  };
}

export function hasAdvancedCategoryData(category: Category | null): boolean {
  if (!category) return false;
  const values = createCategoryFormValues(category);
  return Boolean(values.description || values.parentId);
}
