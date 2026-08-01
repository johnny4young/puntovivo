import { lazy, Suspense, useState } from 'react';
import { BookOpenCheck, LoaderCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import type { CustomerCatalogFormValues } from './customerCatalogForm.types';
import { customerCatalogTabs, type CustomerCatalogKey } from './customerCatalogConfig';
import { buildCustomerCatalogColumns } from './customerCatalogColumns';
import { useCustomerCatalogResource } from './useCustomerCatalogResource';
import { translateServerError } from '@/lib/translateServerError';
import type { CustomerCatalogItem } from '@/types';

const CustomerCatalogFormModal = lazy(() =>
  import('./CustomerCatalogFormModal').then(module => ({
    default: module.CustomerCatalogFormModal,
  }))
);

export function CustomerCatalogsPage(): React.ReactElement {
  const { t } = useTranslation('customerCatalogs');
  const { user } = useAuth();
  const toast = useToast();
  const [activeCatalog, setActiveCatalog] = useState<CustomerCatalogKey>('identificationTypes');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingItem, setEditingItem] = useState<CustomerCatalogItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<CustomerCatalogItem | null>(null);
  const resource = useCustomerCatalogResource(activeCatalog);

  const canManage = user?.role === 'admin';
  const singularType = t(`types.${activeCatalog}.singular`);
  const pluralType = t(`types.${activeCatalog}.plural`);
  const panelId = `customer-catalog-panel-${activeCatalog}`;
  const mutationError = resource.create.error ?? resource.update.error;
  const formError = mutationError
    ? translateServerError(
        mutationError,
        t,
        t(editingItem ? 'toast.updateError' : 'toast.createError')
      )
    : null;

  const resetFormMutations = () => {
    resource.create.reset();
    resource.update.reset();
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
    resetFormMutations();
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
        await resource.update.mutateAsync({ id: editingItem.id, ...payload });
        toast.success({ title: t('toast.updated') });
      } else {
        await resource.create.mutateAsync(payload);
        toast.success({ title: t('toast.created') });
      }

      await resource.invalidate();
      handleCloseModal();
    } catch (error) {
      const titleKey = editingItem ? 'toast.updateError' : 'toast.createError';
      const fallback = t(titleKey);
      toast.error({
        title: fallback,
        description: translateServerError(error, t, fallback),
      });
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    try {
      await resource.delete.mutateAsync({ id: itemToDelete.id });
      await resource.invalidate();
      setItemToDelete(null);
      toast.success({ title: t('toast.deleted') });
    } catch (error) {
      const fallback = t('toast.deleteError');
      toast.error({
        title: fallback,
        description: translateServerError(error, t, fallback),
      });
    }
  };

  return (
    <>
      <header className="mb-6 rounded-[1.5rem] border border-line bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary-100 bg-primary-50 text-primary-800">
            <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-primary-800">
              {t('eyebrow')}
            </p>
            <h1 className="mt-1 font-display text-3xl leading-tight text-secondary-950">
              {t('title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-600">
              {t('description')}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-6 overflow-x-auto pb-1">
        <div
          className="segmented-control min-w-max"
          role="tablist"
          aria-label={t('navigationLabel')}
        >
          {customerCatalogTabs.map(key => (
            <button
              key={key}
              type="button"
              id={`customer-catalog-tab-${key}`}
              role="tab"
              aria-selected={activeCatalog === key}
              aria-controls={`customer-catalog-panel-${key}`}
              className={`segmented-tab ${activeCatalog === key ? 'segmented-tab-active' : ''}`}
              onClick={() => {
                setActiveCatalog(key);
                setEditingItem(null);
                setItemToDelete(null);
              }}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`customer-catalog-tab-${activeCatalog}`}>
        <ResourcePage
          title={pluralType}
          headingLevel={2}
          description={t(`types.${activeCatalog}.guidance`)}
          action={
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleOpenCreate}
              disabled={!canManage}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              {t('add', { type: singularType })}
            </button>
          }
          columns={buildCustomerCatalogColumns({
            t,
            canManage,
            onEdit: handleOpenEdit,
            onDelete: setItemToDelete,
          })}
          data={resource.items}
          isLoading={resource.query.isLoading}
          error={resource.query.error?.message ?? null}
          searchKey="name"
          searchPlaceholder={t(`types.${activeCatalog}.search`)}
          loadingMessage={t('loading', { type: pluralType.toLowerCase() })}
          onRetry={() => {
            void resource.query.refetch();
          }}
          {...(canManage ? { onRowActivate: handleOpenEdit } : {})}
          enableRowSelection={false}
        />
      </div>

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
          <CustomerCatalogFormModal
            key={`${activeCatalog}-${editingItem?.id ?? 'new-item'}-${modalInstanceKey}`}
            isOpen
            item={editingItem}
            singularLabel={singularType}
            isSaving={resource.create.isPending || resource.update.isPending}
            error={formError}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={!!itemToDelete}
        title={t('delete.title', { type: singularType })}
        message={
          itemToDelete
            ? t('delete.message', {
                name: itemToDelete.name,
                note: t('delete.note'),
              })
            : ''
        }
        confirmText={resource.delete.isPending ? t('delete.submitting') : t('delete.confirm')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={resource.delete.isPending}
        onConfirm={() => {
          void handleDelete();
        }}
        onClose={() => {
          if (!resource.delete.isPending) setItemToDelete(null);
        }}
      />
    </>
  );
}
