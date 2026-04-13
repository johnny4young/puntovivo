import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { Purchase } from '@/types';

interface PurchaseReturnFormValues {
  items: Array<{
    purchaseItemId: string;
    quantity: number;
  }>;
  reason: string;
}

export interface PurchaseReturnValues {
  items: Array<{
    purchaseItemId: string;
    quantity: number;
  }>;
  reason: string;
}

interface PurchaseReturnModalProps {
  isOpen: boolean;
  purchase: Purchase;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: PurchaseReturnValues) => Promise<void>;
}

export function PurchaseReturnModal({
  isOpen,
  purchase,
  isSaving,
  error,
  onClose,
  onSubmit,
}: PurchaseReturnModalProps) {
  const { t } = useTranslation('inventory');
  const form = useForm<PurchaseReturnFormValues>({
    defaultValues: {
      items: (purchase.items ?? []).map(item => ({
        purchaseItemId: item.id,
        quantity: 0,
      })),
      reason: '',
    },
  });

  const handleSubmit = form.handleSubmit(async values => {
    const selectedItems = values.items.filter(item => Number(item.quantity) > 0);

    if (selectedItems.length === 0) {
      form.setError('root', {
        type: 'manual',
        message: t('purchases.minItems'),
      });
      return;
    }

    await onSubmit({
      items: selectedItems.map(item => ({
        purchaseItemId: item.purchaseItemId,
        quantity: Number(item.quantity),
      })),
      reason: values.reason,
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('purchases.modalTitle', { number: purchase.purchaseNumber })}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('purchases.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('purchases.submitting') : t('purchases.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-sm text-warning-700">
            {t('purchases.hint')}
          </p>
        </div>

        <div className="space-y-3">
          {(purchase.items ?? []).map((item, index) => {
            const remainingQuantity = item.remainingQuantity ?? item.quantity;
            const returnedQuantity = item.returnedQuantity ?? 0;
            const fieldError = form.formState.errors.items?.[index]?.quantity?.message;

            return (
              <div key={item.id} className="rounded-xl border border-secondary-200 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-secondary-900">
                      {item.productName ?? item.productId}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {item.productSku ?? t('purchases.noSku')}
                      {' · '}
                      {item.unitName ?? item.unitAbbreviation ?? item.unitId}
                    </p>
                    <p className="mt-2 text-sm text-secondary-600">
                      {t('purchases.costEach', { amount: formatCurrency(item.costPerUnit) })}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">{t('purchases.received')}</p>
                      <p className="font-medium text-secondary-900">{item.quantity}</p>
                    </div>
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">{t('purchases.returned')}</p>
                      <p className="font-medium text-secondary-900">{returnedQuantity}</p>
                    </div>
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">{t('purchases.available')}</p>
                      <p className="font-medium text-secondary-900">{remainingQuantity}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 max-w-[180px]">
                  <label htmlFor={`purchase-return-${item.id}`} className="label">
                    {t('purchases.returnQty')}
                  </label>
                  <input
                    id={`purchase-return-${item.id}`}
                    type="number"
                    min={0}
                    max={remainingQuantity}
                    className="input mt-1"
                    disabled={remainingQuantity <= 0}
                    {...form.register(`items.${index}.quantity`, {
                      valueAsNumber: true,
                      min: {
                        value: 0,
                        message: t('purchases.returnQtyMin'),
                      },
                      validate: value =>
                        value <= remainingQuantity ||
                        t('purchases.returnQtyMax', { count: remainingQuantity }),
                    })}
                  />
                  {fieldError && <p className="mt-1 text-sm text-danger-500">{fieldError}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <label htmlFor="purchase-return-reason" className="label">
            {t('purchases.reason')}
          </label>
          <textarea
            id="purchase-return-reason"
            className="input mt-1 min-h-[96px]"
            placeholder={t('purchases.reasonPlaceholder')}
            {...form.register('reason')}
          />
        </div>

        {(form.formState.errors.root?.message || error) && (
          <p className="text-sm text-danger-500">
            {form.formState.errors.root?.message ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}
