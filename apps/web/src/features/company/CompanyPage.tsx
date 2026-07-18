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
import { SimpleFormField } from '@/components/form-controls/FormField';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { cn } from '@/lib/utils';
import { CompanyAISettingsCard } from './CompanyAISettingsCard';
import { CompanyReadinessCard } from './CompanyReadinessCard';
import { CompanyBackupCard } from './CompanyBackupCard';
import { CompanyClFiscalCard } from './CompanyClFiscalCard';
import { CompanyCoFiscalCard } from './CompanyCoFiscalCard';
import { CompanyMxFiscalCard } from './CompanyMxFiscalCard';
import { CompanyPaymentsCard } from './CompanyPaymentsCard';
import { CompanyLocaleSettingsCard } from './CompanyLocaleSettingsCard';
import { CompanyAutoUpdateCard } from './CompanyAutoUpdateCard';
import { CompanyLogoLibraryCard } from './CompanyLogoLibraryCard';
import { CompanyCashCloseSettingsCard } from './CompanyCashCloseSettingsCard';
import { CompanyDiscountSettingsCard } from './CompanyDiscountSettingsCard';
import { CompanyModulesCard } from './CompanyModulesCard';
import { CompanyPrintSettingsCard } from './CompanyPrintSettingsCard';
import { CompanyRestaurantSettingsCard } from './CompanyRestaurantSettingsCard';
import { CompanySyncCard } from './CompanySyncCard';
import { CompanyTelemetryCard } from './CompanyTelemetryCard';
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

/**
 * Builds the `error` prop for SimpleFormField under
 * `exactOptionalPropertyTypes`: the prop is omitted entirely when there is
 * no message rather than passed as `undefined`.
 */
function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

