import { useTranslation } from 'react-i18next';
import { LifeBuoy, Store } from 'lucide-react';

import { ProgressiveTaskNavigation } from '@/components/experience';
import {
  OPERATIONS_ADVANCED_TAB_GROUPS,
  OPERATIONS_TAB_TRANSLATION_KEYS,
  type OperationsTabKey,
} from './operationsNavigationModel';

interface OperationsNavigationProps {
  activeTab: OperationsTabKey;
  onTabChange: (tab: OperationsTabKey) => void;
}

/** Operations-specific copy and destinations for the shared progressive task navigation. */
export function OperationsNavigation({
  activeTab,
  onTabChange,
}: OperationsNavigationProps): React.ReactElement {
  const { t } = useTranslation('operations');

  return (
    <ProgressiveTaskNavigation
      ariaLabel={t('navigation.ariaLabel')}
      activeItem={activeTab}
      primary={{
        id: 'attention',
        title: t('navigation.statusTitle'),
        description: t('navigation.statusDescription'),
        icon: Store,
        testId: 'operations-tab-attention',
      }}
      advanced={{
        title: t('navigation.supportTitle'),
        description: t('navigation.supportDescription'),
        icon: LifeBuoy,
        disclosureId: 'operations-support-tools',
        toggleTestId: 'operations-support-toggle',
        panelTestId: 'operations-support-tools',
        columnsClassName: 'lg:grid-cols-2',
        groups: OPERATIONS_ADVANCED_TAB_GROUPS.map(group => ({
          id: group.id,
          label: t(group.labelKey),
          items: group.tabs.map(tab => ({
            id: tab,
            label: t(OPERATIONS_TAB_TRANSLATION_KEYS[tab]),
            testId: `operations-tab-${tab}`,
          })),
        })),
      }}
      onItemChange={onTabChange}
    />
  );
}
