import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';

const GEOGRAPHY_UNSAVED_KEEP_EDITING_BUTTON_ID = 'geography-unsaved-keep-editing';

interface GeographyFormFrameProps {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  isSaving: boolean;
  isDirty: boolean;
  firstFieldId: string;
  error: string | null;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}

export function GeographyFormFrame({
  isOpen,
  title,
  submitLabel,
  isSaving,
  isDirty,
  firstFieldId,
  error,
  children,
  onClose,
  onSubmit,
}: GeographyFormFrameProps): React.ReactElement {
  const { t } = useTranslation('geography');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const { requestClose, isExitConfirmationOpen, keepEditing, discardChanges } =
    useUnsavedChangesGuard({ when: isOpen && isDirty, onClose });

  const handleRequestClose = () => {
    if (!isSaving) requestClose();
  };

  useEffect(() => {
    const confirmationWasOpen = wasExitConfirmationOpen.current;
    wasExitConfirmationOpen.current = isExitConfirmationOpen;
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      if (isExitConfirmationOpen) {
        document.getElementById(GEOGRAPHY_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>(`#${firstFieldId}`)?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [firstFieldId, isExitConfirmationOpen, isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title={isExitConfirmationOpen ? t('form.unsavedChanges.title') : title}
      size="lg"
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId={GEOGRAPHY_UNSAVED_KEEP_EDITING_BUTTON_ID}
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={keepEditing}
            onDiscard={discardChanges}
          />
        ) : (
          <>
            <ModalButton onClick={handleRequestClose} disabled={isSaving}>
              {t('form.cancel')}
            </ModalButton>
            <ModalButton variant="primary" onClick={onSubmit} disabled={isSaving}>
              {isSaving ? t('form.submitting') : submitLabel}
            </ModalButton>
          </>
        )
      }
    >
      {isExitConfirmationOpen ? (
        <UnsavedChangesBody
          summary={t('common:unsavedChanges.summary')}
          message={t('common:unsavedChanges.message')}
        />
      ) : null}

      <form
        ref={formRef}
        className="grid gap-4"
        onSubmit={event => {
          event.preventDefault();
          onSubmit();
        }}
        hidden={isExitConfirmationOpen}
        aria-hidden={isExitConfirmationOpen}
      >
        {isDirty ? (
          <p role="status" className="text-sm font-medium text-warning-700">
            {t('form.unsavedChanges.status')}
          </p>
        ) : null}
        {children}
        {error ? (
          <p className="text-sm text-danger-500" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
