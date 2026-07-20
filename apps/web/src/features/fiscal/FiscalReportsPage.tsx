import { useTranslation } from 'react-i18next';
import { FiscalHabilitationWizard } from './FiscalHabilitationWizard';

/**
 * estado actual — shell for the future fiscal reports page.
 *
 * Aggregate reporting (daily DIAN summary, contingency queue depth,
 * PT round-trip latency, tax breakdown by category) lands in
 * . For now the page renders the habilitación wizard so
 * admins land somewhere useful + the "coming soon" empty state for
 * the report grid itself.
 */
export function FiscalReportsPage() {
  const { t } = useTranslation('fiscal');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-secondary-900">{t('reports.title')}</h1>

      <FiscalHabilitationWizard />

      <div className="card p-6">
        <p className="text-sm text-secondary-500">{t('reports.empty')}</p>
      </div>
    </div>
  );
}
