import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import type { City, Provider } from '@/types';
import { ProviderAdvancedFields, ProviderEssentialSection } from './ProviderFormSections';
import {
  createProviderFormValues,
  hasAdvancedProviderData,
  type ProviderFormValues,
} from './providerForm.types';

const PROVIDER_UNSAVED_KEEP_EDITING_BUTTON_ID = 'provider-unsaved-keep-editing';

export type { ProviderFormValues } from './providerForm.types';

interface ProviderFormModalProps {
  isOpen: boolean;
  provider: Provider | null;
  cities: City[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => Promise<void>;
}

export function ProviderFormModal({
  isOpen,
  provider,
  cities,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProviderFormModalProps): React.ReactElement {
  const { t } = useTranslation('settings');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<ProviderFormValues>({
    defaultValues: createProviderFormValues(provider),
  });
  const isCreate = !provider;
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
        document.getElementById(PROVIDER_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#provider-name')?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isExitConfirmationOpen, isOpen]);

  const regularFooter = (
    <>
      <ModalButton onClick={handleRequestClose} disabled={isSaving}>
        {t('providers.form.cancel')}
      </ModalButton>
      <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
        {isSaving
          ? t('providers.form.submitting')
          : isCreate
            ? t('providers.form.create')
            : t('providers.form.save')}
      </ModalButton>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title={
        isExitConfirmationOpen
          ? t('providers.form.unsavedChanges.title')
          : isCreate
            ? t('providers.form.createTitle')
            : t('providers.form.editTitle')
      }
      size="lg"
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId={PROVIDER_UNSAVED_KEEP_EDITING_BUTTON_ID}
            keepEditingLabel={t('providers.form.unsavedChanges.keepEditingAction')}
            discardLabel={t('providers.form.unsavedChanges.discardAction')}
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
          summary={t('providers.form.unsavedChanges.summary')}
          message={t('providers.form.unsavedChanges.message')}
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
            {t('providers.form.unsavedChanges.status')}
          </p>
        ) : null}

        <ProviderEssentialSection form={form} />

        <AdvancedDisclosure
          icon={FileText}
          title={t('providers.form.advanced.title')}
          description={t('providers.form.advanced.description')}
          status={
            hasAdvancedProviderData(provider)
              ? t('providers.form.advanced.savedStatus')
              : t('providers.form.advanced.optionalStatus')
          }
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <ProviderAdvancedFields form={form} cities={cities} />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
