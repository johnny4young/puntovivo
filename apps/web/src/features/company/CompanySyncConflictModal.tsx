import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';

export type ConflictResolution = 'local_wins' | 'remote_wins' | 'merged';

export interface PendingResolution {
  id: string;
  entityId: string;
  entityType: string;
  resolution: ConflictResolution;
  localData?: Record<string, unknown> | null;
  remoteData?: Record<string, unknown> | null;
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

  const message = isLocalResolution
    ? t('company.sync.conflict.keepLocalMessage', {
        entityType: pendingResolution?.entityType,
        entityId: pendingResolution?.entityId,
      })
    : t('company.sync.conflict.acceptRemoteMessage', {
        entityType: pendingResolution?.entityType,
        entityId: pendingResolution?.entityId,
      });

  return (
    <ConfirmModal
      isOpen={pendingResolution !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      title={isLocalResolution ? t('company.sync.conflict.keepLocalTitle') : t('company.sync.conflict.acceptRemoteTitle')}
      message={message}
      confirmText={isLocalResolution ? t('company.sync.conflict.keepLocal') : t('company.sync.conflict.acceptRemote')}
      loading={isLoading}
      variant={isLocalResolution ? 'primary' : 'danger'}
    />
  );
}
