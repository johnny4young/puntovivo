import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { Provider } from '@/types';
import { LotReceiptEditor } from '@/features/inventory/LotEditors';
import {
  createLotReceiptDraft,
  normalizeLotReceipts,
  quantitiesMatch,
  sumLotReceiptQuantity,
  type LotReceiptDraft,
  type LotReceiptPayload,
} from '@/features/inventory/lotForm';
import type { PurchaseCartItem } from './purchaseCart';

export interface PurchaseFinalizeValues {
  providerId: string;
  notes: string;
  lotReceiptsByItemKey: Record<string, LotReceiptPayload[]>;
}

interface PurchaseFinalizeModalProps {
  isOpen: boolean;
  total: number;
  providers: Provider[];
  items: PurchaseCartItem[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: PurchaseFinalizeValues) => Promise<void>;
  onInvalid?: (() => void) | undefined;
}

export function PurchaseFinalizeModal({
  isOpen,
  total,
  providers,
  items,
  isSaving,
  error,
  onClose,
  onSubmit,
  onInvalid,
}: PurchaseFinalizeModalProps) {
  const { t } = useTranslation(['purchases', 'common', 'inventory']);
  const form = useForm<PurchaseFinalizeValues>({
    defaultValues: {
      providerId: '',
      notes: '',
      lotReceiptsByItemKey: {},
    },
  });
  const [lotDraftsByItemKey, setLotDraftsByItemKey] = useState<Record<string, LotReceiptDraft[]>>(
    () =>
      Object.fromEntries(
        items
          .filter(item => item.tracksLots)
          .map(item => [
            item.key,
            [
              createLotReceiptDraft({
                baseQuantity: String(item.quantity * item.unitEquivalence),
              }),
            ],
          ])
      )
  );

  const handleSubmit = form.handleSubmit(
    async values => {
      const lotReceiptsByItemKey: Record<string, LotReceiptPayload[]> = {};
      for (const item of items.filter(candidate => candidate.tracksLots)) {
        const drafts = lotDraftsByItemKey[item.key] ?? [];
        const normalized = normalizeLotReceipts(drafts);
        const expected = item.quantity * item.unitEquivalence;
        if (!normalized || !quantitiesMatch(sumLotReceiptQuantity(drafts), expected)) {
          form.setError('root', {
            type: 'manual',
            message: t('inventory:lots.receipt.invalidExact'),
          });
          onInvalid?.();
          return;
        }
        lotReceiptsByItemKey[item.key] = normalized;
      }
      await onSubmit({ ...values, lotReceiptsByItemKey });
    },
    () => onInvalid?.()
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('checkout.register')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('common:actions.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('purchases:checkout.submitting') : t('purchases:checkout.register')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">{t('purchases:checkout.purchaseTotal')}</p>
          <p className="mt-1 text-3xl font-semibold text-primary-900">{formatCurrency(total)}</p>
        </div>

        <div>
          <label htmlFor="purchase-provider" className="label">
            {t('purchases:checkout.provider')}
          </label>
          <select
            id="purchase-provider"
            className="input mt-1"
            {...form.register('providerId', {
              required: t('purchases:checkout.providerRequired'),
            })}
          >
            <option value="">{t('purchases:checkout.selectProvider')}</option>
            {providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {form.formState.errors.providerId && (
            <p className="mt-1 text-sm text-danger-500" role="alert">
              {form.formState.errors.providerId.message}
            </p>
          )}
        </div>

        {items
          .filter(item => item.tracksLots)
          .map(item => (
            <section key={item.key} className="rounded-xl border border-secondary-200 p-4">
              <p className="font-medium text-secondary-900">{item.productName}</p>
              <p className="text-xs text-secondary-500">
                {item.productSku} · {item.unitName}
              </p>
              <LotReceiptEditor
                idPrefix={`purchase-${item.key.replaceAll(':', '-')}`}
                value={lotDraftsByItemKey[item.key] ?? []}
                expectedBaseQuantity={item.quantity * item.unitEquivalence}
                disabled={isSaving}
                onChange={next =>
                  setLotDraftsByItemKey(current => ({ ...current, [item.key]: next }))
                }
              />
            </section>
          ))}

        <div>
          <label htmlFor="purchase-notes" className="label">
            {t('purchases:details.notes')}
          </label>
          <textarea
            id="purchase-notes"
            className="input mt-1 min-h-[96px]"
            placeholder={t('checkout.notesPlaceholder')}
            {...form.register('notes')}
          />
        </div>

        {(form.formState.errors.root?.message || error) && (
          <p className="text-sm text-danger-500" role="alert">
            {form.formState.errors.root?.message ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}
