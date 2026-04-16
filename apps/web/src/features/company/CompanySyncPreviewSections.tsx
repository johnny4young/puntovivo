import { AlertTriangle, GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PendingResolution } from '@/features/company/CompanySyncConflictModal';
import { formatDateTime } from '@/lib/utils';

interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  createdAt: string;
  attempts?: number;
  lastError?: string | null;
}

interface SyncConflictItem {
  id: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  localData?: Record<string, unknown> | null;
  remoteData?: Record<string, unknown> | null;
}

interface CompanySyncQueuePreviewProps {
  isLoading: boolean;
  items: SyncQueueItem[];
}

export function CompanySyncQueuePreview({
  isLoading,
  items,
}: CompanySyncQueuePreviewProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-secondary-900">{t('company.sync.queue.title')}</h3>
        <p className="mt-1 text-sm text-secondary-500">
          {t('company.sync.queue.description')}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-secondary-500">{t('company.sync.queue.loading')}</p>
      ) : items.length === 0 ? (
        <p className="surface-panel-muted text-sm text-secondary-600">{t('company.sync.queue.empty')}</p>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="surface-panel">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-secondary-700">
                  {item.entityType}
                </span>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium uppercase text-primary-700">
                  {item.operation}
                </span>
              </div>
              <p className="mt-3 text-sm text-secondary-700">{t('company.sync.queue.entityId', { id: item.entityId })}</p>
              <p className="mt-1 text-xs text-secondary-500">{t('company.sync.queue.queued', { date: formatDateTime(item.createdAt) })}</p>
              {(item.attempts ?? 0) > 0 && (
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-warning-700">
                  {t('company.sync.queue.retryAttempt', { count: item.attempts })}
                </p>
              )}
              {item.lastError && <p className="mt-2 text-sm text-danger-600">{item.lastError}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CompanySyncConflictPreviewProps {
  isLoading: boolean;
  conflicts: SyncConflictItem[];
  isResolving: boolean;
  onOpenResolution: (pendingResolution: PendingResolution) => void;
}

export function CompanySyncConflictPreview({
  isLoading,
  conflicts,
  isResolving,
  onOpenResolution,
}: CompanySyncConflictPreviewProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-secondary-900">{t('company.sync.conflict.title')}</h3>
        <p className="mt-1 text-sm text-secondary-500">
          {t('company.sync.conflict.description')}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-secondary-500">{t('company.sync.conflict.loading')}</p>
      ) : conflicts.length === 0 ? (
        <p className="surface-panel-muted text-sm text-secondary-600">{t('company.sync.conflict.empty')}</p>
      ) : (
        <div className="space-y-3">
          {conflicts.map(conflict => (
            <div
              key={conflict.id}
              className="rounded-xl border border-warning-500/30 bg-warning-50 px-4 py-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-700" />
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-sm font-medium text-secondary-900">
                      {conflict.entityType} · {conflict.entityId}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {t('company.sync.conflict.created', { date: formatDateTime(conflict.createdAt) })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={isResolving}
                      onClick={() =>
                        onOpenResolution({
                          id: conflict.id,
                          entityId: conflict.entityId,
                          entityType: conflict.entityType,
                          resolution: 'local_wins',
                          localData: conflict.localData,
                          remoteData: conflict.remoteData,
                        })
                      }
                    >
                      {t('company.sync.conflict.keepLocal')}
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={isResolving}
                      onClick={() =>
                        onOpenResolution({
                          id: conflict.id,
                          entityId: conflict.entityId,
                          entityType: conflict.entityType,
                          resolution: 'remote_wins',
                          localData: conflict.localData,
                          remoteData: conflict.remoteData,
                        })
                      }
                    >
                      {t('company.sync.conflict.acceptRemote')}
                    </button>
                    <button
                      type="button"
                      className="btn-outline flex items-center gap-2"
                      disabled={isResolving}
                      onClick={() =>
                        onOpenResolution({
                          id: conflict.id,
                          entityId: conflict.entityId,
                          entityType: conflict.entityType,
                          resolution: 'merged',
                          localData: conflict.localData,
                          remoteData: conflict.remoteData,
                        })
                      }
                    >
                      <GitMerge className="h-4 w-4" />
                      {t('company.sync.conflict.merge')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
