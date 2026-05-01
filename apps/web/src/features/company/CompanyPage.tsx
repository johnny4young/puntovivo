import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2 as Building, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Company, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { cn } from '@/lib/utils';
import { CompanyAISettingsCard } from './CompanyAISettingsCard';
import { CompanyBackupCard } from './CompanyBackupCard';
import { CompanyClFiscalCard } from './CompanyClFiscalCard';
import { CompanyMxFiscalCard } from './CompanyMxFiscalCard';
import { CompanyLocaleSettingsCard } from './CompanyLocaleSettingsCard';
import { CompanyAutoUpdateCard } from './CompanyAutoUpdateCard';
import { CompanyLogoLibraryCard } from './CompanyLogoLibraryCard';
import { CompanyPrintSettingsCard } from './CompanyPrintSettingsCard';
import { CompanySyncCard } from './CompanySyncCard';
import { CompanyThemeSettingsCard } from './CompanyThemeSettingsCard';
import { CompanyTraySettingsCard } from './CompanyTraySettingsCard';

interface CompanyFormValues {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
}

const defaultValues: CompanyFormValues = {
  name: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
};

function mapCompanyToForm(company: Company | null | undefined): CompanyFormValues {
  if (!company) {
    return defaultValues;
  }

  return {
    name: company.name,
    taxId: company.taxId ?? '',
    address: company.address ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
  };
}

interface CompanyFormProps {
  company: Company | null;
  canEdit: boolean;
  isSaving: boolean;
  error: string | null;
  onSubmit: (values: CompanyFormValues) => Promise<void>;
}

function CompanyForm({ company, canEdit, isSaving, error, onSubmit }: CompanyFormProps) {
  const { t } = useTranslation('settings');
  const form = useForm<CompanyFormValues>({
    defaultValues: mapCompanyToForm(company),
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex items-center gap-3 rounded-xl bg-primary-50 px-4 py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Building className="h-5 w-5 text-primary-700" />
        </div>
        <div>
          <p className="font-medium text-secondary-900">
            {company?.name ?? t('company.createPrompt')}
          </p>
          <p className="text-sm text-secondary-500">
            {t('company.createNote')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="company-name" className="label">
            {t('company.fields.companyName')}
          </label>
          <input
            id="company-name"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('name', { required: t('company.fields.companyNameRequired') })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-tax-id" className="label">
            {t('company.fields.taxId')}
          </label>
          <input
            id="company-tax-id"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('taxId')}
          />
        </div>

        <div>
          <label htmlFor="company-email" className="label">
            {t('company.fields.email')}
          </label>
          <input
            id="company-email"
            type="email"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('company.fields.emailInvalid'),
              },
            })}
          />
          {form.formState.errors.email && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-phone" className="label">
            {t('company.fields.phone')}
          </label>
          <input
            id="company-phone"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('phone')}
          />
        </div>
      </div>

      <div>
        <label htmlFor="company-address" className="label">
          {t('company.fields.address')}
        </label>
        <textarea
          id="company-address"
          className="input mt-1 min-h-[96px]"
          disabled={!canEdit}
          {...form.register('address')}
        />
      </div>

      {error && <p className="text-sm text-danger-500">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving || !canEdit}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? t('company.submitting') : t('company.save')}
        </button>
      </div>
    </form>
  );
}

function canManageCompany(role: UserRole | undefined): boolean {
  return role === 'admin';
}

/**
 * Tab keys are stable English identifiers stored in the URL via
 * `?tab=...`. The visible label comes from the i18n namespace
 * (`settings:company.tabs.<key>`). Adding a new tab: append to this
 * tuple and add the matching localized label in en + es.
 */
