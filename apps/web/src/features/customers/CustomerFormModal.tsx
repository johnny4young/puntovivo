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
import type { Customer, CustomerCatalogItem } from '@/types';
import { CustomerAdvancedFields, CustomerEssentialSection } from './CustomerFormSections';
import {
  createCustomerFormValues,
  hasAdvancedCustomerData,
  type CustomerFormValues,
} from './customerForm.types';

const CUSTOMER_UNSAVED_KEEP_EDITING_BUTTON_ID = 'customer-unsaved-keep-editing';

export type { CustomerFormValues } from './customerForm.types';

interface CustomerFormModalProps {
  isOpen: boolean;
  customer: Customer | null;
  identificationTypes: CustomerCatalogItem[];
  personTypes: CustomerCatalogItem[];
  regimeTypes: CustomerCatalogItem[];
  clientTypes: CustomerCatalogItem[];
  commercialActivities: CustomerCatalogItem[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  /**
   * Persists the form. May optionally return the newly created customer so the
   * checkout flow can attach it to the in-flight sale through `onCreated`.
   */
  onSubmit: (values: CustomerFormValues) => Promise<Customer | void>;
  /** Pre-fills the name when creating from the checkout customer picker. */
  defaultName?: string | undefined;
  /** Fires after a quick-created customer has been persisted successfully. */
  onCreated?: ((customer: Customer) => void) | undefined;
}

export function CustomerFormModal({
  isOpen,
  customer,
  identificationTypes,
  personTypes,
  regimeTypes,
  clientTypes,
  commercialActivities,
  isSaving,
  error,
  onClose,
  onSubmit,
  defaultName,
  onCreated,
}: CustomerFormModalProps) {
  const { t } = useTranslation('customers');
  const isCreate = !customer;
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<CustomerFormValues>({
    defaultValues: createCustomerFormValues(
      customer,
      isCreate && defaultName ? defaultName : undefined
    ),
  });
  const isDirty = form.formState.isDirty;

  const handleSubmit = form.handleSubmit(
    async values => {
      const result = await onSubmit(values);
      if (isCreate && result && onCreated) {
        onCreated(result);
      }
    },
    errors => {
      if (errors.creditLimit) {
        setAdvancedOpen(true);
      }
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
        document.getElementById(CUSTOMER_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#customer-name')?.focus();
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
      size="xl"
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      footer={
        isExitConfirmationOpen ? (
          <UnsavedChangesActions
            keepEditingId={CUSTOMER_UNSAVED_KEEP_EDITING_BUTTON_ID}
            keepEditingLabel={t('form.unsavedChanges.keepEditingAction')}
            discardLabel={t('form.unsavedChanges.discardAction')}
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
          summary={t('form.unsavedChanges.summary')}
          message={t('form.unsavedChanges.message')}
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

        <CustomerEssentialSection form={form} />

        <AdvancedDisclosure
          icon={FileText}
          title={t('form.advanced.title')}
          description={t('form.advanced.description')}
          status={
            hasAdvancedCustomerData(customer)
              ? t('form.advanced.savedStatus')
              : t('form.advanced.optionalStatus')
          }
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <CustomerAdvancedFields
            form={form}
            identificationTypes={identificationTypes}
            personTypes={personTypes}
            regimeTypes={regimeTypes}
            clientTypes={clientTypes}
            commercialActivities={commercialActivities}
          />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
