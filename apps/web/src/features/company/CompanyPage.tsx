import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { UserRole } from '@/types';
import { CompanyProfileSettings, type CompanyFormValues } from './CompanyProfileSettings';
import { CompanySettingsPanels } from './CompanySettingsPanels';
import { type CompanyTabKey, isCompanyTabKey } from './companySetupModel';
import { CompanySetupNavigation } from './CompanySetupNavigation';

function canManageCompany(role: UserRole | undefined): boolean {
  return role === 'admin';
}

/** Company setup query, mutation, role, and URL-state coordinator. */
export function CompanyPage(): React.ReactElement {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const company = companyQuery.data ?? null;
  const canEdit = canManageCompany(user?.role);

  // el tab Fiscal despacha la card por país. Reusamos
  // el query que LocaleProvider ya hace al boot; react-query dedupe
  // la trae de cache en este punto.
  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountryCode = localeQuery.data?.countryCode ?? null;

  // tab state remains URL-driven so deep links such as
  // /company?tab=ai open the intended panel without extra navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // admins default to readiness; other allowed roles retain
  // the legacy general-form landing.
  const defaultTab: CompanyTabKey = canEdit ? 'readiness' : 'general';
  const activeTab: CompanyTabKey = isCompanyTabKey(tabParam) ? tabParam : defaultTab;

  const upsertMutation = trpc.companies.upsert.useMutation({
    onSuccess: async savedCompany => {
      await utils.companies.getCurrent.setData(undefined, savedCompany);
      toast.success({ title: t('company.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.toast.saveError',
    }),
  });

  const handleSubmit = async (values: CompanyFormValues): Promise<void> => {
    if (!canEdit) return;

    await upsertMutation.mutateAsync({
      name: values.name,
      taxId: values.taxId || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    });
  };

  const handleTabChange = (nextTab: CompanyTabKey): void => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === defaultTab) {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const saveError = upsertMutation.error
    ? translateServerError(upsertMutation.error, t, t('errors:server.unknown'))
    : null;

  return (
    <div className="space-y-6">
      {!companyQuery.isLoading && !companyQuery.error && (
        <h1 className="text-2xl font-bold text-secondary-900">{t('company.title')}</h1>
      )}

      {companyQuery.isLoading && (
        <PageLoadingState title={t('company.title')} description={t('company.loading')} />
      )}
      {companyQuery.error && (
        <QueryErrorState
          title={t('company.error')}
          message={translateServerError(companyQuery.error, t, t('errors:server.unknown'))}
          onRetry={() => {
            void companyQuery.refetch();
          }}
        />
      )}

      {!companyQuery.isLoading && !companyQuery.error && (
        <>
          {/* Non-admin users keep the read-only company form and logo library. */}
          {!canEdit && (
            <CompanyProfileSettings
              key={company?.id ?? 'new-company'}
              company={company}
              canEdit={false}
              isSaving={upsertMutation.isPending}
              error={saveError}
              onSubmit={handleSubmit}
            />
          )}

          {canEdit && (
            <>
              {/* grouped Setup nav keeps readiness pinned and
                  preserves the existing ?tab= URL contract. */}
              <CompanySetupNavigation activeTab={activeTab} onTabChange={handleTabChange} />
              <CompanySettingsPanels
                activeTab={activeTab}
                company={company}
                isSaving={upsertMutation.isPending}
                saveError={saveError}
                tenantCountryCode={tenantCountryCode}
                isLocaleLoading={localeQuery.isLoading}
                localeError={localeQuery.error}
                onLocaleRetry={() => {
                  void localeQuery.refetch();
                }}
                onSubmit={handleSubmit}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
