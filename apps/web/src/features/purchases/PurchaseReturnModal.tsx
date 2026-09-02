import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { getSerializedQuantity } from '@/features/inventory/serialNumbers';
import { formatCurrency } from '@/lib/utils';
import type { Purchase } from '@/types';
import { ExactLotAllocationEditor } from '@/features/inventory/LotEditors';
import {
  normalizeExactLotAllocations,
  sumExactLotAllocations,
  type ExactLotAllocationDraft,
  type ExactLotOption,
} from '@/features/inventory/lotForm';

interface PurchaseReturnFormValues {
  items: Array<{
    purchaseItemId: string;
    quantity: number;
    serialIds: string[];
  }>;
  reason: string;
}

export interface PurchaseReturnValues {
  items: Array<{
    purchaseItemId: string;
    quantity: number;
    serialIds?: string[];
    lotAllocations?: Array<{ purchaseItemLotId: string; baseQuantity: number }>;
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

const RETURN_QUANTITY_EPSILON = 0.000001;

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
        serialIds: [],
      })),
      reason: '',
    },
  });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const [lotAllocationsByItemId, setLotAllocationsByItemId] = useState<
    Record<string, ExactLotAllocationDraft>
  >(() =>
    Object.fromEntries(
      (purchase.items ?? []).filter(item => item.tracksLots).map(item => [item.id, {}])
    )
  );
  const hasReturnableItems = (purchase.items ?? []).some(
    item => (item.returnableQuantity ?? 0) > 0
  );

  const handleSubmit = form.handleSubmit(async values => {
    const selectedItems = values.items.filter((item, index) => {
      const purchaseItem = purchase.items?.[index];
      if (purchaseItem?.tracksSerials) return item.serialIds.length > 0;
      if (purchaseItem?.tracksLots) {
        return sumExactLotAllocations(lotAllocationsByItemId[item.purchaseItemId] ?? {}) > 0;
      }
      return Number(item.quantity) > 0;
    });

    if (selectedItems.length === 0) {
      form.setError('root', {
        type: 'manual',
        message: t('purchases.minItems'),
      });
      return;
    }

    const normalizedItems: PurchaseReturnValues['items'] = [];
    for (const item of selectedItems) {
      const purchaseItem = purchase.items?.find(candidate => candidate.id === item.purchaseItemId);
      const lotOptions: ExactLotOption[] = (purchaseItem?.lots ?? []).map(lot => ({
        id: lot.id,
        lotNumber: lot.lotNumber,
        expiresAt: lot.expiresAt,
        status: lot.currentStatus,
        availableQuantity: lot.availableBaseQuantity,
      }));
      const lotAllocations = purchaseItem?.tracksLots
        ? normalizeExactLotAllocations(
            lotOptions,
            lotAllocationsByItemId[item.purchaseItemId] ?? {}
          )
        : null;
      if (purchaseItem?.tracksLots && !lotAllocations) {
        form.setError('root', {
          type: 'manual',
          message: t('purchases.invalidLotAllocation'),
        });
        return;
      }
      const lotBaseQuantity = lotAllocations?.reduce(
        (sum, allocation) => sum + allocation.quantity,
        0
      );
      const returnableQuantity = purchaseItem?.returnableQuantity ?? 0;
      const selectedQuantity =
        item.serialIds.length > 0
          ? getSerializedQuantity(item.serialIds.length, purchaseItem?.unitEquivalence ?? 1)
          : purchaseItem?.tracksLots
            ? (lotBaseQuantity ?? 0) / (purchaseItem.unitEquivalence || 1)
            : Number(item.quantity);
      if (selectedQuantity - returnableQuantity > RETURN_QUANTITY_EPSILON) {
        form.setError('root', {
          type: 'manual',
          message: t('purchases.returnQtyMax', { count: returnableQuantity }),
        });
        return;
      }
      normalizedItems.push({
        purchaseItemId: item.purchaseItemId,
        quantity: selectedQuantity,
        ...(item.serialIds.length > 0 ? { serialIds: item.serialIds } : {}),
        ...(lotAllocations
          ? {
              lotAllocations: lotAllocations.map(allocation => ({
                purchaseItemLotId: allocation.lotId,
                baseQuantity: allocation.quantity,
              })),
            }
          : {}),
      });
    }
    await onSubmit({ items: normalizedItems, reason: values.reason });
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
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSaving || !hasReturnableItems}
          >
            {isSaving ? t('purchases.submitting') : t('purchases.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-sm text-warning-700">{t('purchases.hint')}</p>
        </div>

        <div className="space-y-3">
          {(purchase.items ?? []).map((item, index) => {
            const returnableQuantity = item.returnableQuantity ?? 0;
            const returnedQuantity = item.returnedQuantity ?? 0;
            const fieldError = form.formState.errors.items?.[index]?.quantity?.message;
            const availableSerials = (item.serials ?? []).filter(
              serial =>
                serial.currentSiteId === purchase.siteId &&
                (serial.status === 'in_stock' || serial.status === 'returned')
            );
            const selectedSerialCount = watchedItems[index]?.serialIds.length ?? 0;
            const selectedSerialIds = watchedItems[index]?.serialIds ?? [];
            const maximumReturnableSerialCount = Math.floor(
              returnableQuantity * item.unitEquivalence + RETURN_QUANTITY_EPSILON
            );
            const selectedQuantity = getSerializedQuantity(
              selectedSerialCount,
              item.unitEquivalence
            );
            const lotOptions: ExactLotOption[] = (item.lots ?? []).map(lot => ({
              id: lot.id,
              lotNumber: lot.lotNumber,
              expiresAt: lot.expiresAt,
              status: lot.currentStatus,
              availableQuantity: lot.availableBaseQuantity,
            }));
            const lotAllocationDraft = lotAllocationsByItemId[item.id] ?? {};
            const selectedLotBaseQuantity = sumExactLotAllocations(lotAllocationDraft);

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
                      <p className="text-secondary-500">{t('purchases.availableToReturn')}</p>
                      <p className="font-medium text-secondary-900">{returnableQuantity}</p>
                    </div>
                  </div>
                </div>

                {item.tracksSerials && (
                  <fieldset className="mt-4">
                    <legend className="label">{t('purchases.returnSerials')}</legend>
                    <p className="mb-2 text-xs text-secondary-500">
                      {t('purchases.returnSerialsHelp')}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {availableSerials.map(serial => (
                        <label
                          key={serial.id}
                          className="flex items-center gap-2 rounded-lg border border-secondary-200 px-3 py-2 font-mono text-sm"
                        >
                          <input
                            type="checkbox"
                            value={serial.id}
                            disabled={
                              isSaving ||
                              returnableQuantity <= 0 ||
                              (!selectedSerialIds.includes(serial.id) &&
                                selectedSerialCount >= maximumReturnableSerialCount)
                            }
                            {...form.register(`items.${index}.serialIds`)}
                          />
                          {serial.serialNumber}
                        </label>
                      ))}
                    </div>
                    {availableSerials.length === 0 && (
                      <p className="text-sm text-warning-700">
                        {t('purchases.noReturnableSerials')}
                      </p>
                    )}
                  </fieldset>
                )}

                {item.tracksLots && (
                  <ExactLotAllocationEditor
                    idPrefix={`purchase-return-${item.id}`}
                    options={lotOptions}
                    value={lotAllocationDraft}
                    disabled={isSaving || returnableQuantity <= 0}
                    onChange={next =>
                      setLotAllocationsByItemId(current => ({ ...current, [item.id]: next }))
                    }
                  />
                )}

                <div className="mt-4 max-w-[180px]">
                  <label htmlFor={`purchase-return-${item.id}`} className="label">
                    {t('purchases.returnQty')}
                  </label>
                  {item.tracksSerials || item.tracksLots ? (
                    <input
                      id={`purchase-return-${item.id}`}
                      type="number"
                      className="input mt-1"
                      value={
                        item.tracksLots
                          ? selectedLotBaseQuantity / item.unitEquivalence
                          : selectedQuantity
                      }
                      readOnly
                      aria-readonly="true"
                      disabled={returnableQuantity <= 0}
                    />
                  ) : (
                    <input
                      id={`purchase-return-${item.id}`}
                      type="number"
                      min={0}
                      max={returnableQuantity}
                      step="any"
                      className="input mt-1"
                      disabled={returnableQuantity <= 0}
                      {...form.register(`items.${index}.quantity`, {
                        valueAsNumber: true,
                        min: {
                          value: 0,
                          message: t('purchases.returnQtyMin'),
                        },
                        validate: value =>
                          value <= returnableQuantity ||
                          t('purchases.returnQtyMax', { count: returnableQuantity }),
                      })}
                    />
                  )}
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
          <p className="text-sm text-danger-500">{form.formState.errors.root?.message ?? error}</p>
        )}
      </form>
    </Modal>
  );
}
