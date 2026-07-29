import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Compass, Settings2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  COMPANY_SETUP_TAB_GROUPS,
  COMPANY_TAB_TRANSLATION_KEYS,
  type CompanyTabKey,
} from './companySetupModel';

interface CompanySetupNavigationProps {
  activeTab: CompanyTabKey;
  onTabChange: (tab: CompanyTabKey) => void;
}

/**
 * Keeps the novice path dominant while preserving every legacy deep link
 * behind one explicit advanced disclosure.
 */
export function CompanySetupNavigation({
  activeTab,
  onTabChange,
}: CompanySetupNavigationProps): React.ReactElement {
  const { t } = useTranslation('settings');
  const isAdvancedTab = activeTab !== 'readiness';
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const advancedOpen = isAdvancedTab || advancedExpanded;

  const openGuide = (): void => {
    setAdvancedExpanded(false);
    onTabChange('readiness');
  };

  const toggleAdvanced = (): void => {
    if (isAdvancedTab) {
      setAdvancedExpanded(false);
      onTabChange('readiness');
      return;
    }
    setAdvancedExpanded(current => !current);
  };

  return (
    <nav
      className="rounded-[1.5rem] border border-line bg-card p-3 shadow-[0_20px_60px_-52px_rgba(15,23,42,0.75)]"
      aria-label={t('company.tabs.ariaLabel')}
    >
      <div className="grid gap-2 lg:grid-cols-2">
        <button
          type="button"
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
            activeTab === 'readiness'
              ? 'border-primary-300 bg-primary-50/80 text-primary-950'
              : 'border-transparent bg-surface-2/60 text-secondary-700 hover:border-line hover:bg-surface-2'
          )}
          aria-current={activeTab === 'readiness' ? 'page' : undefined}
          onClick={openGuide}
          data-testid="company-tab-readiness"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-950 text-white shadow-sm">
            <Compass className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              {t('company.setupNavigation.guideTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {t('company.setupNavigation.guideDescription')}
            </span>
          </span>
        </button>

        <button
          type="button"
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
            isAdvancedTab
              ? 'border-secondary-300 bg-secondary-100/80 text-secondary-950'
              : 'border-transparent bg-surface-2/60 text-secondary-700 hover:border-line hover:bg-surface-2'
          )}
          aria-expanded={advancedOpen}
          aria-controls="company-advanced-settings"
          onClick={toggleAdvanced}
          data-testid="company-advanced-toggle"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-secondary-200 bg-white text-secondary-700 shadow-sm">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {t('company.setupNavigation.advancedTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {t('company.setupNavigation.advancedDescription')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-secondary-500 transition-transform',
              advancedOpen && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {advancedOpen && (
        <div
          id="company-advanced-settings"
          className="mt-3 grid gap-4 rounded-2xl border border-line bg-surface-2/50 p-4 lg:grid-cols-3"
          data-testid="company-advanced-settings"
        >
          {COMPANY_SETUP_TAB_GROUPS.map(group => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`setup-group-${group.id}`}
              className="min-w-0"
            >
              <p
                id={`setup-group-${group.id}`}
                className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-secondary-500"
              >
                {t(group.labelKey)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.tabs.map(tab => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      className={cn(
                        'min-h-11 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'border-primary-800 bg-primary-950 text-white'
                          : 'border-secondary-200 bg-white text-secondary-700 hover:border-primary-200 hover:text-primary-900'
                      )}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onTabChange(tab)}
                      data-testid={`company-tab-${tab}`}
                    >
                      {t(COMPANY_TAB_TRANSLATION_KEYS[tab])}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
