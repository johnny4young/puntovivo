import { useState } from 'react';
import { Check, ImageOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';
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
      toast.success({ title: 'Logo created' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to create logo',
        description: getErrorMessage(error, 'Unable to create logo'),
      });
    },
  });

  const updateMutation = trpc.logos.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.logos.list.invalidate(), utils.companies.getCurrent.invalidate()]);
      handleCloseModal();
      toast.success({ title: 'Logo updated' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to update logo',
        description: getErrorMessage(error, 'Unable to update logo'),
      });
    },
  });

  const deleteMutation = trpc.logos.delete.useMutation({
    onSuccess: async () => {
      await utils.logos.list.invalidate();
      setLogoToDelete(null);
      toast.success({ title: 'Logo deleted' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to delete logo',
        description: getErrorMessage(error, 'Unable to delete logo'),
      });
    },
  });

  const selectLogoMutation = trpc.companies.setLogo.useMutation({
    onSuccess: async companyRecord => {
      await utils.companies.getCurrent.setData(undefined, companyRecord);
      toast.success({ title: 'Company logo updated' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to update company logo',
        description: getErrorMessage(error, 'Unable to update company logo'),
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
            <h2 className="text-lg font-semibold text-secondary-900">Logo Library</h2>
            <p className="mt-1 text-sm text-secondary-500">
              Manage reusable tenant logos and choose which one represents the company.
            </p>
          </div>
          <button className="btn-secondary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canEdit}>
            <Plus className="h-4 w-4" />
            Add Logo
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-secondary-200 bg-secondary-50 p-4">
          <p className="text-sm font-medium text-secondary-800">Current company logo</p>
          {company?.logoUrl ? (
            <div className="mt-3 flex items-center gap-4">
              <img
                src={company.logoUrl}
                alt={company.logoName ?? company.name}
                className="h-16 w-16 rounded-xl border border-secondary-200 bg-white object-contain p-2"
              />
              <div>
                <p className="font-medium text-secondary-900">{company.logoName ?? 'Selected logo'}</p>
                <p className="text-sm text-secondary-500">{company.logoUrl}</p>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3 text-sm text-secondary-500">
              <ImageOff className="h-4 w-4" />
              No logo selected for the company.
            </div>
          )}
        </div>

        {logosQuery.isLoading && (
          <div className="mt-6">
            <PageLoadingState title="Logo library" description="Loading saved tenant logos." />
          </div>
        )}

        {logosQuery.error && (
          <div className="mt-6">
            <QueryErrorState
              title="Unable to load logos"
              message={logosQuery.error.message}
              onRetry={() => {
                void logosQuery.refetch();
              }}
            />
          </div>
        )}

        {!logosQuery.isLoading && !logosQuery.error && (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {logos.length === 0 && (
              <div className="rounded-2xl border border-dashed border-secondary-300 bg-white px-4 py-8 text-center text-sm text-secondary-500 md:col-span-2 xl:col-span-3">
                No saved logos yet. Add one to start building a reusable brand library.
              </div>
            )}

            {logos.map(logo => {
              const isSelected = selectedLogoId === logo.id;
              const isMutatingSelection =
                selectLogoMutation.isPending && selectLogoMutation.variables?.logoId === logo.id;

              return (
                <div
                  key={logo.id}
                  className={`rounded-2xl border p-4 ${isSelected ? 'border-primary-300 bg-primary-50' : 'border-secondary-200 bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-secondary-900">{logo.name}</p>
                      <p className="text-xs text-secondary-500">{logo.assignedCompanyCount ?? 0} company assignments</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-ghost btn-icon h-8 w-8"
                        onClick={() => handleOpenEdit(logo)}
                        disabled={!canEdit}
                        title="Edit logo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
                        onClick={() => setLogoToDelete(logo)}
                        disabled={!canEdit}
                        title="Delete logo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <img
                    src={logo.imageUrl}
                    alt={logo.name}
                    className="mt-4 h-32 w-full rounded-xl border border-secondary-200 bg-secondary-50 object-contain p-3"
                  />

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className={`badge ${logo.isActive ? 'badge-success' : 'badge-secondary'}`}>
                      {logo.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <div className="flex gap-2">
                      {isSelected ? (
                        <button
                          className="btn-secondary"
                          onClick={() => void selectLogoMutation.mutateAsync({ logoId: null })}
                          disabled={!canEdit || selectLogoMutation.isPending}
                        >
                          Clear
                        </button>
                      ) : (
                        <button
                          className="btn-primary inline-flex items-center gap-2"
                          onClick={() => void selectLogoMutation.mutateAsync({ logoId: logo.id })}
                          disabled={!canEdit || isMutatingSelection}
                        >
                          <Check className="h-4 w-4" />
                          {isMutatingSelection ? 'Selecting...' : 'Use'}
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
        title="Delete Logo"
        message={`Delete ${logoToDelete?.name ?? 'this logo'}? Logos assigned to the company must be unassigned first.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete Logo'}
        cancelText="Cancel"
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
