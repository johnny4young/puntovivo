import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import type { Location } from '@/types';
import { LocationAdvancedFields, LocationEssentialSection } from './LocationFormSections';
import { createLocationFormValues, type LocationFormValues } from './locationForm.types';

const LOCATION_UNSAVED_KEEP_EDITING_BUTTON_ID = 'location-unsaved-keep-editing';

export type { LocationFormValues } from './locationForm.types';

interface LocationFormModalProps {
  isOpen: boolean;
  location: Location | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: LocationFormValues) => Promise<void>;
}

export function LocationFormModal({
  isOpen,
  location,
  isSaving,
  error,
  onClose,
  onSubmit,
}: LocationFormModalProps): React.ReactElement {
  const { t } = useTranslation('locations');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<LocationFormValues>({
    defaultValues: createLocationFormValues(location),
  });

  const isCreate = !location;
  const isDirty = form.formState.isDirty;
  const handleSubmit = form.handleSubmit(onSubmit);
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
        document.getElementById(LOCATION_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#location-code')?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isExitConfirmationOpen, isOpen]);

  const regularFooter = (
    <>
      <ModalButton onClick={handleRequestClose} disabled={isSaving}>
        {t('form.cancel')}
      </ModalButton>
      <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
        {isSaving
          ? t('form.submitting')
          : isCreate
            ? t('form.create')
            : t('form.save')}
      </ModalButton>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title={
        isExitConfirmationOpen
          ? t('form.unsavedChanges.title')
          : isCreate
            ? t('form.createTitle')
            : t('form.editTitle')
      }
      size="lg"
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId={LOCATION_UNSAVED_KEEP_EDITING_BUTTON_ID}
            keepEditingLabel={t('common:unsavedChanges.keepEditingAction')}
            discardLabel={t('common:unsavedChanges.discardAction')}
            onKeepEditing={keepEditing}
            onDiscard={discardChanges}
          />
        ) : (
          regularFooter
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
        onSubmit={handleSubmit}
        hidden={isExitConfirmationOpen}
        aria-hidden={isExitConfirmationOpen}
      >
        {isDirty ? (
          <p role="status" className="text-sm font-medium text-warning-700">
            {t('form.unsavedChanges.status')}
          </p>
        ) : null}

        <LocationEssentialSection form={form} />

        <AdvancedDisclosure
          icon={Settings2}
          title={t('form.advanced.title')}
          description={t('form.advanced.description')}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <LocationAdvancedFields form={form} />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
