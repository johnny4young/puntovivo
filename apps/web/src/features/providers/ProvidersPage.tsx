import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import { ProviderCategoryAssignmentsModal } from '@/features/providers/ProviderCategoryAssignmentsModal';
import {
  ProviderFormModal,
  type ProviderFormValues,
} from '@/features/providers/ProviderFormModal';
import { createProviderColumns } from '@/features/providers/providerColumns';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { Category, City, Provider, UserRole } from '@/types';

function canManageProviders(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function ProvidersPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);
  const [providerForCategories, setProviderForCategories] = useState<Provider | null>(null);

  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 50 });
  const citiesQuery = trpc.cities.list.useQuery({ page: 1, perPage: 200 });
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providerCategoryAssignmentsQuery = trpc.providers.listCategoryAssignments.useQuery(
    { providerId: providerForCategories?.id ?? '' },
    { enabled: !!providerForCategories?.id }
  );

  const createMutation = trpc.providers.create.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('providers.toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:providers.toast.createError' }),
  });
  const updateMutation = trpc.providers.update.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('providers.toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:providers.toast.updateError' }),
  });
  const deleteMutation = trpc.providers.delete.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      setProviderToDelete(null);
      toast.success({ title: t('providers.toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:providers.toast.deleteError' }),
  });
  const replaceCategoriesMutation = trpc.providers.replaceCategoryAssignments.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.providers.list.invalidate(),
        utils.providers.listCategoryAssignments.invalidate(),
      ]);
      setProviderForCategories(null);
      toast.success({ title: t('providers.toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:providers.toast.updateError' }),
  });

  const canManage = canManageProviders(user?.role);
  const canDelete = user?.role === 'admin';
  const providers = (providersQuery.data?.items ?? []).map(provider => ({
    ...provider,
    isActive: provider.isActive ?? false,
  })) as Provider[];
  const cities = (citiesQuery.data?.items ?? []).map(city => ({
    ...city,
    isActive: city.isActive ?? false,
  })) as City[];
  const categories = (categoriesQuery.data?.items ?? []) as Category[];

  function handleCloseModal() {
    setIsModalOpen(false);
    setEditingProvider(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function handleCloseCategoryModal() {
    setProviderForCategories(null);
    replaceCategoriesMutation.reset();
  }

  function handleOpenCreate() {
    setEditingProvider(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  function handleOpenEdit(provider: Provider) {
    setEditingProvider(provider);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  function handleOpenCategories(provider: Provider) {
    setProviderForCategories(provider);
  }

  async function handleSubmit(values: ProviderFormValues) {
    const payload = {
      name: values.name.trim(),
      contactName: values.contactName.trim() || null,
      taxId: values.taxId.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      address: values.address.trim() || null,
      cityId: values.cityId || null,
      isActive: values.isActive,
    };

    if (editingProvider) {
      await updateMutation.mutateAsync({
        id: editingProvider.id,
        ...payload,
      });
      return;
    }

    await createMutation.mutateAsync({
      ...payload,
      contactName: payload.contactName ?? undefined,
      taxId: payload.taxId ?? undefined,
      email: payload.email ?? undefined,
      phone: payload.phone ?? undefined,
      address: payload.address ?? undefined,
      cityId: payload.cityId ?? undefined,
    });
  }

  async function handleSubmitCategories(categoryIds: string[]) {
    if (!providerForCategories) {
      return;
    }

    await replaceCategoriesMutation.mutateAsync({
      providerId: providerForCategories.id,
      categoryIds,
    });
  }

  const columns = createProviderColumns({
    t,
    canManage,
    canDelete,
    onEdit: handleOpenEdit,
    onDelete: setProviderToDelete,
    onManageCategories: handleOpenCategories,
  });

  return (
    <>
      <ResourcePage
        title={t('providers.title')}
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            {t('providers.add')}
          </button>
        }
        columns={columns}
        data={providers}
        isLoading={providersQuery.isLoading}
        error={providersQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('providers.search')}
        loadingMessage={t('providers.loading')}
        onRetry={() => {
          void providersQuery.refetch();
        }}
      />

      <ProviderFormModal
        key={`${editingProvider?.id ?? 'new-provider'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        provider={editingProvider}
        cities={cities}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ProviderCategoryAssignmentsModal
        key={`${providerForCategories?.id ?? 'provider-categories'}-${
          providerCategoryAssignmentsQuery.data?.categoryIds.join(',') ?? 'loading'
        }`}
        isOpen={!!providerForCategories && !!providerCategoryAssignmentsQuery.data}
        provider={providerForCategories}
        categories={categories}
        initialCategoryIds={providerCategoryAssignmentsQuery.data?.categoryIds ?? []}
        isSaving={replaceCategoriesMutation.isPending}
        error={replaceCategoriesMutation.error?.message ?? null}
        onClose={handleCloseCategoryModal}
        onSubmit={handleSubmitCategories}
      />

      <Modal
        isOpen={!!providerForCategories && providerCategoryAssignmentsQuery.isLoading}
        onClose={handleCloseCategoryModal}
        title={
          providerForCategories
            ? `${t('providers.categories.manage')} ${providerForCategories.name}`
            : t('providers.categories.title')
        }
        size="sm"
      >
        <div className="py-4 text-sm text-secondary-600">{t('providers.categories.loading')}</div>
      </Modal>

      <Modal
        isOpen={!!providerForCategories && !!providerCategoryAssignmentsQuery.error}
        onClose={handleCloseCategoryModal}
        title={
          providerForCategories
            ? `${t('providers.categories.manage')} ${providerForCategories.name}`
            : t('providers.categories.title')
        }
        size="sm"
      >
        <div className="py-4 text-sm text-danger-600">
          {providerCategoryAssignmentsQuery.error?.message ?? t('providers.categories.error')}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!providerToDelete}
        title={t('providers.delete.title')}
        message={t('providers.delete.description')}
        confirmText={deleteMutation.isPending ? 'Deleting...' : t('providers.delete.title')}
        cancelText="Cancel"
        loading={deleteMutation.isPending}
        variant="danger"
        onConfirm={() => {
          if (providerToDelete) {
            void deleteMutation.mutateAsync({ id: providerToDelete.id });
          }
        }}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setProviderToDelete(null);
          }
        }}
      />
    </>
  );
}
