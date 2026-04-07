import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Category } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  CategoryFormModal,
  type CategoryFormValues,
  type CategoryLookupOption,
} from '@/features/categories/CategoryFormModal';

interface CategoryTreeRow extends Category {
  depth: number;
  childCount: number;
}

function buildCategoryTreeRows(categories: Category[]): CategoryTreeRow[] {
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

function getParentOptions(rows: CategoryTreeRow[], editingCategoryId: string | null): CategoryLookupOption[] {
  return rows
    .filter(row => row.id !== editingCategoryId)
    .map(row => ({
      id: row.id,
      name: row.name,
      depth: row.depth,
    }));
}

function toOptionalString(value: string): string | undefined {
  return value || undefined;
}

function toNullableString(value: string): string | null {
  return value || null;
}

export function CategoriesPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  const categoriesQuery = trpc.categories.tree.useQuery();
  const createMutation = trpc.categories.create.useMutation({
    onSuccess: async () => {
      await utils.categories.tree.invalidate();
      await utils.categories.list.invalidate();
      handleCloseModal();
    },
  });
  const updateMutation = trpc.categories.update.useMutation({
    onSuccess: async () => {
      await utils.categories.tree.invalidate();
      await utils.categories.list.invalidate();
      handleCloseModal();
    },
  });
  const deleteMutation = trpc.categories.delete.useMutation({
    onSuccess: async () => {
      await utils.categories.tree.invalidate();
      await utils.categories.list.invalidate();
      setCategoryToDelete(null);
    },
  });

  const canManage = user?.role === 'admin';
  const categories = (categoriesQuery.data?.items ?? []) as Category[];

  const rows = useMemo(() => buildCategoryTreeRows(categories), [categories]);
  const parentOptions = useMemo(
    () => getParentOptions(rows, editingCategory?.id ?? null),
    [editingCategory?.id, rows]
  );

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (category: Category) => {
    setEditingCategory(category);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleSubmit = async (values: CategoryFormValues) => {
    if (editingCategory) {
      await updateMutation.mutateAsync({
        id: editingCategory.id,
        name: values.name,
        description: toOptionalString(values.description),
        parentId: toNullableString(values.parentId),
      });
      return;
    }

    await createMutation.mutateAsync({
      name: values.name,
      description: toOptionalString(values.description),
      parentId: toOptionalString(values.parentId),
    });
  };

  const columns: ColumnDef<CategoryTreeRow>[] = [
    {
      accessorKey: 'name',
      header: 'Category',
      size: 320,
      cell: ({ row }) => (
        <div className="flex items-center gap-3" style={{ paddingLeft: `${row.original.depth * 24}px` }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <FolderTree className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">
              {row.original.childCount > 0
                ? `${row.original.childCount} child ${row.original.childCount === 1 ? 'category' : 'categories'}`
                : row.original.depth === 0
                  ? 'Top-level category'
                  : 'Leaf category'}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      size: 260,
      cell: ({ row }) => row.original.description || '-',
    },
    {
      accessorKey: 'depth',
      header: 'Level',
      size: 100,
      cell: ({ row }) => row.original.depth + 1,
    },
    {
      id: 'actions',
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => handleOpenEdit(row.original)}
            disabled={!canManage}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => setCategoryToDelete(row.original)}
            disabled={!canManage}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ResourcePage
        title="Categories"
        description="Manage the product category hierarchy used across catalog and reporting"
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" />
            Add Category
          </button>
        }
        columns={columns}
        data={rows}
        isLoading={categoriesQuery.isLoading}
        error={categoriesQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder="Search categories..."
        loadingMessage="Loading categories..."
        enableRowSelection={false}
      />

      <CategoryFormModal
        key={`${editingCategory?.id ?? 'new-category'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        category={editingCategory}
        parentOptions={parentOptions}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={() => {
          if (categoryToDelete) {
            void deleteMutation.mutateAsync({ id: categoryToDelete.id });
          }
        }}
        title="Delete Category"
        message={`Are you sure you want to delete ${categoryToDelete?.name ?? 'this category'}?`}
        confirmText="Delete Category"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
