import { useTranslation } from 'react-i18next';

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

/** ENG-178 — Grouped company setup navigation. */
export function CompanySetupNavigation({
  activeTab,
  onTabChange,
}: CompanySetupNavigationProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <nav className="company-setup-nav" aria-label={t('company.tabs.ariaLabel')}>
      <button
        type="button"
        className={cn(
          'setup-nav-readiness',
          activeTab === 'readiness' && 'setup-nav-readiness-active'
        )}
        aria-current={activeTab === 'readiness' ? 'page' : undefined}
        onClick={() => onTabChange('readiness')}
        data-testid="company-tab-readiness"
      >
        {t(COMPANY_TAB_TRANSLATION_KEYS.readiness)}
      </button>

      {COMPANY_SETUP_TAB_GROUPS.map(group => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`setup-group-${group.id}`}
          className="setup-nav-group"
        >
          <p id={`setup-group-${group.id}`} className="setup-nav-group-label">
            {t(group.labelKey)}
          </p>
          <div className="setup-nav-group-items">
            {group.tabs.map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  className={cn('setup-nav-item', isActive && 'setup-nav-item-active')}
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
    </nav>
  );
}
