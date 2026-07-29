import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LifeBuoy, Store } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  OPERATIONS_ADVANCED_TAB_GROUPS,
  OPERATIONS_TAB_TRANSLATION_KEYS,
  type OperationsTabKey,
} from './operationsNavigationModel';

interface OperationsNavigationProps {
  activeTab: OperationsTabKey;
  onTabChange: (tab: OperationsTabKey) => void;
}

/**
 * Keeps the ordinary store-status path dominant while preserving technical
 * recovery and evidence behind one explicit administrator disclosure.
 */
export function OperationsNavigation({
  activeTab,
  onTabChange,
}: OperationsNavigationProps): React.ReactElement {
  const { t } = useTranslation('operations');
  const isAdvancedTab = activeTab !== 'attention';
  const [supportExpanded, setSupportExpanded] = useState(false);
  const supportOpen = isAdvancedTab || supportExpanded;

  const openStoreStatus = (): void => {
    setSupportExpanded(false);
    onTabChange('attention');
  };

  const toggleSupport = (): void => {
    if (isAdvancedTab) {
      setSupportExpanded(false);
      onTabChange('attention');
      return;
    }
    setSupportExpanded(current => !current);
  };

  return (
    <nav
      className="rounded-[1.5rem] border border-line bg-card p-3 shadow-[0_20px_60px_-52px_rgba(15,23,42,0.75)]"
      aria-label={t('navigation.ariaLabel')}
    >
      <div className="grid gap-2 lg:grid-cols-2">
        <button
          type="button"
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
            activeTab === 'attention'
              ? 'border-primary-300 bg-primary-50/80 text-primary-950'
              : 'border-transparent bg-surface-2/60 text-secondary-700 hover:border-line hover:bg-surface-2'
          )}
          aria-current={activeTab === 'attention' ? 'page' : undefined}
          onClick={openStoreStatus}
          data-testid="operations-tab-attention"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-950 text-white shadow-sm">
            <Store className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('navigation.statusTitle')}</span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {t('navigation.statusDescription')}
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
          aria-expanded={supportOpen}
          aria-controls="operations-support-tools"
          onClick={toggleSupport}
          data-testid="operations-support-toggle"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-secondary-200 bg-white text-secondary-700 shadow-sm">
            <LifeBuoy className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t('navigation.supportTitle')}</span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {t('navigation.supportDescription')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-secondary-500 transition-transform',
              supportOpen && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {supportOpen && (
        <div
          id="operations-support-tools"
          className="mt-3 grid gap-4 rounded-2xl border border-line bg-surface-2/50 p-4 lg:grid-cols-2"
          data-testid="operations-support-tools"
        >
          {OPERATIONS_ADVANCED_TAB_GROUPS.map(group => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`operations-group-${group.id}`}
              className="min-w-0"
            >
              <p
                id={`operations-group-${group.id}`}
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
                      data-testid={`operations-tab-${tab}`}
                    >
                      {t(OPERATIONS_TAB_TRANSLATION_KEYS[tab])}
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
