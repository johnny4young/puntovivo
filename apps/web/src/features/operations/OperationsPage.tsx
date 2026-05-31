import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncHealthPanel } from './SyncHealthPanel';
import { FiscalHealthPanel } from './FiscalHealthPanel';
import { DeviceHealthPanel } from './DeviceHealthPanel';
import { CashHealthPanel } from './CashHealthPanel';
import { PaymentHealthPanel } from './PaymentHealthPanel';
import { InventoryHealthPanel } from './InventoryHealthPanel';
import { DiagnosticExportPanel } from './DiagnosticExportPanel';
import { AuthorityHealthPanel } from './AuthorityHealthPanel';

/**
 * ENG-065a / ENG-065b / ENG-065c — Operations Center.
 *
 * Tabbed admin/manager surface that surfaces the three already-shipped
 * outboxes (sync, fiscal, hardware) plus the two reconciliation views
 * shipped in ENG-065b (cash + inventory) and the diagnostic export
 * shipped in ENG-065c, the authority-node panel (ENG-075) and the
 * payment reconciliation foundation (ENG-038).
 *
 * Tab state is URL-driven
 * (`?tab=sync|fiscal|device|cash|payments|inventory|diagnostics|authority`)
 * so deep links from elsewhere in the app (e.g. an alert banner
 * pointing at a specific failure surface) land directly on the right
 * panel without manual navigation. `replace: true` keeps the back
 * button quiet.
 */
const TAB_KEYS = [
  'sync',
  'fiscal',
  'device',
  'cash',
  'payments',
  'inventory',
  'diagnostics',
  'authority',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

export function OperationsPage() {
  const { t } = useTranslation('operations');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : 'sync';

  function handleTabChange(next: TabKey): void {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'sync') {
      nextParams.delete('tab'); // default tab keeps the URL clean
    } else {
      nextParams.set('tab', next);
    }
    setSearchParams(nextParams, { replace: true });
  }

  const tabLabels: Record<TabKey, string> = useMemo(
    () => ({
      sync: t('tabs.sync'),
      fiscal: t('tabs.fiscal'),
      device: t('tabs.device'),
      cash: t('tabs.cash'),
      payments: t('tabs.payments'),
      inventory: t('tabs.inventory'),
      diagnostics: t('tabs.diagnostics'),
      authority: t('tabs.authority'),
    }),
    [t]
  );

  return (
    <div className="space-y-6">
      {/* Rediseño FASE 6 (O1) — encabezado de panel con titulación del
          sistema (.pv-kicker / .pv-title) + glifo tonal. El h1 se conserva
          para mantener el contrato de jerarquía semántica del shell. */}
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
          <Activity className="h-5 w-5" />
        </span>
        <div>
          <p className="pv-kicker">{t('header.kicker')}</p>
          <h1 className="pv-title text-2xl">{t('header.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">{t('header.subtitle')}</p>
        </div>
      </header>

      <nav className="segmented-control" role="tablist" aria-label={t('tabs.ariaLabel')}>
        {TAB_KEYS.map(key => {
          const selected = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`operations-tabpanel-${key}`}
              id={`operations-tab-${key}`}
              tabIndex={selected ? 0 : -1}
              className={cn('segmented-tab', selected && 'segmented-tab-active')}
              onClick={() => handleTabChange(key)}
              data-testid={`operations-tab-${key}`}
            >
              {tabLabels[key]}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id={`operations-tabpanel-${activeTab}`}
        aria-labelledby={`operations-tab-${activeTab}`}
        data-testid={`operations-tabpanel-${activeTab}`}
      >
        {activeTab === 'sync' && <SyncHealthPanel />}
        {activeTab === 'fiscal' && <FiscalHealthPanel />}
        {activeTab === 'device' && <DeviceHealthPanel />}
        {activeTab === 'cash' && <CashHealthPanel />}
        {activeTab === 'payments' && <PaymentHealthPanel />}
        {activeTab === 'inventory' && <InventoryHealthPanel />}
        {activeTab === 'diagnostics' && <DiagnosticExportPanel />}
        {activeTab === 'authority' && <AuthorityHealthPanel />}
      </div>
    </div>
  );
}
