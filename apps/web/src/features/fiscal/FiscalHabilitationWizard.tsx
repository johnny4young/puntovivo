import { useTranslation } from 'react-i18next';
import { FileKey } from 'lucide-react';

/**
 * ENG-020 Fase A — placeholder for the DIAN habilitación wizard.
 *
 * A real wizard (captures NIT, DIAN resolution id, technical key, p12
 * certificate upload, passphrase) arrives in ENG-021 together with
 * the live Proveedor Tecnológico adapter. Until then, admins see a
 * gated card explaining why the flow is not yet available.
 */
export function FiscalHabilitationWizard() {
  const { t } = useTranslation('fiscal');
  return (
    <section className="card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-state-warning-soft text-state-warning">
          <FileKey className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="page-kicker">{t('wizard.kicker')}</p>
          <h2 className="text-lg font-semibold text-secondary-900">{t('wizard.title')}</h2>
          <p className="text-sm text-secondary-600">{t('wizard.description')}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-state-warning">
            {t('wizard.gated')}
          </p>
        </div>
      </div>
    </section>
  );
}
