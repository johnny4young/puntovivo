import { useTranslation } from 'react-i18next';
import { Compass, Settings2 } from 'lucide-react';

import { ProgressiveTaskNavigation } from '@/components/experience';
import {
  COMPANY_SETUP_TAB_GROUPS,
  COMPANY_TAB_TRANSLATION_KEYS,
  type CompanyTabKey,
} from './companySetupModel';

interface CompanySetupNavigationProps {
  activeTab: CompanyTabKey;
  onTabChange: (tab: CompanyTabKey) => void;
}

/** Company-specific copy and destinations for the shared progressive task navigation. */
export function CompanySetupNavigation({
  activeTab,
  onTabChange,
}: CompanySetupNavigationProps): React.ReactElement {
  const { t } = useTranslation('settings');

  return (
    <ProgressiveTaskNavigation
      ariaLabel={t('company.tabs.ariaLabel')}
      activeItem={activeTab}
      primary={{
        id: 'readiness',
        title: t('company.setupNavigation.guideTitle'),
        description: t('company.setupNavigation.guideDescription'),
        icon: Compass,
        testId: 'company-tab-readiness',
      }}
      advanced={{
        title: t('company.setupNavigation.advancedTitle'),
        description: t('company.setupNavigation.advancedDescription'),
        icon: Settings2,
        disclosureId: 'company-advanced-settings',
        toggleTestId: 'company-advanced-toggle',
        panelTestId: 'company-advanced-settings',
        columnsClassName: 'lg:grid-cols-3',
        groups: COMPANY_SETUP_TAB_GROUPS.map(group => ({
          id: group.id,
          label: t(group.labelKey),
          items: group.tabs.map(tab => ({
            id: tab,
            label: t(COMPANY_TAB_TRANSLATION_KEYS[tab]),
            testId: `company-tab-${tab}`,
          })),
        })),
      }}
      onItemChange={onTabChange}
    />
  );
}
