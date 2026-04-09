import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FolderTree, Search } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Category, Provider } from '@/types';

interface ProviderCategoryAssignmentsValues {
  categoryIds: string[];
}

interface CategoryRow extends Category {
  depth: number;
}

interface ProviderCategoryAssignmentsModalProps {
  isOpen: boolean;
  provider: Provider | null;
  categories: Category[];
  initialCategoryIds: string[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (categoryIds: string[]) => Promise<void>;
}

function buildCategoryRows(categories: Category[]): CategoryRow[] {
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

  const rows: CategoryRow[] = [];

  const visit = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      rows.push({ ...category, depth });
      visit(category.id, depth + 1);
    }
  };

  visit(null, 0);
  return rows;
}

export function ProviderCategoryAssignmentsModal({
  isOpen,
  provider,
  categories,
  initialCategoryIds,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProviderCategoryAssignmentsModalProps) {
  const form = useForm<ProviderCategoryAssignmentsValues>({
    defaultValues: {
      categoryIds: initialCategoryIds,
    },
  });
  const [search, setSearch] = useState('');
  const selectedIds = new Set(form.watch('categoryIds'));
  const categoryRows = useMemo(() => buildCategoryRows(categories), [categories]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredCategories = useMemo(
    () =>
      categoryRows.filter(category => {
        if (normalizedSearch.length === 0) {
          return true;
        }

        return (
          category.name.toLowerCase().includes(normalizedSearch) ||
          (category.description ?? '').toLowerCase().includes(normalizedSearch)
        );
      }),
    [categoryRows, normalizedSearch]
  );

  const toggleCategory = (categoryId: string) => {
    const nextIds = selectedIds.has(categoryId)
      ? [...selectedIds].filter(candidateId => candidateId !== categoryId)
      : [...selectedIds, categoryId];

    form.setValue('categoryIds', nextIds, { shouldDirty: true });
  };

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit(values.categoryIds);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={provider ? `Manage Categories for ${provider.name}` : 'Manage Provider Categories'}
      size="lg"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Assignments'}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          Select which product categories this provider commonly supplies.
        </div>

        <label className="block">
          <span className="label">Search categories</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="input pl-9"
              placeholder="Search by category name"
            />
          </div>
        </label>

        <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
          {filteredCategories.length === 0 && (
            <div className="rounded-xl border border-secondary-200 bg-white px-4 py-6 text-center text-sm text-secondary-500">
              No matching categories found.
            </div>
          )}

          {filteredCategories.map(category => {
            const isSelected = selectedIds.has(category.id);

            return (
              <label
                key={category.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 transition ${
                  isSelected
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-secondary-200 bg-white hover:border-secondary-300'
                }`}
                style={{ paddingLeft: `${16 + category.depth * 20}px` }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCategory(category.id)}
                  className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FolderTree className="h-4 w-4 text-primary-700" />
                    <p className="font-medium text-secondary-900">{category.name}</p>
                  </div>
                  <p className="mt-1 text-sm text-secondary-500">
                    {category.description || (category.depth === 0 ? 'Top-level category' : 'Nested category')}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </div>
    </Modal>
  );
}