function CompanyForm({ company, canEdit, isSaving, error, onSubmit }: CompanyFormProps) {
  const { t } = useTranslation('settings');
  const form = useForm<CompanyFormValues>({
    defaultValues: mapCompanyToForm(company),
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  const errors = form.formState.errors;

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex items-center gap-3 rounded-2xl border border-primary-200/55 bg-primary-50/55 px-4 py-3.5">
        <span className="pv-gt pv-gt-primary h-11 w-11">
          <Building className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium text-secondary-900">
            {company?.name ?? t('company.createPrompt')}
          </p>
          <p className="text-sm text-secondary-500">{t('company.createNote')}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SimpleFormField
          label={t('company.fields.companyName')}
          htmlFor="company-name"
          required
          {...errorProp(errors.name?.message)}
        >
          <input
            id="company-name"
            className={cn('pv-input', errors.name && 'error')}
            disabled={!canEdit}
            {...form.register('name', { required: t('company.fields.companyNameRequired') })}
          />
        </SimpleFormField>

        <SimpleFormField label={t('company.fields.taxId')} htmlFor="company-tax-id">
          <input
            id="company-tax-id"
            className="pv-input font-mono"
            disabled={!canEdit}
            {...form.register('taxId')}
          />
        </SimpleFormField>

        <SimpleFormField
          label={t('company.fields.email')}
          htmlFor="company-email"
          {...errorProp(errors.email?.message)}
        >
          <input
            id="company-email"
            type="email"
            className={cn('pv-input', errors.email && 'error')}
            disabled={!canEdit}
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('company.fields.emailInvalid'),
              },
            })}
          />
        </SimpleFormField>

        <SimpleFormField label={t('company.fields.phone')} htmlFor="company-phone">
          <input
            id="company-phone"
            className="pv-input font-mono"
            disabled={!canEdit}
            {...form.register('phone')}
          />
        </SimpleFormField>
      </div>

      <SimpleFormField label={t('company.fields.address')} htmlFor="company-address">
        <textarea
          id="company-address"
          className="pv-input area min-h-[96px]"
          disabled={!canEdit}
          {...form.register('address')}
        />
      </SimpleFormField>

      {error && (
        <p className="err-msg" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={isSaving || !canEdit} className="pv-btn primary">
          <Save className="h-4 w-4" aria-hidden="true" />
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
const TAB_KEYS = [
  // ENG-104 — readiness checklist first so a fresh admin lands here
  // by default (post-login routing in `AuthProvider` deep-links here
  // when `setupReadiness.get` reports unresolved blockers). The card
  // is opt-in for other roles via the segmented control; cashier
  // never reaches `/company` per existing role gating.
  'readiness',
  'general',
  'locale',
  'data',
  'device',
  'ai',
  'fiscal',
  'payments',
  'modules',
  // ENG-039d3 — restaurant settings tab (service charge today; future
  // table / KDS preferences land here too). Always-visible to admins;
  // the contents default to "service charge disabled" for retail
  // tenants so the new tab is harmless when unused.
  'restaurant',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

/**
 * ENG-188 — Setup nav grouping. The readiness hub is the pinned landing
 * (NOT part of any group); the remaining configuration tabs are demoted
 * into three labeled category groups so `/company` reads as a hierarchy
 * (readiness first, then the rest organized by theme) instead of a flat
 * equal-weight strip. Each entry's `tabs` is a subset of `TAB_KEYS`
 * minus `readiness`; the union across all groups MUST equal
 * `TAB_KEYS \ {'readiness'}` so every tab stays reachable. `id` resolves
 * its label via `settings:company.tabs.groups.<id>`.
 */
const SETUP_TAB_GROUPS = [
  { id: 'business', tabs: ['general', 'locale', 'restaurant'] },
  { id: 'billing', tabs: ['fiscal', 'payments'] },
  { id: 'system', tabs: ['modules', 'ai', 'data', 'device'] },
] as const satisfies ReadonlyArray<{ id: string; tabs: readonly TabKey[] }>;

/** Category-group identifiers used by the Setup grouped nav (ENG-188). */
type SetupTabGroupId = (typeof SETUP_TAB_GROUPS)[number]['id'];

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
  const tenantCountryCode = localeQuery.data?.countryCode ?? null;

  // ENG-045 — tab state. URL-driven so deep links from elsewhere in
  // the app (e.g. AnomalyDetectionCard's "Activa la IA en
  // Configuración" CTA → /company?tab=ai) land directly on the
  // intended panel without manual navigation. `replace: true` on
  // setSearchParams keeps the back button non-noisy.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // ENG-104 — admins default to the readiness checklist; managers
  // and other roles keep the legacy `general` default. Cashier never
  // reaches `/company` (role-gated route).
  const defaultTab: TabKey = canEdit ? 'readiness' : 'general';
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : defaultTab;

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
    if (next === defaultTab) {
      nextParams.delete('tab'); // keep the URL clean for the role default
    } else {
      nextParams.set('tab', next);
    }
    setSearchParams(nextParams, { replace: true });
  }

  const tabLabels: Record<TabKey, string> = useMemo(
    () => ({
      readiness: t('company.tabs.readiness'),
      general: t('company.tabs.general'),
      locale: t('company.tabs.locale'),
      data: t('company.tabs.data'),
      device: t('company.tabs.device'),
      ai: t('company.tabs.ai'),
      fiscal: t('company.tabs.fiscal'),
      payments: t('company.tabs.payments'),
      modules: t('company.tabs.modules'),
      restaurant: t('company.tabs.restaurant'),
    }),
    [t]
  );

  const groupLabels: Record<SetupTabGroupId, string> = useMemo(
    () => ({
      business: t('company.tabs.groups.business'),
      billing: t('company.tabs.groups.billing'),
      system: t('company.tabs.groups.system'),
    }),
    [t]
  );

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
              {/* ENG-188 — grouped Setup nav: the readiness hub is the
                  pinned landing, the remaining tabs are demoted into
                  labeled category groups. Modeled as a navigation (group
                  + aria-current) rather than a single tablist because it
                  is a categorized settings menu, not one flat tab strip.
                  The `?tab=` URL contract is unchanged. */}
              <nav className="company-setup-nav" aria-label={t('company.tabs.ariaLabel')}>
                <button
                  type="button"
                  className={cn(
                    'setup-nav-readiness',
                    activeTab === 'readiness' && 'setup-nav-readiness-active'
                  )}
                  aria-current={activeTab === 'readiness' ? 'page' : undefined}
                  onClick={() => handleTabChange('readiness')}
                  data-testid="company-tab-readiness"
                >
                  {tabLabels.readiness}
                </button>

                {SETUP_TAB_GROUPS.map(group => (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={`setup-group-${group.id}`}
                    className="setup-nav-group"
                  >
                    <p id={`setup-group-${group.id}`} className="setup-nav-group-label">
                      {groupLabels[group.id]}
                    </p>
                    <div className="setup-nav-group-items">
                      {group.tabs.map(key => {
                        const selected = activeTab === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={cn('setup-nav-item', selected && 'setup-nav-item-active')}
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => handleTabChange(key)}
                            data-testid={`company-tab-${key}`}
                          >
                            {tabLabels[key]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              <section
                role="region"
                aria-label={tabLabels[activeTab]}
                data-testid={`company-tabpanel-${activeTab}`}
              >
                {activeTab === 'readiness' && (
                  <div className="space-y-6">
                    <CompanyReadinessCard />
                  </div>
                )}

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
                    <CompanyCashCloseSettingsCard />
                    <CompanyDiscountSettingsCard />
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
                    <CompanyTelemetryCard />
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

                {activeTab === 'modules' && (
                  <div className="space-y-6">
                    <CompanyModulesCard />
                  </div>
                )}

                {activeTab === 'payments' && (
                  <div className="space-y-6">
                    <CompanyPaymentsCard />
                  </div>
                )}

                {activeTab === 'restaurant' && (
                  <div className="space-y-6">
                    <CompanyRestaurantSettingsCard />
                  </div>
                )}

                {activeTab === 'fiscal' && (
                  <div className="space-y-6">
                    {localeQuery.isLoading && (
                      <PageLoadingState
                        title={t('fiscal:settings.tabTitle')}
                        description={t('fiscal:settings.tabDescription')}
                      />
                    )}
                    {localeQuery.error && (
                      <QueryErrorState
                        title={t('fiscal:settings.tabTitle')}
                        message={translateServerError(
                          localeQuery.error,
                          t,
                          t('errors:server.unknown')
                        )}
                        onRetry={() => {
                          void localeQuery.refetch();
                        }}
                      />
                    )}
                    {!localeQuery.isLoading && !localeQuery.error && (
                      <>
                        {/*
                          ENG-035a + ENG-036a — dispatch por país. Cada
                          card asume internamente que se renderiza sólo
                          cuando aplica (defensive layer); aquí el page
                          hace el switch primario para evitar montar
                          varias cards a la vez.
                        */}
                        {tenantCountryCode === 'MX' && <CompanyMxFiscalCard />}
                        {tenantCountryCode === 'CL' && <CompanyClFiscalCard />}
                        {tenantCountryCode === 'CO' && <CompanyCoFiscalCard />}
                        {tenantCountryCode !== null &&
                          !['MX', 'CL', 'CO'].includes(tenantCountryCode) && (
                            <div className="card p-6 space-y-2">
                              {/* ENG-185 — be explicit: no fiscal pack for this
                                  country (no Colombia-shaped fallback). */}
                              <h2 className="text-lg font-semibold text-secondary-950">
                                {t('fiscal:settings.unsupported.title')}
                              </h2>
                              <p className="text-sm text-secondary-600">
                                {t('fiscal:settings.unsupported.description', {
                                  country: tenantCountryCode,
                                })}
                              </p>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
