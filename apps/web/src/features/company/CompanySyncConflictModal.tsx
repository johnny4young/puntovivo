import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { getSyncEntityLabel } from './companySyncDisplay';

export type ConflictResolution = 'local_wins' | 'remote_wins' | 'merged';

// explicit `| undefined` on optional fields.
export interface PendingResolution {
  id: string;
  entityId: string;
  entityType: string;
  entityLabel?: string | undefined;
  resolution: ConflictResolution;
  localData?: Record<string, unknown> | null | undefined;
  remoteData?: Record<string, unknown> | null | undefined;
  localRecordExists?: boolean | null | undefined;
}

interface CompanySyncConflictModalProps {
  pendingResolution: PendingResolution | null;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function CompanySyncConflictModal({
  pendingResolution,
  isLoading,
  onClose,
  onConfirm,
}: CompanySyncConflictModalProps) {
  const { t } = useTranslation('settings');
  const isLocalResolution = pendingResolution?.resolution === 'local_wins';
  const isMissingLocalRemoteResolution =
    pendingResolution?.resolution === 'remote_wins' &&
    pendingResolution.localRecordExists === false;
  const entityLabel =
    pendingResolution?.entityLabel ?? getSyncEntityLabel(t, pendingResolution?.entityType);

  const title = isLocalResolution
    ? t('company.sync.conflict.keepLocalTitle')
    : isMissingLocalRemoteResolution
      ? t('company.sync.conflict.discardLocalTitle')
      : t('company.sync.conflict.acceptRemoteTitle');
  const message = isLocalResolution
    ? t('company.sync.conflict.keepLocalMessage', {
        entity: entityLabel,
      })
    : isMissingLocalRemoteResolution
      ? t('company.sync.conflict.discardLocalMessage', {
          entity: entityLabel,
        })
      : t('company.sync.conflict.acceptRemoteMessage', {
          entity: entityLabel,
        });
  const confirmText = isLocalResolution
    ? t('company.sync.conflict.keepLocal')
    : isMissingLocalRemoteResolution
      ? t('company.sync.conflict.discardLocalChange')
      : t('company.sync.conflict.acceptRemote');

  return (
    <ConfirmModal
      isOpen={pendingResolution !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      message={message}
      confirmText={confirmText}
      loading={isLoading}
      variant={isLocalResolution ? 'primary' : 'danger'}
    />
  );
}
