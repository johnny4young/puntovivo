import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalButton } from '@/components/form-controls/Modal';

const PRODUCT_UNSAVED_KEEP_EDITING_BUTTON_ID = 'product-unsaved-keep-editing';

export function ProductUnsavedChangesBody() {
  const { t } = useTranslation('products');
  return (
    <div className="flex gap-4 py-2">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-danger-50 text-danger-700">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <p className="font-semibold text-secondary-950">{t('form.unsavedChanges.summary')}</p>
        <p className="text-sm leading-6 text-secondary-600">{t('form.unsavedChanges.message')}</p>
      </div>
    </div>
  );
}

export function ProductUnsavedChangesActions({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation('products');
  return (
    <>
      <ModalButton id={PRODUCT_UNSAVED_KEEP_EDITING_BUTTON_ID} onClick={onKeepEditing}>
        {t('form.unsavedChanges.keepEditingAction')}
      </ModalButton>
      <ModalButton variant="danger" onClick={onDiscard}>
        {t('form.unsavedChanges.discardAction')}
      </ModalButton>
    </>
  );
}
