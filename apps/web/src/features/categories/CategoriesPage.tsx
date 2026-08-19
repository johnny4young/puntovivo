import { lazy, Suspense, useMemo, useState } from 'react';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import { FolderTree, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Category } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import type { CategoryFormValues } from '@/features/categories/categoryForm.types';
import {
  buildCategoryTreeRows,
  getParentOptions,
  type CategoryTreeRow,
} from '@/features/categories/categoryTree';
import { onErrorToast } from '@/lib/mutationHelpers';
import { extractServerErrorCode } from '@/lib/translateServerError';

const CategoryFormModal = lazy(() =>
  import('@/features/categories/CategoryFormModal').then(module => ({
    default: module.CategoryFormModal,
  }))
);

function toOptionalString(value: string): string | undefined {
  return value || undefined;
}

function toNullableString(value: string): string | null {
  return value || null;
}

export function CategoriesPage() {
  const { t } = useTranslation('categories');
  const { user } = useAuth();
  const toast = useToast();
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
      toast.success({ title: t('toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'categories:toast.createError' }),
  });
  const updateMutation = trpc.categories.update.useMutation({
    onSuccess: async () => {
      await utils.categories.tree.invalidate();
      await utils.categories.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.updated') });
    },
    // refresh the cached tree/list on a STALE_VERSION conflict.
    onError: onErrorToast(toast, t, {
      titleKey: 'categories:toast.updateError',
      extra: (_description, error) => {
        if (extractServerErrorCode(error) === 'STALE_VERSION') {
          void utils.categories.tree.invalidate();
          void utils.categories.list.invalidate();
        }
      },
    }),
  });
  const deleteMutation = trpc.categories.delete.useMutation({
    onSuccess: async () => {
      await utils.categories.tree.invalidate();
      await utils.categories.list.invalidate();
      setCategoryToDelete(null);
      toast.success({ title: t('toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'categories:toast.deleteError' }),
  });

  const canManage = user?.role === 'admin';
  const categories = useMemo(
    () => (categoriesQuery.data?.items ?? []) as Category[],
    [categoriesQuery.data?.items]
  );

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
        // round-trip the loaded version for the concurrency guard.
        version: editingCategory.version,
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

  const columns: DataTableColumnDef<CategoryTreeRow>[] = [
    {
      accessorKey: 'name',
      header: t('columns.category'),
      size: 320,
      cell: ({ row }) => (
        <div
          className="flex items-center gap-3"
          style={{ paddingLeft: `${row.original.depth * 24}px` }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <FolderTree className="h-4 w-4 text-primary-700" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">
              {row.original.childCount > 0
                ? t('columns.children', { count: row.original.childCount })
                : row.original.depth === 0
                  ? t('columns.topLevel')
                  : t('columns.leaf')}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: t('columns.description'),
      size: 260,
      cell: ({ row }) => row.original.description || '-',
    },
    {
      accessorKey: 'depth',
      header: t('columns.level'),
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
            aria-label={t('common:actions.edit')}
            title={t('common:actions.edit')}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => setCategoryToDelete(row.original)}
            disabled={!canManage}
            aria-label={t('common:actions.delete')}
            title={t('common:actions.delete')}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ResourcePage
        title={t('title')}
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            {t('add')}
          </button>
        }
        columns={columns}
        data={rows}
        isLoading={categoriesQuery.isLoading}
        error={categoriesQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('search')}
        loadingMessage={t('loading')}
        onRetry={() => {
          void categoriesQuery.refetch();
        }}
        enableRowSelection={false}
      />

      {!canManage ? (
        <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('permissionNote')}
        </div>
      ) : null}

      {isModalOpen ? (
        <Suspense
          fallback={
            <Modal
              isOpen
              onClose={handleCloseModal}
              title={t('form.loadingTitle')}
              size="lg"
              closeOnBackdrop={false}
              closeOnEsc={false}
              showCloseButton={false}
            >
              <div
                className="flex min-h-52 flex-col items-center justify-center gap-3 text-center"
                role="status"
              >
                <LoaderCircle
                  className="h-6 w-6 animate-spin text-primary-700"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-secondary-700">{t('form.loadingMessage')}</p>
              </div>
            </Modal>
          }
        >
          <CategoryFormModal
            key={`${editingCategory?.id ?? 'new-category'}-${modalInstanceKey}`}
            isOpen
            category={editingCategory}
            parentOptions={parentOptions}
            isSaving={createMutation.isPending || updateMutation.isPending}
            error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={() => {
          if (categoryToDelete) {
            void deleteMutation.mutateAsync({ id: categoryToDelete.id });
          }
        }}
        title={t('delete.title')}
        message={categoryToDelete ? t('delete.description') : ''}
        confirmText={t('delete.confirm')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
