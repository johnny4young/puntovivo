import { Database, FlaskConical, History, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import type { LaunchImportDataMode } from './types';

interface ImportModePanelProps {
  disabled: boolean;
  onSelect: (mode: LaunchImportDataMode) => void;
  selected: LaunchImportDataMode | null;
}

const MODES = [
  { key: 'demo', Icon: FlaskConical },
  { key: 'real', Icon: Database },
] as const;

export function ImportModePanel({ disabled, onSelect, selected }: ImportModePanelProps) {
  const { t } = useTranslation('dataImport');

  return (
    <section className="card space-y-4 p-6" aria-labelledby="data-import-mode-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
          {t('safety.kicker')}
        </p>
        <h2 id="data-import-mode-title" className="mt-1 text-lg font-semibold text-secondary-900">
          {t('safety.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('safety.description')}</p>
      </div>

      <div
        className="grid gap-3 md:grid-cols-2"
        role="radiogroup"
        aria-label={t('safety.modeLabel')}
      >
        {MODES.map(({ key, Icon }) => (
          <label
            key={key}
            className={cn(
              'relative rounded-xl border p-4 text-left transition-colors focus-within:ring-2 focus-within:ring-primary-300',
              selected === key
                ? 'border-primary-300 bg-primary-50 ring-1 ring-primary-200'
                : 'border-line bg-white',
              disabled
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:border-secondary-300 hover:bg-secondary-50'
            )}
          >
            <input
              type="radio"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              name="data-import-mode"
              value={key}
              checked={selected === key}
              disabled={disabled}
              onChange={() => onSelect(key)}
            />
            <span className="flex items-start gap-3">
              <span
                className={cn(
                  'rounded-lg p-2',
                  key === 'demo'
                    ? 'bg-primary-50 text-primary-700'
                    : 'bg-success-50 text-success-700'
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-secondary-900">
                  {t(`safety.modes.${key}.title`)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-secondary-600">
                  {t(`safety.modes.${key}.description`)}
                </span>
              </span>
            </span>
          </label>
        ))}
      </div>

      {selected === 'demo' ? (
        <div
          className="flex gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 text-primary-900"
          data-testid="data-import-demo-boundary"
          role="status"
        >
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{t('safety.demoBoundary.title')}</p>
            <p className="mt-1 text-xs leading-5">{t('safety.demoBoundary.description')}</p>
          </div>
        </div>
      ) : null}

      {selected === 'real' ? (
        <div
          className="rounded-xl border border-warning-200 bg-warning-50 p-4"
          data-testid="data-import-rollback-guidance"
        >
          <div className="flex gap-3">
            <History className="mt-0.5 h-5 w-5 shrink-0 text-warning-800" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-warning-950">{t('safety.rollback.title')}</p>
              <p className="mt-1 text-xs leading-5 text-warning-900">
                {t('safety.rollback.description')}
              </p>
              <p className="mt-2 text-xs leading-5 text-warning-900">
                {t('safety.rollback.scopeWarning')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className="pv-btn outline bg-white" to="/company">
                  {t('safety.rollback.openBackup')}
                </Link>
                <Link className="pv-btn outline bg-white" to="/audit-logs">
                  {t('safety.rollback.openAudit')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
