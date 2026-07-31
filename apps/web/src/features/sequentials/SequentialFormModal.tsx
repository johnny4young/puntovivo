import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import type { Sequential, Site } from '@/types';
import { SequentialCounterFields, SequentialEssentialSection } from './SequentialFormSections';
import {
  createSequentialFormValues,
  formatSequentialPreview,
  type SequentialFormSubmission,
  type SequentialFormValues,
} from './sequentialForm.types';

const SEQUENTIAL_UNSAVED_KEEP_EDITING_BUTTON_ID = 'sequential-unsaved-keep-editing';

export type { SequentialFormSubmission } from './sequentialForm.types';

interface SequentialFormModalProps {
  isOpen: boolean;
  sequential: Sequential | null;
  sites: Site[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SequentialFormSubmission) => Promise<void>;
}

export function SequentialFormModal({
  isOpen,
  sequential,
  sites,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SequentialFormModalProps): React.ReactElement {
  const { t } = useTranslation('sequentials');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<SequentialFormValues>({
    defaultValues: createSequentialFormValues(sequential),
  });
  const documentTypeLabels: Record<Sequential['documentType'], string> = {
    sale: t('docTypes.sale'),
    purchase: t('docTypes.purchase'),
    order: t('docTypes.order'),
    quotation: t('docTypes.quotation'),
  };
  const prefix = useWatch({ control: form.control, name: 'prefix' });
  const currentValue = useWatch({ control: form.control, name: 'currentValue' });
  const nextPreview = formatSequentialPreview(prefix, currentValue);
  const isCreate = !sequential;
  const isDirty = form.formState.isDirty;
  const isLowering = Boolean(sequential && currentValue < sequential.currentValue);

  const handleSubmit = form.handleSubmit(
    async values => {
      const submission: SequentialFormSubmission = {
        siteId: sequential?.siteId ?? values.siteId,
        documentType: sequential?.documentType ?? values.documentType,
        prefix: values.prefix.trim(),
      };

      if (form.formState.dirtyFields.currentValue) {
        submission.currentValue = values.currentValue;
      }

      await onSubmit(submission);
    },
    errors => {
      if (errors.currentValue) setAdvancedOpen(true);
    }
  );
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
        document.getElementById(SEQUENTIAL_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#sequential-prefix')?.focus();
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
        {isSaving ? t('form.submitting') : isCreate ? t('form.create') : t('form.save')}
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
            keepEditingId={SEQUENTIAL_UNSAVED_KEEP_EDITING_BUTTON_ID}
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

        <SequentialEssentialSection
          form={form}
          sequential={sequential}
          sites={sites}
          documentTypeLabels={documentTypeLabels}
        />

        <AdvancedDisclosure
          icon={Settings2}
          title={t('form.advanced.title')}
          description={t('form.advanced.description')}
          status={t('form.advanced.nextStatus', { number: nextPreview })}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <SequentialCounterFields form={form} nextPreview={nextPreview} isLowering={isLowering} />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
