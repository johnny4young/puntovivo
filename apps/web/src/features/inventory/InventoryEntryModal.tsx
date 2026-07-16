import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { InitialInventoryMode, ProductSearchSelection } from '@/types';

export interface InventoryEntryFormValues {
  mode: InitialInventoryMode;
  quantity: number;
  cost: number;
  lotNumber: string;
  expiresAt: string;
  notes: string;
}

// ENG-179b — explicit `| undefined` on optional fields.
interface InventoryEntryModalProps {
  isOpen: boolean;
  selection: ProductSearchSelection | null;
  siteId?: string | null | undefined;
  siteName?: string | null | undefined;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: InventoryEntryFormValues) => Promise<void>;
}

function mapSelectionToForm(selection: ProductSearchSelection | null): InventoryEntryFormValues {
  return {
    mode: 'initial',
    quantity: 1,
    cost: selection?.product.initialCost ?? selection?.product.cost ?? 0,
    lotNumber: '',
    expiresAt: '',
    notes: '',
  };
}

export function InventoryEntryModal({
  isOpen,
  selection,
  siteId,
  siteName,
  isSaving,
  error,
  onClose,
  onSubmit,
}: InventoryEntryModalProps) {
  const { t } = useTranslation('inventory');
  const form = useForm<InventoryEntryFormValues>({
    defaultValues: mapSelectionToForm(selection),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const quantity = useWatch({ control: form.control, name: 'quantity' });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const normalizedQuantity = (Number(quantity) || 0) * (selection?.unit.equivalence ?? 0);
  const tracksLots = selection?.product.tracksLots === true;

  const modalTitle = selection
    ? tracksLots
      ? t('entry.titleLot')
      : mode === 'initial'
        ? t('entry.titleInitial')
        : t('entry.titlePhysical')
    : t('entry.titleDefault');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('entry.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={isSaving || !selection || (tracksLots && !siteId)}
          >
            {isSaving ? t('entry.submitting') : t('entry.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {!selection ? (
          <p className="text-sm text-secondary-500">{t('entry.noSelection')}</p>
        ) : (
          <>
            <div className="surface-panel-muted">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-secondary-900">{selection.product.name}</p>
                  <p className="text-sm text-secondary-500">
                    {selection.product.sku}
                    {selection.product.categoryName ? ` · ${selection.product.categoryName}` : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-secondary-500">{t('entry.currentStock')}</p>
                  <p className="text-lg font-semibold text-secondary-900">
                    {selection.product.stock}
                  </p>
                </div>
              </div>
            </div>

            {tracksLots ? (
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                {t('entry.lotModeHelp')}
              </div>
            ) : (
              <div>
                <label htmlFor="inventory-entry-mode" className="label">
                  {t('entry.mode')}
                </label>
                <select id="inventory-entry-mode" className="input mt-1" {...form.register('mode')}>
                  <option value="initial">
                    {t('entry.modeInitial', { label: t('table.initialInventory') })}
                  </option>
                  <option value="physical">
                    {t('entry.modePhysical', { label: t('table.physicalCount') })}
                  </option>
                </select>
              </div>
            )}

            {tracksLots && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="inventory-entry-lot-number" className="label">
                    {t('entry.lotNumber')}
                  </label>
                  <input
                    id="inventory-entry-lot-number"
                    className="input mt-1"
                    maxLength={120}
                    {...form.register('lotNumber', {
                      required: t('entry.lotNumberRequired'),
                    })}
                  />
                  {form.formState.errors.lotNumber && (
                    <p className="mt-1 text-sm text-danger-500">
                      {form.formState.errors.lotNumber.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="inventory-entry-expiry" className="label">
                    {t('entry.expiresAt')}
                  </label>
                  <input
                    id="inventory-entry-expiry"
                    type="date"
                    className="input mt-1"
                    {...form.register('expiresAt')}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="inventory-entry-quantity" className="label">
                  {tracksLots ? t('entry.lotQuantity') : t('table.countedQty')}
                </label>
                <input
                  id="inventory-entry-quantity"
                  type="number"
                  min={0.000001}
                  step="any"
                  className="input mt-1"
                  {...form.register('quantity', {
                    valueAsNumber: true,
                    min: { value: 0.000001, message: t('entry.quantityMin') },
                  })}
                />
                {form.formState.errors.quantity && (
                  <p className="mt-1 text-sm text-danger-500">
                    {form.formState.errors.quantity.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="inventory-entry-cost" className="label">
                  {tracksLots ? t('entry.lotUnitCost') : t('table.cost')}
                </label>
                <input
                  id="inventory-entry-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input mt-1"
                  {...form.register('cost', {
                    valueAsNumber: true,
                    min: { value: 0, message: t('entry.costMin') },
                  })}
                />
                {form.formState.errors.cost && (
                  <p className="mt-1 text-sm text-danger-500">
                    {form.formState.errors.cost.message}
                  </p>
                )}
              </div>
            </div>

            <div className="surface-panel py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">{t('table.unit')}</span>
                <span className="font-medium text-secondary-900">
                  {selection.unit.unitName ??
                    selection.unit.unitAbbreviation ??
                    selection.unit.unitId}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">{t('entry.equivalence')}</span>
                <span className="font-medium text-secondary-900">{selection.unit.equivalence}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">{t('table.normalized')}</span>
                <span className="font-medium text-secondary-900">{normalizedQuantity || 0}</span>
              </div>
              {siteName && (
                <p className="mt-3 text-xs leading-5 text-secondary-500">
                  {t('entry.siteScope', { site: siteName })}
                </p>
              )}
              {tracksLots && !siteId && (
                <p className="mt-3 text-xs leading-5 text-danger-600">
                  {t('entry.lotSiteRequired')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="inventory-entry-notes" className="label">
                {t('table.notes')}
              </label>
              <textarea
                id="inventory-entry-notes"
                className="input mt-1 min-h-[96px]"
                placeholder={t('entry.notesPlaceholder')}
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
