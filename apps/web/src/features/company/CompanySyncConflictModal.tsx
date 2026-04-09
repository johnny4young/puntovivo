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
  const isLocalResolution = pendingResolution?.resolution === 'local_wins';
  const message = isLocalResolution
    ? `Keep the local ${pendingResolution?.entityType} changes for ${pendingResolution?.entityId} and requeue them for sync?`
    : `Accept the remote version for ${pendingResolution?.entityType} ${pendingResolution?.entityId} and discard the local conflict state?`;

  return (
    <ConfirmModal
      isOpen={pendingResolution !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      title={isLocalResolution ? 'Keep Local Changes' : 'Accept Remote Changes'}
      message={message}
      confirmText={isLocalResolution ? 'Keep Local' : 'Accept Remote'}
      loading={isLoading}
      variant={isLocalResolution ? 'primary' : 'danger'}
    />
  );
}
