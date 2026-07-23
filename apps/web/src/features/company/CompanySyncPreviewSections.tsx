import { AlertTriangle, Cloud, CloudDownload, GitMerge, Laptop, Lightbulb } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { PendingResolution } from '@/features/company/CompanySyncConflictModal';
import { Badge, Button } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import {
  computeConflictDiff,
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
export function CompanySyncQueuePreview({ isLoading, items }: CompanySyncQueuePreviewProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-secondary-900">
          {t('company.sync.queue.title')}
        </h3>
        <p className="mt-1 text-sm text-secondary-500">{t('company.sync.queue.description')}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-secondary-500">{t('company.sync.queue.loading')}</p>
      ) : items.length === 0 ? (
        <p className="surface-panel-muted text-sm text-secondary-600">
          {t('company.sync.queue.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const entityLabel = getSyncEntityLabel(t, item.entityType);
            const operationLabel = getSyncOperationLabel(t, item.operation);
            const issueMessage = getSyncQueueIssueMessage(t, item.lastError);
            return (
              <div key={item.id} className="surface-panel">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">{entityLabel}</Badge>
                  <Badge variant="primary">{operationLabel}</Badge>
                </div>
                <p className="mt-3 text-sm font-medium text-secondary-900">
                  {t('company.sync.queue.itemTitle', {
                    entity: entityLabel,
                  })}
                </p>
                <p className="mt-1 text-xs text-secondary-500">
                  {t('company.sync.queue.queued', {
                    date: formatDateTime(item.createdAt),
                  })}
                </p>
                {(item.attempts ?? 0) > 0 && (
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-warning-700">
                    {t('company.sync.queue.retryAttempt', {
                      count: item.attempts,
                    })}
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
        <h3 className="text-sm font-semibold text-secondary-900">
          {t('company.sync.conflict.title')}
        </h3>
        <p className="mt-1 text-sm text-secondary-500">{t('company.sync.conflict.description')}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-secondary-500">{t('company.sync.conflict.loading')}</p>
      ) : conflicts.length === 0 ? (
        <p className="surface-panel-muted text-sm text-secondary-600">
          {t('company.sync.conflict.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {conflicts.map(conflict => (
            <ConflictDiffCard
              key={conflict.id}
              conflict={conflict}
              isResolving={isResolving}
              onOpenResolution={onOpenResolution}
            />
          ))}
        </div>
      )}
    </div>
  );
}
interface ConflictDiffCardProps {
  conflict: SyncConflictItem;
  isResolving: boolean;
  onOpenResolution: (pendingResolution: PendingResolution) => void;
}
function ConflictDiffCard({ conflict, isResolving, onOpenResolution }: ConflictDiffCardProps) {
  const { t } = useTranslation('settings');
  const localRecordMissing = conflict.localRecordExists === false;
  const entityLabel = getSyncEntityLabel(t, conflict.entityType);
  const diffFields = computeConflictDiff(conflict.localData, conflict.remoteData);
  // Reviewer fix — give the "local record missing" notice a stable id so the
  // disabled Keep Local and Merge buttons can point at it via
  // aria-describedby. Otherwise screen readers announce the buttons as
  // disabled with no explanation.
  const missingLocalNoticeId = localRecordMissing
    ? `sync-conflict-missing-${conflict.id}`
    : undefined;
  const basePayload = {
    id: conflict.id,
    entityId: conflict.entityId,
    entityType: conflict.entityType,
    entityLabel,
    localData: conflict.localData,
    remoteData: conflict.remoteData,
    localRecordExists: conflict.localRecordExists,
  } as const;
  return (
    <div className="rounded-2xl border border-warning-500/30 bg-warning-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-warning h-8 w-8 shrink-0 rounded-[10px]">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-secondary-900">
              {t('company.sync.conflict.itemTitle', {
                entity: entityLabel,
              })}
            </p>
            <p className="mt-0.5 text-xs text-secondary-500">
              {t('company.sync.conflict.created', {
                date: formatDateTime(conflict.createdAt),
              })}
            </p>
          </div>
        </div>
        {diffFields.length > 0 && (
          <Badge variant="warning" marker="dot">
            {t('company.sync.conflict.fieldsDiffer', {
              count: diffFields.length,
            })}
          </Badge>
        )}
      </div>

      {localRecordMissing && (
        <p
          id={missingLocalNoticeId}
          className="mt-3 rounded-lg border border-warning-500/30 bg-surface/70 px-3 py-2 text-sm text-warning-800"
        >
          {t('company.sync.conflict.localRecordMissing')}
        </p>
      )}

      {diffFields.length > 0 ? (
        <div className="pv-diff">
          <div className="side local">
            <div className="h">
              <span>{t('company.sync.conflict.diff.local')}</span>
              <Laptop className="h-[13px] w-[13px]" aria-hidden="true" />
            </div>
            {diffFields.map(field => (
              <div className="row" key={`local-${field.key}`}>
                <span className="k">{field.key}</span>
                <span className="v">{field.localValue}</span>
              </div>
            ))}
          </div>
          <div className="side remote">
            <div className="h">
              <span>{t('company.sync.conflict.diff.remote')}</span>
              <Cloud className="h-[13px] w-[13px]" aria-hidden="true" />
            </div>
            {diffFields.map(field => (
              <div className="row" key={`remote-${field.key}`}>
                <span className="k">{field.key}</span>
                <span className="v changed">{field.remoteValue}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        !localRecordMissing && (
          <p className="mt-3 text-sm text-secondary-600">
            {t('company.sync.conflict.noFieldDiff')}
          </p>
        )
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-secondary-500">
          <Lightbulb className="h-3.5 w-3.5 text-primary-700" aria-hidden="true" />
          {localRecordMissing
            ? t('company.sync.conflict.recommendedDiscard')
            : t('company.sync.conflict.recommendedAcceptRemote')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={isResolving || localRecordMissing}
            aria-describedby={missingLocalNoticeId}
            onClick={() =>
              onOpenResolution({
                ...basePayload,
                resolution: 'local_wins',
              })
            }
            variant="ghost"
          >
            {t('company.sync.conflict.keepLocal')}
          </Button>
          <Button
            type="button"
            disabled={isResolving || localRecordMissing}
            aria-describedby={missingLocalNoticeId}
            onClick={() =>
              onOpenResolution({
                ...basePayload,
                resolution: 'merged',
              })
            }
            variant="ghost"
          >
            <GitMerge />
            {t('company.sync.conflict.merge')}
          </Button>
          <Button
            type="button"
            disabled={isResolving}
            onClick={() =>
              onOpenResolution({
                ...basePayload,
                resolution: 'remote_wins',
              })
            }
            variant="primary"
          >
            <CloudDownload />
            {localRecordMissing
              ? t('company.sync.conflict.discardLocalChange')
              : t('company.sync.conflict.acceptRemote')}
          </Button>
        </div>
      </div>

      <SyncTechnicalDetails entityType={conflict.entityType} entityId={conflict.entityId} />
    </div>
  );
}

// explicit `| undefined` on optional fields.
interface SyncTechnicalDetailsProps {
  entityType: string;
  entityId: string;
  operation?: string | undefined;
  lastError?: string | Record<string, unknown> | null | undefined;
}
function SyncTechnicalDetails({
  entityType,
  entityId,
  operation,
  lastError,
}: SyncTechnicalDetailsProps) {
  const { t } = useTranslation('settings');
  return (
    <details className="mt-3 rounded-lg border border-line/75 bg-surface/60 px-3 py-2 text-xs text-secondary-600">
      <summary className="cursor-pointer select-none font-medium text-secondary-700">
        {t('company.sync.technicalDetails.title')}
      </summary>
      <dl className="mt-2 space-y-1">
        <DetailRow t={t} labelKey="company.sync.technicalDetails.entityType" value={entityType} />
        <DetailRow t={t} labelKey="company.sync.technicalDetails.entityId" value={entityId} />
        {operation && (
          <DetailRow t={t} labelKey="company.sync.technicalDetails.operation" value={operation} />
        )}
        {(() => {
          const normalizedMessage = normalizeSyncLastError(lastError);
          if (!normalizedMessage) {
            return null;
          }
          return (
            <DetailRow
              t={t}
              labelKey="company.sync.technicalDetails.error"
              value={normalizedMessage}
              wrap
            />
          );
        })()}
      </dl>
    </details>
  );
}
interface DetailRowProps {
  t: TFunction;
  labelKey: string;
  value: string;
  wrap?: boolean;
}
function DetailRow({ t, labelKey, value, wrap = false }: DetailRowProps) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <dt className="font-medium">{t(labelKey)}</dt>
      <dd className={`${wrap ? 'break-words' : 'break-all'} font-mono`}>{value}</dd>
    </div>
  );
}
