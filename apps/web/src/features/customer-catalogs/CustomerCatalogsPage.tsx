import { useState } from 'react';
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
  customerCatalogConfig,
  customerCatalogTabs,
  type CustomerCatalogKey,
} from '@/features/customer-catalogs/customerCatalogConfig';
import { buildCustomerCatalogColumns } from '@/features/customer-catalogs/customerCatalogColumns';
import { getErrorMessage } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { CustomerCatalogItem } from '@/types';

export function CustomerCatalogsPage() {
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

  const config = customerCatalogConfig[activeCatalog];
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
        toast.success({ title: `${config.singularLabel} updated` });
      } else {
        await currentCreateMutation.mutateAsync(payload);
        toast.success({ title: `${config.singularLabel} created` });
      }

      await invalidateActiveCatalog();
      handleCloseModal();
    } catch (error) {
      toast.error({
        title: `Unable to save ${config.singularLabel.toLowerCase()}`,
        description: getErrorMessage(error, `Unable to save ${config.singularLabel.toLowerCase()}`),
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
      toast.success({ title: `${config.singularLabel} deleted` });
    } catch (error) {
      toast.error({
        title: `Unable to delete ${config.singularLabel.toLowerCase()}`,
        description: getErrorMessage(
          error,
          `Unable to delete ${config.singularLabel.toLowerCase()}`
        ),
      });
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-secondary-200 bg-white p-2">
        {customerCatalogTabs.map(([key, tabConfig]) => (
          <button
            key={key}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeCatalog === key
                ? 'bg-primary-600 text-white'
                : 'text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900'
            }`}
            onClick={() => {
              setActiveCatalog(key);
              setEditingItem(null);
              setItemToDelete(null);
            }}
          >
            {tabConfig.pluralLabel}
          </button>
        ))}
      </div>

      <ResourcePage
        title="Customer Catalogs"
        description={config.description}
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            Add {config.singularLabel}
          </button>
        }
        columns={buildCustomerCatalogColumns(handleOpenEdit, setItemToDelete)}
        data={activeItems}
        isLoading={activeQuery.isLoading}
        error={activeQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={config.searchPlaceholder}
        loadingMessage={`Loading ${config.pluralLabel.toLowerCase()}...`}
        onRetry={() => {
          void activeQuery.refetch();
        }}
      />

      <CustomerCatalogFormModal
        key={`${activeCatalog}-${editingItem?.id ?? 'new-item'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        item={editingItem}
        singularLabel={config.singularLabel}
        isSaving={currentCreateMutation.isPending || currentUpdateMutation.isPending}
        error={currentCreateMutation.error?.message ?? currentUpdateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!itemToDelete}
        title={`Delete ${config.singularLabel}`}
        message={
          itemToDelete
            ? `Delete ${itemToDelete.name}? Customers that still use code ${itemToDelete.code} will keep their stored value, but new edits will require an active catalog entry.`
            : ''
        }
        confirmText={currentDeleteMutation.isPending ? 'Deleting...' : `Delete ${config.singularLabel}`}
        cancelText="Cancel"
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
