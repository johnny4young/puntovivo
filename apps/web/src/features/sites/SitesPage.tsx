import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { SiteFormModal, type SiteFormValues } from '@/features/sites/SiteFormModal';
import { SiteLocationAssignmentsModal } from '@/features/sites/SiteLocationAssignmentsModal';
import { createSiteColumns } from '@/features/sites/siteColumns';
import type { Location, Site, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';

function canManageSites(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function SitesPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const sitesQuery = trpc.sites.list.useQuery({ includeInactive: true });
  const locationsQuery = trpc.locations.list.useQuery({ page: 1, perPage: 200 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [siteForLocations, setSiteForLocations] = useState<Site | null>(null);

  const company = companyQuery.data ?? null;
  const sites = (sitesQuery.data?.items ?? []).map(site => ({
    ...site,
    isActive: !!site.isActive,
  }));
  const locations: Location[] = (locationsQuery.data?.items ?? []).map(location => ({
    ...location,
    isActive: !!location.isActive,
  }));
  const canManage = canManageSites(user?.role);
  const siteLocationAssignmentsQuery = trpc.sites.listLocationAssignments.useQuery(
    { siteId: siteForLocations?.id ?? '' },
    { enabled: !!siteForLocations?.id }
  );

  const createMutation = trpc.sites.create.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('sites.toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:sites.toast.createError' }),
  });

  const updateMutation = trpc.sites.update.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('sites.toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:sites.toast.updateError' }),
  });

  const deleteMutation = trpc.sites.delete.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      setSiteToDelete(null);
      toast.success({ title: t('sites.toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:sites.toast.deleteError' }),
  });

  const replaceLocationsMutation = trpc.sites.replaceLocationAssignments.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.sites.listLocationAssignments.invalidate(),
      ]);
      setSiteForLocations(null);
      toast.success({ title: t('sites.toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:sites.toast.updateError' }),
  });

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSite(null);
  };

  const handleCloseLocationsModal = () => {
    setSiteForLocations(null);
    replaceLocationsMutation.reset();
  };

  const handleOpenCreate = () => {
    setEditingSite(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (site: Site) => {
    setEditingSite(site);
    setIsModalOpen(true);
  };

  const handleOpenLocations = (site: Site) => {
    setSiteForLocations(site);
  };

  const onSubmit = async (values: SiteFormValues) => {
    if (!company) {
      return;
    }

    if (editingSite) {
      await updateMutation.mutateAsync({
        id: editingSite.id,
        companyId: company.id,
        name: values.name,
        address: values.address || null,
        phone: values.phone || null,
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      companyId: company.id,
      name: values.name,
      address: values.address || null,
      phone: values.phone || null,
      isActive: values.isActive,
    });
  };

  const onSubmitLocations = async (locationIds: string[]) => {
    if (!siteForLocations) {
      return;
    }

    await replaceLocationsMutation.mutateAsync({
      siteId: siteForLocations.id,
      locationIds,
    });
  };

  const columns = createSiteColumns({
    t,
    canManage,
    onEdit: handleOpenEdit,
    onDelete: setSiteToDelete,
    onManageLocations: handleOpenLocations,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{t('sites.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('sites.description')}
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={handleOpenCreate}
          disabled={!company || !canManage}
        >
          <Plus className="h-5 w-5" />
          {t('sites.add')}
        </button>
      </div>

      {!companyQuery.isLoading && !company && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('sites.noCompany')}
        </div>
      )}

      <div className="card p-6">
        {sitesQuery.isLoading && <TableLoadingState message={t('sites.loading')} />}
        {sitesQuery.error && (
          <TableErrorState
            title={t('sites.error')}
            message={sitesQuery.error.message}
            onRetry={() => {
              void sitesQuery.refetch();
            }}
          />
        )}
        {!sitesQuery.isLoading && !sitesQuery.error && (
          <DataTable
            columns={columns}
            data={sites}
            searchKey="name"
            searchPlaceholder={t('sites.search')}
            pageSize={10}
          />
        )}
      </div>

      <SiteFormModal
        key={editingSite?.id ?? 'new-site'}
        company={company}
        isOpen={isModalOpen}
        site={editingSite}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={onSubmit}
      />

      <SiteLocationAssignmentsModal
        key={`${siteForLocations?.id ?? 'site-locations'}-${siteLocationAssignmentsQuery.data?.locationIds.join(',') ?? 'loading'}`}
        isOpen={!!siteForLocations && !!siteLocationAssignmentsQuery.data}
        site={siteForLocations}
        locations={locations}
        initialLocationIds={siteLocationAssignmentsQuery.data?.locationIds ?? []}
        isSaving={replaceLocationsMutation.isPending}
        error={replaceLocationsMutation.error?.message ?? null}
        onClose={handleCloseLocationsModal}
        onSubmit={onSubmitLocations}
      />

      <Modal
        isOpen={!!siteForLocations && siteLocationAssignmentsQuery.isLoading}
        onClose={handleCloseLocationsModal}
        title={siteForLocations ? `${t('sites.locations.manage')} ${siteForLocations.name}` : t('sites.locations.title')}
        size="sm"
      >
        <div className="py-4 text-sm text-secondary-600">{t('sites.locations.loading')}</div>
      </Modal>

      <Modal
        isOpen={!!siteForLocations && !!siteLocationAssignmentsQuery.error}
        onClose={handleCloseLocationsModal}
        title={siteForLocations ? `${t('sites.locations.manage')} ${siteForLocations.name}` : t('sites.locations.title')}
        size="sm"
      >
        <div className="py-4 text-sm text-danger-600">
          {siteLocationAssignmentsQuery.error?.message ?? t('sites.locations.error')}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!siteToDelete}
        onClose={() => setSiteToDelete(null)}
        onConfirm={() => {
          if (siteToDelete) {
            void deleteMutation.mutateAsync({ id: siteToDelete.id });
          }
        }}
        title={t('sites.delete.title')}
        message={siteToDelete ? t('sites.delete.description') : ''}
        confirmText={deleteMutation.isPending ? t('sites.delete.submitting') : t('sites.delete.confirm')}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