const TAB_KEYS = ['general', 'locale', 'data', 'device', 'ai', 'fiscal'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

export function CompanyPage() {
  const { t } = useTranslation(['settings', 'fiscal']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const company = companyQuery.data ?? null;
  const canEdit = canManageCompany(user?.role);
  // ENG-036a — el tab Fiscal despacha la card por país. Reusamos
  // el query que LocaleProvider ya hace al boot; react-query dedupe
  // la trae de cache en este punto.
  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountryCode = localeQuery.data?.countryCode ?? 'CO';

  // ENG-045 — tab state. URL-driven so deep links from elsewhere in
  // the app (e.g. AnomalyDetectionCard's "Activa la IA en
  // Configuración" CTA → /company?tab=ai) land directly on the
  // intended panel without manual navigation. `replace: true` on
  // setSearchParams keeps the back button non-noisy.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : 'general';

  const upsertMutation = trpc.companies.upsert.useMutation({
    onSuccess: async company => {
      await utils.companies.getCurrent.setData(undefined, company);
      toast.success({ title: t('company.toast.saved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.toast.saveError' }),
  });

  const onSubmit = async (values: CompanyFormValues) => {
    if (!canEdit) {
      return;
    }

    await upsertMutation.mutateAsync({
      name: values.name,
      taxId: values.taxId || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    });
  };

  function handleTabChange(next: TabKey): void {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'general') {
      nextParams.delete('tab'); // keep the URL clean for the default
    } else {
      nextParams.set('tab', next);
    }
    setSearchParams(nextParams, { replace: true });
  }

  const tabLabels: Record<TabKey, string> = useMemo(
    () => ({
      general: t('company.tabs.general'),
      locale: t('company.tabs.locale'),
      data: t('company.tabs.data'),
      device: t('company.tabs.device'),
      ai: t('company.tabs.ai'),
      fiscal: t('company.tabs.fiscal'),
    }),
    [t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">{t('company.title')}</h1>
        <p className="mt-1 text-sm text-secondary-500">{t('company.description')}</p>
      </div>

      {companyQuery.isLoading && (
        <PageLoadingState
          title={t('company.title')}
          description={t('company.loading')}
        />
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
          {/* Non-admin users see only the company form + logos. The
              tab UI is admin-only because every other tab carries
              admin-only configuration cards. */}
          {!canEdit && (
            <div className="space-y-6">
              <div className="card p-6">
                <CompanyForm
                  key={company?.id ?? 'new-company'}
                  company={company}
                  canEdit={canEdit}
                  isSaving={upsertMutation.isPending}
                  error={
                    upsertMutation.error
                      ? translateServerError(upsertMutation.error, t, t('errors:server.unknown'))
                      : null
                  }
                  onSubmit={onSubmit}
                />
              </div>
              <CompanyLogoLibraryCard company={company} canEdit={canEdit} />
            </div>
          )}

          {canEdit && (
            <>
              <nav
                className="segmented-control"
                role="tablist"
                aria-label={t('company.tabs.ariaLabel')}
              >
                {TAB_KEYS.map(key => {
                  const selected = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`company-tabpanel-${key}`}
                      id={`company-tab-${key}`}
                      tabIndex={selected ? 0 : -1}
                      className={cn('segmented-tab', selected && 'segmented-tab-active')}
                      onClick={() => handleTabChange(key)}
                      data-testid={`company-tab-${key}`}
                    >
                      {tabLabels[key]}
                    </button>
                  );
                })}
              </nav>

              <div
                role="tabpanel"
                id={`company-tabpanel-${activeTab}`}
                aria-labelledby={`company-tab-${activeTab}`}
                data-testid={`company-tabpanel-${activeTab}`}
              >
                {activeTab === 'general' && (
                  <div className="space-y-6">
                    <div className="card p-6">
                      <CompanyForm
                        key={company?.id ?? 'new-company'}
                        company={company}
                        canEdit={canEdit}
                        isSaving={upsertMutation.isPending}
                        error={
                          upsertMutation.error
                            ? translateServerError(
                                upsertMutation.error,
                                t,
                                t('errors:server.unknown')
                              )
                            : null
                        }
                        onSubmit={onSubmit}
                      />
                    </div>
                    <CompanyLogoLibraryCard company={company} canEdit={canEdit} />
                  </div>
                )}

                {activeTab === 'locale' && (
                  <div className="space-y-6">
                    <CompanyLocaleSettingsCard />
                  </div>
                )}

                {activeTab === 'data' && (
                  <div className="space-y-6">
                    <CompanySyncCard />
                    <CompanyBackupCard />
                  </div>
                )}

                {activeTab === 'device' && (
                  <div className="grid gap-6 xl:grid-cols-2">
                    <CompanyThemeSettingsCard />
                    <CompanyTraySettingsCard />
                    <CompanyPrintSettingsCard />
                    <CompanyAutoUpdateCard />
                  </div>
                )}

                {activeTab === 'ai' && (
                  <div className="space-y-6">
                    <CompanyAISettingsCard />
                  </div>
                )}

                {activeTab === 'fiscal' && (
                  <div className="space-y-6">
                    {/*
                      ENG-035a + ENG-036a — dispatch por país. Cada
                      card asume internamente que se renderiza sólo
                      cuando aplica (defensive layer); aquí el page
                      hace el switch primario para evitar montar
                      varias cards a la vez.
                    */}
                    {tenantCountryCode === 'MX' && <CompanyMxFiscalCard />}
                    {tenantCountryCode === 'CL' && <CompanyClFiscalCard />}
                    {tenantCountryCode === 'CO' && (
                      <div className="card p-6 space-y-3">
                        <h2 className="text-lg font-semibold text-secondary-950">
                          {t('fiscal:settings.co.title')}
                        </h2>
                        <p className="text-sm text-secondary-600">
                          {t('fiscal:settings.co.comingSoon')}
                        </p>
                      </div>
                    )}
                    {!['MX', 'CL', 'CO'].includes(tenantCountryCode) && (
                      <div className="card p-6">
                        <p className="text-sm text-secondary-600">
                          {t('fiscal:settings.tabDescription')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
