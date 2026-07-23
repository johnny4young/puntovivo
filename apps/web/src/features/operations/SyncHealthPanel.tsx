import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  Laptop,
  RefreshCw,
  RotateCw,
  XCircle,
} from 'lucide-react';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';
import { Badge, KpiTile, StatusStrip } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { computeConflictDiff } from '@/features/company/companySyncDisplay';
import { useSyncSnapshot } from '@/features/company/useSyncSnapshot';

/**
 * Operations Center: Sync Health panel.
 *
 * Read-only mirror of the sync outbox + conflict state. Reads
 * `sync.pull` (the server doc calls it a "read-only mirror of
 * sync.status plus the actual row payloads"), aggregating pending /
 * retrying / failed counters, the last sync timestamp and the pending
 * conflict rows.
 *
 * The panel is intentionally read-only: pushing the queue, pulling a
 * fresh snapshot and resolving conflicts are write actions that live in
 * `<CompanySyncCard />` (mounted at Configuración → Empresa → Data). The
 * dedup between the two surfaces is a separate decision — this panel
 * only surfaces the health read so the operator knows where to look.
 *
 * recetas pv-*: KPIs con `KpiTile` (`.pv-kpi`,
 * conflictos y fallos pasan a `danger` cuando son > 0), conflictos
 * renderizados como diff legible local ↔ remoto (`.pv-diff`) con el
 * número de campos que difieren en un `Badge`, y estado vacío del
 * sistema (`EmptyState`) cuando todo está sincronizado. Encabezado de
 * panel con `.pv-kicker` / `.pv-title`.
 */

const CONFLICT_PREVIEW_LIMIT = 10;
const QUEUE_PREVIEW_LIMIT = 5;

const SYNC_ENTITY_LABEL_KEYS: Record<string, string> = {
  categories: 'sync.entities.categories',
  customers: 'sync.entities.customers',
  inventory_movements: 'sync.entities.inventoryMovements',
  locations: 'sync.entities.locations',
  location_x_site: 'sync.entities.locationSiteLinks',
  logos: 'sync.entities.logos',
  order_items: 'sync.entities.orderItems',
  orders: 'sync.entities.orders',
  person_types: 'sync.entities.personTypes',
  products: 'sync.entities.products',
  providers: 'sync.entities.providers',
  purchase_items: 'sync.entities.purchaseItems',
  purchase_return_items: 'sync.entities.purchaseReturnItems',
  purchase_returns: 'sync.entities.purchaseReturns',
  purchases: 'sync.entities.purchases',
  regime_types: 'sync.entities.regimeTypes',
  sale_items: 'sync.entities.saleItems',
  sale_returns: 'sync.entities.saleReturns',
  sales: 'sync.entities.sales',
  sequentials: 'sync.entities.sequentials',
  sites: 'sync.entities.sites',
  units: 'sync.entities.units',
  users: 'sync.entities.users',
  vat_rates: 'sync.entities.vatRates',
};

/**
 * Serializa un valor de payload a una cadena legible para el diff. No es
 * el render de un campo de negocio (eso vive en el flujo de resolución de
 * `CompanySyncCard`); aquí solo se compara y se muestra el cambio. Se pasa al
 * `computeConflictDiff` compartido; conserva la semántica original de este
 * panel (cadena vacía como `''`, sin try/catch).
 */
