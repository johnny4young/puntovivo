import { useEffect, useRef, useState } from 'react';
import { ListTree } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AdvancedDisclosure } from '@/components/experience/AdvancedDisclosure';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import {
  UnsavedChangesActions,
  UnsavedChangesBody,
} from '@/components/navigation/UnsavedChangesPrompt';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import type { Category } from '@/types';
import { CategoryAdvancedFields, CategoryEssentialSection } from './CategoryFormSections';
import {
  createCategoryFormValues,
  hasAdvancedCategoryData,
  type CategoryFormValues,
  type CategoryLookupOption,
} from './categoryForm.types';

const CATEGORY_UNSAVED_KEEP_EDITING_BUTTON_ID = 'category-unsaved-keep-editing';

export type { CategoryFormValues, CategoryLookupOption } from './categoryForm.types';

interface CategoryFormModalProps {
  isOpen: boolean;
  category: Category | null;
  parentOptions: CategoryLookupOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}

export function CategoryFormModal({
  isOpen,
  category,
  parentOptions,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CategoryFormModalProps): React.ReactElement {
  const { t } = useTranslation('categories');
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<CategoryFormValues>({
    defaultValues: createCategoryFormValues(category),
  });

  const isCreate = !category;
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
        document.getElementById(CATEGORY_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current?.querySelector<HTMLElement>('#category-name')?.focus();
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
            keepEditingId={CATEGORY_UNSAVED_KEEP_EDITING_BUTTON_ID}
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

        <CategoryEssentialSection form={form} />

        <AdvancedDisclosure
          icon={ListTree}
          title={t('form.advanced.title')}
          description={t('form.advanced.description')}
          status={
            hasAdvancedCategoryData(category)
              ? t('form.advanced.savedStatus')
              : t('form.advanced.defaultStatus')
          }
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <CategoryAdvancedFields form={form} parentOptions={parentOptions} />
        </AdvancedDisclosure>

        {error ? <p className="text-sm text-danger-500">{error}</p> : null}
      </form>
    </Modal>
  );
}
