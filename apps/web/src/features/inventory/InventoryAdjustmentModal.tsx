import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

// ENG-179b — explicit `| undefined` on optional fields.
export interface InventoryAdjustmentProduct {
  id: string;
  name: string;
  sku: string;
  stock: number;
  minStock: number;
  tracksLots: boolean;
  tracksSerials?: boolean | undefined;
  categoryName?: string | null | undefined;
}

export interface InventoryAdjustmentFormValues {
  newStock: number;
  notes: string;
}

interface InventoryAdjustmentModalProps {
  isOpen: boolean;
  product: InventoryAdjustmentProduct | null;
  siteName?: string | null | undefined;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: InventoryAdjustmentFormValues) => Promise<void>;
}

function mapProductToForm(
  product: InventoryAdjustmentProduct | null
): InventoryAdjustmentFormValues {
  return {
    newStock: product?.stock ?? 0,
    notes: '',
  };
}

export function InventoryAdjustmentModal({
  isOpen,
  product,
  siteName,
  isSaving,
  error,
  onClose,
  onSubmit,
}: InventoryAdjustmentModalProps) {
  const { t } = useTranslation('inventory');
  const form = useForm<InventoryAdjustmentFormValues>({
    defaultValues: mapProductToForm(product),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const nextStock = useWatch({ control: form.control, name: 'newStock' });
  const currentStock = product?.stock ?? 0;
  const delta = (Number(nextStock) || 0) - currentStock;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? t('adjustment.title', { name: product.name }) : t('adjustment.titleDefault')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('adjustment.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={
              isSaving || !product || product.tracksLots || product.tracksSerials === true
            }
          >
            {isSaving ? t('adjustment.submitting') : t('adjustment.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {!product ? (
          <p className="text-sm text-secondary-500">{t('adjustment.noProduct')}</p>
        ) : (
          <>
            <div className="surface-panel-muted">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-secondary-900">{product.name}</p>
                  <p className="text-sm text-secondary-500">
                    {product.sku}
                    {product.categoryName ? ` · ${product.categoryName}` : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-secondary-500">{t('adjustment.currentStock')}</p>
                  <p className="text-lg font-semibold text-secondary-900">{product.stock}</p>
                </div>
              </div>
            </div>

            {product.tracksLots && (
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                {t('adjustment.lotTrackedHelp')}
              </div>
            )}
            {product.tracksSerials && (
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                {t('adjustment.serialTrackedHelp')}
              </div>
            )}

            <div>
              <label htmlFor="inventory-new-stock" className="label">
                {t('table.stockAfter')}
              </label>
              <input
                id="inventory-new-stock"
                type="number"
                min={0}
                step="any"
                className="input mt-1"
                readOnly={product.tracksLots || product.tracksSerials}
                aria-readonly={product.tracksLots || product.tracksSerials}
                {...form.register('newStock', {
                  valueAsNumber: true,
                  min: { value: 0, message: t('adjustment.stockMin') },
                })}
              />
              {form.formState.errors.newStock && (
                <p className="mt-1 text-sm text-danger-500">
                  {form.formState.errors.newStock.message}
                </p>
              )}
            </div>

            <div className="surface-panel py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">{t('adjustment.movement')}</span>
                <span
                  className={
                    delta > 0
                      ? 'font-medium text-success-600'
                      : delta < 0
                        ? 'font-medium text-danger-600'
                        : 'font-medium text-secondary-700'
                  }
                >
                  {delta > 0 ? '+' : ''}
                  {delta}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">{t('adjustment.lowStockThreshold')}</span>
                <span className="font-medium text-secondary-900">{product.minStock}</span>
              </div>
              {siteName && (
                <p className="mt-3 text-xs leading-5 text-secondary-500">
                  {t('adjustment.siteScope', { site: siteName })}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="inventory-adjustment-notes" className="label">
                {t('table.notes')}
              </label>
              <textarea
                id="inventory-adjustment-notes"
                className="input mt-1 min-h-[96px]"
                placeholder={t('adjustment.notesPlaceholder')}
                {...form.register('notes')}
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
