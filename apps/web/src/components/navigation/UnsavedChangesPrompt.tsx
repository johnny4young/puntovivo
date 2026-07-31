import { AlertTriangle } from 'lucide-react';

import { ModalButton } from '@/components/form-controls/Modal';

interface UnsavedChangesBodyProps {
  summary: string;
  message: string;
}

export function UnsavedChangesBody({
  summary,
  message,
}: UnsavedChangesBodyProps): React.ReactElement {
  return (
    <div className="flex gap-4 py-2">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-danger-50 text-danger-700">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <p className="font-semibold text-secondary-950">{summary}</p>
        <p className="text-sm leading-6 text-secondary-600">{message}</p>
      </div>
    </div>
  );
}

interface UnsavedChangesActionsProps {
  keepEditingId: string;
  keepEditingLabel: string;
  discardLabel: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export function UnsavedChangesActions({
  keepEditingId,
  keepEditingLabel,
  discardLabel,
  onKeepEditing,
  onDiscard,
}: UnsavedChangesActionsProps): React.ReactElement {
  return (
    <>
      <ModalButton id={keepEditingId} onClick={onKeepEditing}>
        {keepEditingLabel}
      </ModalButton>
      <ModalButton variant="danger" onClick={onDiscard}>
        {discardLabel}
      </ModalButton>
    </>
  );
}