function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function SyncHealthPanel() {
  const { t } = useTranslation('operations');

  const { snapshotQuery, snapshot, conflicts } = useSyncSnapshot({
    queueLimit: QUEUE_PREVIEW_LIMIT,
    conflictLimit: CONFLICT_PREVIEW_LIMIT,
    staleTime: 30_000,
  });

  const pendingCount = snapshot?.pendingCount ?? 0;
  const retryingCount = snapshot?.retryingCount ?? 0;
  const failedCount = snapshot?.failedCount ?? 0;
  const conflictsCount = snapshot?.conflictsCount ?? 0;
  const isLoading = snapshotQuery.isLoading;

  // §09 — todo sincronizado = sin conflictos, sin fallos y sin cola pendiente.
  const allSynced = !!snapshot && conflictsCount === 0 && failedCount === 0 && pendingCount === 0;

  function entityLabel(entityType: string): string {
    return t(SYNC_ENTITY_LABEL_KEYS[entityType] ?? 'sync.entities.record');
  }

  return (
    <section className="card space-y-5 p-6">
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
          <RefreshCw className="h-5 w-5" />
        </span>
        <div>
          <p className="pv-kicker">{t('sync.kicker')}</p>
          <h2 className="pv-title text-lg">{t('sync.title')}</h2>
          <p className="mt-1 text-sm text-secondary-500">{t('sync.description')}</p>
        </div>
      </header>

      {isLoading && <p className="text-sm text-secondary-500">{t('common.loading')}</p>}

      {snapshotQuery.error && (
        <StatusStrip
          tone="danger"
          icon={AlertTriangle}
          title={translateServerError(snapshotQuery.error, t, t('common.errorGeneric'))}
          role="alert"
        />
      )}

      {snapshot && (
        <div
          className="pv-kpis grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
          data-testid="sync-summary"
        >
          <KpiTile
            icon={Clock}
            tone="ink"
            label={t('sync.summary.pending')}
            value={pendingCount.toLocaleString()}
          />
          <KpiTile
            icon={RotateCw}
            tone="ink"
            label={t('sync.summary.retrying')}
            value={retryingCount.toLocaleString()}
          />
          <KpiTile
            icon={XCircle}
            tone={failedCount > 0 ? 'danger' : 'ink'}
            label={t('sync.summary.failures')}
            value={failedCount.toLocaleString()}
          />
          <KpiTile
            icon={AlertTriangle}
            tone={conflictsCount > 0 ? 'danger' : 'ink'}
            label={t('sync.summary.conflicts')}
            value={conflictsCount.toLocaleString()}
          />
          <KpiTile
            icon={RefreshCw}
            tone="primary"
            label={t('sync.summary.lastSync')}
            value={
              snapshot.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : t('sync.summary.never')
            }
            mono
          />
        </div>
      )}

      {snapshot && allSynced && (
        <EmptyState
          icon={CheckCircle2}
          title={t('sync.empty.title')}
          description={t('sync.empty.description')}
        />
      )}

      {conflicts.length > 0 && (
        <div className="space-y-3">
          <h3 className="pv-title text-base">{t('sync.conflicts.title')}</h3>
          {conflicts.map(conflict => {
            const diffs = computeConflictDiff(
              conflict.localData,
              conflict.remoteData,
              formatConflictValue
            );
            return (
              <div
                key={conflict.id}
                className="rounded-2xl border border-warning-500/30 bg-warning-50/60 p-4"
                data-testid={`sync-conflict-${conflict.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="pv-gt pv-gt-warning h-8 w-8 rounded-[10px]">
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-secondary-900">
                        {t('sync.conflicts.itemTitle', {
                          entity: entityLabel(conflict.entityType),
                        })}
                      </p>
                      <p className="mt-0.5 text-xs text-secondary-500">
                        {t('sync.conflicts.created', { date: formatDateTime(conflict.createdAt) })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="warning" marker="dot">
                    {t('sync.conflicts.fieldsDiffer', { count: diffs.length })}
                  </Badge>
                </div>

                {diffs.length > 0 && (
                  <div className="pv-diff">
                    <div className="side local">
                      <div className="h">
                        <span>{t('sync.conflicts.local')}</span>
                        <Laptop className="h-3 w-3" />
                      </div>
                      {diffs.map(diff => (
                        <div key={diff.key} className="row">
                          <span className="k">{diff.key}</span>
                          <span className="v">{diff.localValue}</span>
                        </div>
                      ))}
                    </div>
                    <div className="side remote">
                      <div className="h">
                        <span>{t('sync.conflicts.remote')}</span>
                        <Cloud className="h-3 w-3" />
                      </div>
                      {diffs.map(diff => (
                        <div key={diff.key} className="row">
                          <span className="k">{diff.key}</span>
                          <span className="v changed">{diff.remoteValue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
