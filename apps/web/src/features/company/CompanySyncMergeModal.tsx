import { useState } from 'react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { PendingResolution } from '@/features/company/CompanySyncConflictModal';

function buildInitialMergedJson(pendingResolution: PendingResolution | null) {
  const merged = {
    ...(pendingResolution?.remoteData ?? {}),
    ...(pendingResolution?.localData ?? {}),
  };

  return JSON.stringify(merged, null, 2);
}

interface CompanySyncMergeModalProps {
  pendingResolution: PendingResolution | null;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (mergedData: Record<string, unknown>) => void;
}

export function CompanySyncMergeModal({
  pendingResolution,
  isLoading,
  onClose,
  onConfirm,
}: CompanySyncMergeModalProps) {
  if (!pendingResolution || pendingResolution.resolution !== 'merged') {
    return null;
  }

  return (
    <MergeModalContent
      key={pendingResolution.id}
      pendingResolution={pendingResolution}
      isLoading={isLoading}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

interface MergeModalContentProps {
  pendingResolution: PendingResolution;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (mergedData: Record<string, unknown>) => void;
}

function MergeModalContent({
  pendingResolution,
  isLoading,
  onClose,
  onConfirm,
}: MergeModalContentProps) {
  const [mergedJson, setMergedJson] = useState(() => buildInitialMergedJson(pendingResolution));
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    try {
      const parsed = JSON.parse(mergedJson) as unknown;

      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        setError('Merged data must be a JSON object.');
        return;
      }

      setError(null);
      onConfirm(parsed as Record<string, unknown>);
    } catch {
      setError('Merged data must be valid JSON.');
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Merge Conflict Data"
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isLoading}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Merge'}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-600">
          Review the local and remote payloads for {pendingResolution.entityType} {pendingResolution.entityId}, then edit the merged JSON that should be requeued for sync.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-secondary-200 bg-secondary-50 p-4">
            <h3 className="text-sm font-semibold text-secondary-900">Local Data</h3>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-secondary-700">
              {JSON.stringify(pendingResolution.localData ?? {}, null, 2)}
            </pre>
          </div>
          <div className="rounded-xl border border-secondary-200 bg-secondary-50 p-4">
            <h3 className="text-sm font-semibold text-secondary-900">Remote Data</h3>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-secondary-700">
              {JSON.stringify(pendingResolution.remoteData ?? {}, null, 2)}
            </pre>
          </div>
        </div>

        <div>
          <label
            htmlFor="merged-sync-json"
            className="text-sm font-semibold text-secondary-900"
          >
            Merged JSON
          </label>
          <textarea
            id="merged-sync-json"
            className="input mt-2 min-h-[240px] font-mono text-sm"
            value={mergedJson}
            onChange={event => setMergedJson(event.target.value)}
            spellCheck={false}
          />
          {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
