import { AlertTriangle, GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PendingResolution } from '@/features/company/CompanySyncConflictModal';
import { formatDateTime } from '@/lib/utils';
import {
  getSyncEntityLabel,
  getSyncOperationLabel,
  getSyncQueueIssueMessage,
  normalizeSyncLastError,
} from './companySyncDisplay';

interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  createdAt: string;
  attempts?: number;
  lastError?: string | Record<string, unknown> | null;
}

interface SyncConflictItem {
  id: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  localData?: Record<string, unknown> | null;
  remoteData?: Record<string, unknown> | null;
  localRecordExists?: boolean | null;
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
          {items.map(item => {
            const entityLabel = getSyncEntityLabel(t, item.entityType);
            const operationLabel = getSyncOperationLabel(t, item.operation);
            const issueMessage = getSyncQueueIssueMessage(t, item.lastError);

            return (
              <div key={item.id} className="surface-panel">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-secondary-700">
                    {entityLabel}
                  </span>
                  <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
                    {operationLabel}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium text-secondary-900">
                  {t('company.sync.queue.itemTitle', { entity: entityLabel })}
                </p>
                <p className="mt-1 text-xs text-secondary-500">{t('company.sync.queue.queued', { date: formatDateTime(item.createdAt) })}</p>
                {(item.attempts ?? 0) > 0 && (
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-warning-700">
                    {t('company.sync.queue.retryAttempt', { count: item.attempts })}
                  </p>
                )}
                {issueMessage && <p className="mt-2 text-sm text-danger-600">{issueMessage}</p>}
                <SyncTechnicalDetails
                  entityType={item.entityType}
                  entityId={item.entityId}
                  operation={item.operation}
                  lastError={item.lastError}
                />
              </div>
            );
          })}
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
          {conflicts.map(conflict => {
            const localRecordMissing = conflict.localRecordExists === false;
            const entityLabel = getSyncEntityLabel(t, conflict.entityType);
            // Reviewer fix — give the "local record missing" notice a stable
            // id so the disabled `Keep Local` and `Merge` buttons can point
            // at it via aria-describedby. Otherwise screen readers announce
            // the buttons as "dimmed" with no explanation.
            const missingLocalNoticeId = localRecordMissing
              ? `sync-conflict-missing-${conflict.id}`
              : undefined;

            return (
              <div
                key={conflict.id}
                className="rounded-xl border border-warning-500/30 bg-warning-50 px-4 py-4"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-700" />
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">
                        {t('company.sync.conflict.itemTitle', { entity: entityLabel })}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {t('company.sync.conflict.created', { date: formatDateTime(conflict.createdAt) })}
                      </p>
                    </div>

                    {localRecordMissing && (
                      <p
                        id={missingLocalNoticeId}
                        className="rounded-lg border border-warning-500/30 bg-white/70 px-3 py-2 text-sm text-warning-800"
                      >
                        {t('company.sync.conflict.localRecordMissing')}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={isResolving || localRecordMissing}
                        aria-describedby={missingLocalNoticeId}
                        onClick={() =>
                          onOpenResolution({
                            id: conflict.id,
                            entityId: conflict.entityId,
                            entityType: conflict.entityType,
                            entityLabel,
                            resolution: 'local_wins',
                            localData: conflict.localData,
                            remoteData: conflict.remoteData,
                            localRecordExists: conflict.localRecordExists,
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
                            entityLabel,
                            resolution: 'remote_wins',
                            localData: conflict.localData,
                            remoteData: conflict.remoteData,
                            localRecordExists: conflict.localRecordExists,
                          })
                        }
                      >
                        {localRecordMissing
                          ? t('company.sync.conflict.discardLocalChange')
                          : t('company.sync.conflict.acceptRemote')}
                      </button>
                      <button
                        type="button"
                        className="btn-outline flex items-center gap-2"
                        disabled={isResolving || localRecordMissing}
                        aria-describedby={missingLocalNoticeId}
                        onClick={() =>
                          onOpenResolution({
                            id: conflict.id,
                            entityId: conflict.entityId,
                            entityType: conflict.entityType,
                            entityLabel,
                            resolution: 'merged',
                            localData: conflict.localData,
                            remoteData: conflict.remoteData,
                            localRecordExists: conflict.localRecordExists,
                          })
                        }
                      >
                        <GitMerge className="h-4 w-4" />
                        {t('company.sync.conflict.merge')}
                      </button>
                    </div>
                    <SyncTechnicalDetails
                      entityType={conflict.entityType}
                      entityId={conflict.entityId}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SyncTechnicalDetailsProps {
  entityType: string;
  entityId: string;
  operation?: string;
  lastError?: string | Record<string, unknown> | null;
}

function SyncTechnicalDetails({
  entityType,
  entityId,
  operation,
  lastError,
}: SyncTechnicalDetailsProps) {
  const { t } = useTranslation('settings');

  return (
    <details className="mt-3 rounded-lg border border-secondary-200 bg-white/60 px-3 py-2 text-xs text-secondary-600">
      <summary className="cursor-pointer select-none font-medium text-secondary-700">
        {t('company.sync.technicalDetails.title')}
      </summary>
      <dl className="mt-2 space-y-1">
        <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-medium">{t('company.sync.technicalDetails.entityType')}</dt>
          <dd className="break-all font-mono">{entityType}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-medium">{t('company.sync.technicalDetails.entityId')}</dt>
          <dd className="break-all font-mono">{entityId}</dd>
        </div>
        {operation && (
          <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="font-medium">{t('company.sync.technicalDetails.operation')}</dt>
            <dd className="break-all font-mono">{operation}</dd>
          </div>
        )}
        {(() => {
          const normalizedMessage = normalizeSyncLastError(lastError);
          if (!normalizedMessage) {
            return null;
          }
          return (
            <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
              <dt className="font-medium">{t('company.sync.technicalDetails.error')}</dt>
              <dd className="break-words font-mono">{normalizedMessage}</dd>
            </div>
          );
        })()}
      </dl>
    </details>
  );
}
