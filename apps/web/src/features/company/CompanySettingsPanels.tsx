import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { translateServerError } from '@/lib/translateServerError';
import type { Company } from '@/types';
import { CompanyAISettingsCard } from './CompanyAISettingsCard';
import { CompanyAutoUpdateCard } from './CompanyAutoUpdateCard';
import { CompanyClFiscalCard } from './CompanyClFiscalCard';
import { CompanyCoFiscalCard } from './CompanyCoFiscalCard';
import { CompanyLocaleSettingsCard } from './CompanyLocaleSettingsCard';
import { CompanyModulesCard } from './CompanyModulesCard';
import { CompanyMxFiscalCard } from './CompanyMxFiscalCard';
import { CompanyPaymentsCard } from './CompanyPaymentsCard';
import { CompanyProfileSettings, type CompanyFormValues } from './CompanyProfileSettings';
import { CompanyPrintSettingsCard } from './CompanyPrintSettingsCard';
import { CompanyReadinessCard } from './CompanyReadinessCard';
import { CompanyRestaurantSettingsCard } from './CompanyRestaurantSettingsCard';
import { COMPANY_TAB_TRANSLATION_KEYS, type CompanyTabKey } from './companySetupModel';
import { CompanySyncCard } from './CompanySyncCard';
import { CompanyTelemetryCard } from './CompanyTelemetryCard';
import { CompanyDataRetentionCard } from './CompanyDataRetentionCard';
import { CompanyThemeSettingsCard } from './CompanyThemeSettingsCard';
import { CompanyTraySettingsCard } from './CompanyTraySettingsCard';

// backup and recovery modals are needed only on the data tab.
// Keep that security-heavy surface out of the initial Company route chunk.
// loyalty program admin card, lazy for the same chunk reason.
const CompanyLoyaltySettingsCard = lazy(() =>
  import('./CompanyLoyaltySettingsCard').then(module => ({
    default: module.CompanyLoyaltySettingsCard,
  }))
);
const CompanyBackupCard = lazy(() =>
  import('./CompanyBackupCard').then(module => ({ default: module.CompanyBackupCard }))
);

// checkout policy controls are needed only on the Controls tab.
// Keep the editor and critical-mutation rail out of the initial Company chunk.
const CompanyLossPreventionCard = lazy(() =>
  import('./CompanyLossPreventionCard').then(module => ({
    default: module.CompanyLossPreventionCard,
  }))
);

interface CompanySettingsPanelsProps {
  activeTab: CompanyTabKey;
  company: Company | null;
  isSaving: boolean;
  saveError: string | null;
  tenantCountryCode: string | null;
  isLocaleLoading: boolean;
  localeError: unknown;
  onLocaleRetry: () => void;
  onSubmit: (values: CompanyFormValues) => Promise<void>;
}

/** Admin-only company setup panel rendering. */
export function CompanySettingsPanels({
  activeTab,
  company,
  isSaving,
  saveError,
  tenantCountryCode,
  isLocaleLoading,
  localeError,
  onLocaleRetry,
  onSubmit,
}: CompanySettingsPanelsProps): React.ReactElement {
  const { t } = useTranslation(['settings', 'fiscal']);

  return (
    <section
      role="region"
      aria-label={t(COMPANY_TAB_TRANSLATION_KEYS[activeTab])}
      data-testid={`company-tabpanel-${activeTab}`}
    >
      {activeTab === 'readiness' && (
        <div className="space-y-6">
          <CompanyReadinessCard />
        </div>
      )}

      {activeTab === 'general' && (
        <div className="space-y-6">
          <CompanyProfileSettings
            key={company?.id ?? 'new-company'}
            company={company}
            canEdit
            isSaving={isSaving}
            error={saveError}
            includeCashClose
            onSubmit={onSubmit}
          />
          <Suspense
            fallback={
              <div
                className="h-48 animate-pulse rounded-2xl border border-line bg-surface"
                role="status"
                aria-label={t('company.loyalty.title')}
              />
            }
          >
            <CompanyLoyaltySettingsCard />
          </Suspense>
        </div>
      )}

      {activeTab === 'locale' && (
        <div className="space-y-6">
          <CompanyLocaleSettingsCard />
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="space-y-6">
          <Suspense
            fallback={
              <div
                className="h-72 animate-pulse rounded-2xl border border-line bg-surface-2"
                role="status"
                aria-label={t('company.lossPrevention.loading')}
              />
            }
          >
            <CompanyLossPreventionCard />
          </Suspense>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="space-y-6">
          <CompanySyncCard />
          <CompanyDataRetentionCard />
          <Suspense
            fallback={
              <div
                className="h-56 animate-pulse rounded-2xl border border-line bg-surface-2"
                role="status"
                aria-label={t('company.backup.title')}
              />
            }
          >
            <CompanyBackupCard />
          </Suspense>
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
          {isLocaleLoading && (
            <PageLoadingState
              title={t('fiscal:settings.tabTitle')}
              description={t('fiscal:settings.tabDescription')}
            />
          )}
          {localeError !== null && localeError !== undefined && (
            <QueryErrorState
              title={t('fiscal:settings.tabTitle')}
              message={translateServerError(localeError, t, t('errors:server.unknown'))}
              onRetry={onLocaleRetry}
            />
          )}
          {!isLocaleLoading && (localeError === null || localeError === undefined) && (
            <>
              {/*
                 +  — dispatch por país. Cada card se monta
                solamente para su país; no existe fallback con forma Colombia.
              */}
              {tenantCountryCode === 'MX' && <CompanyMxFiscalCard />}
              {tenantCountryCode === 'CL' && <CompanyClFiscalCard />}
              {tenantCountryCode === 'CO' && <CompanyCoFiscalCard />}
              {tenantCountryCode !== null && !['MX', 'CL', 'CO'].includes(tenantCountryCode) && (
                <div className="card space-y-2 p-6">
                  {/* explicit unsupported-country state. */}
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
  );
}
