import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { PartyImportWorkflow } from './PartyImportWorkflow';
import { ProductImportWorkflow } from './ProductImportWorkflow';
import type { ImportEntity } from './partyImportMapping';

const IMPORT_ENTITIES: ImportEntity[] = ['products', 'customers', 'providers'];

export function DataImportPage() {
  const { t } = useTranslation('dataImport');
  const [entity, setEntity] = useState<ImportEntity>('products');
  const [isWorkflowBusy, setIsWorkflowBusy] = useState(false);

  return (
    <div className="space-y-6" data-testid="data-import-page">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">
          {t('kicker')}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-secondary-900">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>

      <section className="card p-2" aria-labelledby="data-import-entity-title">
        <h2 id="data-import-entity-title" className="sr-only">
          {t('entitySelector.label')}
        </h2>
        <div
          className="grid gap-2 sm:grid-cols-3"
          role="group"
          aria-label={t('entitySelector.label')}
        >
          {IMPORT_ENTITIES.map(item => (
            <button
              key={item}
              type="button"
              className={cn(
                'rounded-lg px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                entity === item
                  ? 'bg-primary-50 text-primary-900 ring-1 ring-primary-200'
                  : 'text-secondary-700 hover:bg-secondary-50'
              )}
              aria-pressed={entity === item}
              disabled={isWorkflowBusy}
              onClick={() => {
                if (!isWorkflowBusy) setEntity(item);
              }}
            >
              <span className="block text-sm font-semibold">{t(`entities.${item}.label`)}</span>
              <span className="mt-1 block text-xs text-secondary-500">
                {t(`entities.${item}.description`)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {entity === 'products' ? (
        <ProductImportWorkflow key={entity} onBusyChange={setIsWorkflowBusy} />
      ) : (
        <PartyImportWorkflow key={entity} entity={entity} onBusyChange={setIsWorkflowBusy} />
      )}
    </div>
  );
}
