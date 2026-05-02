import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  CustomerCatalogFormModal,
  type CustomerCatalogFormValues,
} from '@/features/customer-catalogs/CustomerCatalogFormModal';
import {
  customerCatalogTabs,
  type CustomerCatalogKey,
} from '@/features/customer-catalogs/customerCatalogConfig';
import { buildCustomerCatalogColumns } from '@/features/customer-catalogs/customerCatalogColumns';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { CustomerCatalogItem } from '@/types';

export function CustomerCatalogsPage() {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [activeCatalog, setActiveCatalog] = useState<CustomerCatalogKey>('identificationTypes');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingItem, setEditingItem] = useState<CustomerCatalogItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<CustomerCatalogItem | null>(null);

  const identificationTypesQuery = trpc.identificationTypes.list.useQuery({ page: 1, perPage: 100 });
  const personTypesQuery = trpc.personTypes.list.useQuery({ page: 1, perPage: 100 });
  const regimeTypesQuery = trpc.regimeTypes.list.useQuery({ page: 1, perPage: 100 });
  const clientTypesQuery = trpc.clientTypes.list.useQuery({ page: 1, perPage: 100 });
  const commercialActivitiesQuery = trpc.commercialActivities.list.useQuery({ page: 1, perPage: 100 });

  const identificationTypesCreate = trpc.identificationTypes.create.useMutation();
  const identificationTypesUpdate = trpc.identificationTypes.update.useMutation();
  const identificationTypesDelete = trpc.identificationTypes.delete.useMutation();
  const personTypesCreate = trpc.personTypes.create.useMutation();
  const personTypesUpdate = trpc.personTypes.update.useMutation();
  const personTypesDelete = trpc.personTypes.delete.useMutation();
  const regimeTypesCreate = trpc.regimeTypes.create.useMutation();
  const regimeTypesUpdate = trpc.regimeTypes.update.useMutation();
  const regimeTypesDelete = trpc.regimeTypes.delete.useMutation();
  const clientTypesCreate = trpc.clientTypes.create.useMutation();
  const clientTypesUpdate = trpc.clientTypes.update.useMutation();
  const clientTypesDelete = trpc.clientTypes.delete.useMutation();
  const commercialActivitiesCreate = trpc.commercialActivities.create.useMutation();
  const commercialActivitiesUpdate = trpc.commercialActivities.update.useMutation();
  const commercialActivitiesDelete = trpc.commercialActivities.delete.useMutation();

  const activeQuery =
    activeCatalog === 'identificationTypes'
      ? identificationTypesQuery
      : activeCatalog === 'personTypes'
        ? personTypesQuery
        : activeCatalog === 'regimeTypes'
          ? regimeTypesQuery
          : activeCatalog === 'clientTypes'
            ? clientTypesQuery
            : commercialActivitiesQuery;
  const activeItems: CustomerCatalogItem[] = (activeQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));

  const currentCreateMutation =
    activeCatalog === 'identificationTypes'
      ? identificationTypesCreate
      : activeCatalog === 'personTypes'
        ? personTypesCreate
        : activeCatalog === 'regimeTypes'
          ? regimeTypesCreate
          : activeCatalog === 'clientTypes'
            ? clientTypesCreate
            : commercialActivitiesCreate;
  const currentUpdateMutation =
    activeCatalog === 'identificationTypes'
      ? identificationTypesUpdate
      : activeCatalog === 'personTypes'
        ? personTypesUpdate
        : activeCatalog === 'regimeTypes'
          ? regimeTypesUpdate
          : activeCatalog === 'clientTypes'
            ? clientTypesUpdate
            : commercialActivitiesUpdate;
  const currentDeleteMutation =
    activeCatalog === 'identificationTypes'
      ? identificationTypesDelete
      : activeCatalog === 'personTypes'
        ? personTypesDelete
        : activeCatalog === 'regimeTypes'
          ? regimeTypesDelete
          : activeCatalog === 'clientTypes'
            ? clientTypesDelete
            : commercialActivitiesDelete;

  const canManage = user?.role === 'admin';

  const singularType = t(`catalogs.types.${activeCatalog}.singular`);
  const searchPlaceholder = t(`catalogs.types.${activeCatalog}.search`);
  const tabLabel = t(`catalogs.tabs.${activeCatalog}`);

  const resetMutations = () => {
    identificationTypesCreate.reset();
    identificationTypesUpdate.reset();
    personTypesCreate.reset();
    personTypesUpdate.reset();
    regimeTypesCreate.reset();
    regimeTypesUpdate.reset();
    clientTypesCreate.reset();
    clientTypesUpdate.reset();
    commercialActivitiesCreate.reset();
    commercialActivitiesUpdate.reset();
  };

  const invalidateActiveCatalog = async () => {
    if (activeCatalog === 'identificationTypes') {
      await utils.identificationTypes.list.invalidate();
      return;
    }

    if (activeCatalog === 'personTypes') {
      await utils.personTypes.list.invalidate();
      return;
    }

    if (activeCatalog === 'regimeTypes') {
      await utils.regimeTypes.list.invalidate();
      return;
    }

    if (activeCatalog === 'clientTypes') {
      await utils.clientTypes.list.invalidate();
      return;
    }

    await utils.commercialActivities.list.invalidate();
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    resetMutations();
  };

  const handleOpenCreate = () => {
    setEditingItem(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: CustomerCatalogItem) => {
    setEditingItem(item);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleSubmit = async (values: CustomerCatalogFormValues) => {
    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      description: values.description.trim() || null,
      isActive: values.isActive,
    };

    try {
      if (editingItem) {
        await currentUpdateMutation.mutateAsync({
          id: editingItem.id,
          ...payload,
        });
        toast.success({ title: t('catalogs.toast.updated') });
      } else {
        await currentCreateMutation.mutateAsync(payload);
        toast.success({ title: t('catalogs.toast.created') });
      }

      await invalidateActiveCatalog();
      handleCloseModal();
    } catch (error) {
      toast.error({
        title: t('catalogs.toast.createError'),
        description: translateServerError(error, t, t('catalogs.toast.createError')),
      });
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) {
      return;
    }

    try {
      await currentDeleteMutation.mutateAsync({ id: itemToDelete.id });
      await invalidateActiveCatalog();
      setItemToDelete(null);
      toast.success({ title: t('catalogs.toast.deleted') });
    } catch (error) {
      toast.error({
        title: t('catalogs.toast.createError'),
        description: translateServerError(error, t, t('catalogs.toast.createError')),
      });
    }
  };

  return (
    <>
      <div className="segmented-control mb-6">
        {customerCatalogTabs.map(([key]) => (
          <button
            key={key}
            className={`segmented-tab ${
              activeCatalog === key
                ? 'segmented-tab-active'
                : ''
            }`}
            onClick={() => {
              setActiveCatalog(key);
              setEditingItem(null);
              setItemToDelete(null);
            }}
          >
            {t(`catalogs.tabs.${key}`)}
          </button>
        ))}
      </div>

      <ResourcePage
        title={t('catalogs.title')}
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            {t('catalogs.add', { type: singularType })}
          </button>
        }
        columns={buildCustomerCatalogColumns(handleOpenEdit, setItemToDelete)}
        data={activeItems}
        isLoading={activeQuery.isLoading}
        error={activeQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={searchPlaceholder}
        loadingMessage={t('catalogs.loading', { type: tabLabel.toLowerCase() })}
        onRetry={() => {
          void activeQuery.refetch();
        }}
      />

      <CustomerCatalogFormModal
        key={`${activeCatalog}-${editingItem?.id ?? 'new-item'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        item={editingItem}
        singularLabel={singularType}
        isSaving={currentCreateMutation.isPending || currentUpdateMutation.isPending}
        error={currentCreateMutation.error?.message ?? currentUpdateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!itemToDelete}
        title={t('catalogs.deleteTitle', { type: singularType })}
        message={
          itemToDelete
            ? t('catalogs.deleteMessage', { name: itemToDelete.name, note: t('catalogs.deleteNote') })
            : ''
        }
        confirmText={currentDeleteMutation.isPending ? t('catalogs.deleting') : t('catalogs.deleteTitle', { type: singularType })}
        cancelText={t('catalogs.cancel')}
        variant="danger"
        loading={currentDeleteMutation.isPending}
        onConfirm={() => {
          void handleDelete();
        }}
        onClose={() => {
          if (!currentDeleteMutation.isPending) {
            setItemToDelete(null);
          }
        }}
      />
    </>
  );
}
