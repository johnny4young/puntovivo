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
import type { Unit } from '@/types';
import { UnitAdvancedFields, UnitEssentialSection } from './UnitFormSections';
import { createUnitFormValues, hasAdvancedUnitData, type UnitFormValues } from './unitForm.types';

const UNIT_UNSAVED_KEEP_EDITING_BUTTON_ID = 'unit-unsaved-keep-editing';

export type { UnitFormValues } from './unitForm.types';

interface UnitFormModalProps {
  isOpen: boolean;
  unit: Unit | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: UnitFormValues) => Promise<void>;
}

export function UnitFormModal({
  isOpen,
  unit,
  isSaving,
  error,
  onClose,
  onSubmit,
}: UnitFormModalProps): React.ReactElement {
  const { t } = useTranslation('settings');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<UnitFormValues>({
    defaultValues: createUnitFormValues(unit),
  });
  const isCreate = !unit;
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
        document.getElementById(UNIT_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#unit-name')?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isExitConfirmationOpen, isOpen]);

  const regularFooter = (
    <>
      <ModalButton onClick={handleRequestClose} disabled={isSaving}>
        {t('units.form.cancel')}
      </ModalButton>
      <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
        {isSaving
          ? t('units.form.submitting')
          : isCreate
            ? t('units.form.create')
            : t('units.form.save')}
      </ModalButton>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title={
        isExitConfirmationOpen
          ? t('units.form.unsavedChanges.title')
          : isCreate
            ? t('units.form.createTitle')
            : t('units.form.editTitle')
      }
      size="lg"
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId={UNIT_UNSAVED_KEEP_EDITING_BUTTON_ID}
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
            {t('units.form.unsavedChanges.status')}
          </p>
        ) : null}

        <UnitEssentialSection form={form} />

        <AdvancedDisclosure
          icon={Settings2}
          title={t('units.form.advanced.title')}
          description={t('units.form.advanced.description')}
          status={
            hasAdvancedUnitData(unit)
              ? t('units.form.advanced.savedStatus')
              : t('units.form.advanced.automaticStatus')
          }
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <UnitAdvancedFields form={form} />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
