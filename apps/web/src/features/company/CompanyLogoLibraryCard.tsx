import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ImageOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import type { Company, Logo } from '@/types';
import {
  CompanyLogoFormModal,
  type CompanyLogoFormValues,
} from './CompanyLogoFormModal';

interface CompanyLogoLibraryCardProps {
  company: Company | null;
  canEdit: boolean;
}

export function CompanyLogoLibraryCard({ company, canEdit }: CompanyLogoLibraryCardProps) {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const utils = trpc.useUtils();
  const logosQuery = trpc.logos.list.useQuery({ includeInactive: true });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingLogo, setEditingLogo] = useState<Logo | null>(null);
  const [logoToDelete, setLogoToDelete] = useState<Logo | null>(null);

  const createMutation = trpc.logos.create.useMutation({
    onSuccess: async () => {
      await utils.logos.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('company.logo.toast.created') });
    },
    onError: error => {
      toast.error({
        title: t('company.logo.toast.createError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const updateMutation = trpc.logos.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.logos.list.invalidate(), utils.companies.getCurrent.invalidate()]);
      handleCloseModal();
      toast.success({ title: t('company.logo.toast.updated') });
    },
    onError: error => {
      toast.error({
        title: t('company.logo.toast.updateError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const deleteMutation = trpc.logos.delete.useMutation({
    onSuccess: async () => {
      await utils.logos.list.invalidate();
      setLogoToDelete(null);
      toast.success({ title: t('company.logo.toast.deleted') });
    },
    onError: error => {
      toast.error({
        title: t('company.logo.toast.deleteError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const selectLogoMutation = trpc.companies.setLogo.useMutation({
    onSuccess: async companyRecord => {
      await utils.companies.getCurrent.setData(undefined, companyRecord);
      toast.success({ title: t('company.logo.toast.logoUpdated') });
    },
    onError: error => {
      toast.error({
        title: t('company.logo.toast.logoUpdateError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const logos = (logosQuery.data?.items ?? []) as Logo[];
  const selectedLogoId = company?.logoId ?? null;

  function handleCloseModal() {
    setIsModalOpen(false);
    setEditingLogo(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function handleOpenCreate() {
    setEditingLogo(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  function handleOpenEdit(logo: Logo) {
    setEditingLogo(logo);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  async function handleSubmit(values: CompanyLogoFormValues) {
    if (editingLogo) {
      await updateMutation.mutateAsync({
        id: editingLogo.id,
        name: values.name.trim(),
        imageUrl: values.imageUrl.trim(),
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      name: values.name.trim(),
      imageUrl: values.imageUrl.trim(),
      isActive: values.isActive,
    });
  }

  return (
    <>
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">{t('company.logo.title')}</h2>
            <p className="mt-1 text-sm text-secondary-500">
              {t('company.logo.description')}
            </p>
          </div>
          <button className="btn-secondary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            {t('company.logo.addLogo')}
          </button>
        </div>

        <div className="surface-panel-muted mt-6">
          <p className="text-sm font-medium text-secondary-800">{t('company.logo.currentLogo')}</p>
          {company?.logoUrl ? (
            <div className="mt-3 flex items-center gap-4">
              <img
                src={company.logoUrl}
                alt={company.logoName ?? company.name}
                className="h-16 w-16 rounded-xl border border-line/80 bg-surface object-contain p-2"
              />
              <div>
                <p className="font-medium text-secondary-900">{company.logoName ?? t('company.logo.selectedLogo')}</p>
                <p className="text-sm text-secondary-500">{company.logoUrl}</p>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3 text-sm text-secondary-500">
              <ImageOff className="h-4 w-4" />
              {t('company.logo.noLogoSelected')}
            </div>
          )}
        </div>

        {logosQuery.isLoading && (
          <div className="mt-6">
            <PageLoadingState title={t('company.logo.loadingTitle')} description={t('company.logo.loadingDescription')} />
          </div>
        )}

        {logosQuery.error && (
          <div className="mt-6">
            <QueryErrorState
              title={t('company.logo.loadError')}
              message={translateServerError(logosQuery.error, t, t('errors:server.unknown'))}
              onRetry={() => {
                void logosQuery.refetch();
              }}
            />
          </div>
        )}

        {!logosQuery.isLoading && !logosQuery.error && (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {logos.length === 0 && (
              <div className="surface-empty px-4 py-8 text-center md:col-span-2 xl:col-span-3">
                {t('company.logo.emptyLibrary')}
              </div>
            )}

            {logos.map(logo => {
              const isSelected = selectedLogoId === logo.id;
              const isMutatingSelection =
                selectLogoMutation.isPending && selectLogoMutation.variables?.logoId === logo.id;

              return (
                <div
                  key={logo.id}
                  className={`rounded-2xl border p-4 ${
                    isSelected
                      ? 'border-primary-300 bg-primary-50/70 dark:border-primary-400/35 dark:bg-primary-400/14'
                      : 'border-line/80 bg-surface'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-secondary-900">{logo.name}</p>
                      <p className="text-xs text-secondary-500">{t('company.logo.companyAssignments', { count: logo.assignedCompanyCount ?? 0 })}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-ghost btn-icon h-8 w-8"
                        onClick={() => handleOpenEdit(logo)}
                        disabled={!canEdit}
                        title={t('company.logo.editTitle')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
                        onClick={() => setLogoToDelete(logo)}
                        disabled={!canEdit}
                        title={t('company.logo.deleteTitle')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <img
                    src={logo.imageUrl}
                    alt={logo.name}
                    className="mt-4 h-32 w-full rounded-xl border border-line/80 bg-surface-2/86 object-contain p-3"
                  />

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className={`badge ${logo.isActive ? 'badge-success' : 'badge-secondary'}`}>
                      {logo.isActive ? t('company.logo.active') : t('company.logo.inactive')}
                    </span>
                    <div className="flex gap-2">
                      {isSelected ? (
                        <button
                          className="btn-secondary"
                          onClick={() => void selectLogoMutation.mutateAsync({ logoId: null })}
                          disabled={!canEdit || selectLogoMutation.isPending}
                        >
                          {t('company.logo.clear')}
                        </button>
                      ) : (
                        <button
                          className="btn-primary inline-flex items-center gap-2"
                          onClick={() => void selectLogoMutation.mutateAsync({ logoId: logo.id })}
                          disabled={!canEdit || isMutatingSelection}
                        >
                          <Check className="h-4 w-4" />
                          {isMutatingSelection ? t('company.logo.selecting') : t('company.logo.use')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CompanyLogoFormModal
        key={`${editingLogo?.id ?? 'new-logo'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        logo={editingLogo}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!logoToDelete}
        title={t('company.logo.deleteConfirmTitle')}
        message={t('company.logo.deleteConfirmMessage', { name: logoToDelete?.name ?? '' })}
        confirmText={deleteMutation.isPending ? t('company.logo.deleting') : t('company.logo.deleteConfirm')}
        cancelText={t('company.logo.cancel')}
        loading={deleteMutation.isPending}
        variant="danger"
        onConfirm={() => {
          if (logoToDelete) {
            void deleteMutation.mutateAsync({ id: logoToDelete.id });
          }
        }}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setLogoToDelete(null);
          }
        }}
      />
    </>
  );
}
