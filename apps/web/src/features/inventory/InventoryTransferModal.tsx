import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import type { InventoryBalanceListItem } from '@/types';
import type { InventoryBalancesPanelSite } from './InventoryBalancesPanel';

export interface InventoryTransferFormValues {
  fromSiteId: string;
  toSiteId: string;
  productId: string;
  quantity: number;
  notes: string;
}

interface InventoryTransferModalProps {
  isOpen: boolean;
  sites: InventoryBalancesPanelSite[];
  sourceBalances: InventoryBalanceListItem[];
  initialFromSiteId: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: InventoryTransferFormValues) => Promise<void>;
}

function firstAlternativeSite(
  sites: InventoryBalancesPanelSite[],
  excludeId: string
): string {
  const alternative = sites.find(site => site.id !== excludeId && site.isActive !== false);
  return alternative?.id ?? '';
}

export function InventoryTransferModal({
  isOpen,
  sites,
  sourceBalances,
  initialFromSiteId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: InventoryTransferModalProps) {
  const { t } = useTranslation('inventory');
  const activeSites = useMemo(
    () => sites.filter(site => site.isActive !== false),
    [sites]
  );

  // Form state is reset by remounting the component — the parent passes
  // `key={isOpen ? 'open' : 'closed'}` so React tears down the tree when the
  // modal closes. This avoids a reset `useEffect` that would fire twice under
  // StrictMode.
  const [fromSiteId] = useState(initialFromSiteId);
  const [toSiteId, setToSiteId] = useState(() =>
    firstAlternativeSite(activeSites, initialFromSiteId)
  );
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const productOptions = useMemo(
    () =>
      sourceBalances
        .filter(balance => balance.onHand > 0)
        .map(balance => ({
          value: balance.productId,
          label: `${balance.productName} — ${balance.productSku}`,
          onHand: balance.onHand,
        })),
    [sourceBalances]
  );

  const selectedBalance = productOptions.find(option => option.value === productId);
  const parsedQuantity = Number.parseFloat(quantity);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!fromSiteId || !toSiteId) {
      setFormError(t('transferModal.errors.sitesRequired'));
      return;
    }
    if (fromSiteId === toSiteId) {
      setFormError(t('transferModal.errors.sitesIdentical'));
      return;
    }
    if (!productId) {
      setFormError(t('transferModal.errors.productRequired'));
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setFormError(t('transferModal.errors.quantityInvalid'));
      return;
    }
    if (selectedBalance && parsedQuantity > selectedBalance.onHand) {
      setFormError(
        t('transferModal.errors.quantityExceedsOnHand', {
          available: selectedBalance.onHand.toLocaleString(),
        })
      );
      return;
    }

    await onSubmit({
      fromSiteId,
      toSiteId,
      productId,
      quantity: parsedQuantity,
      notes: notes.trim(),
    });
  }

  const activeError = formError ?? error;
  const canSubmit =
    !isSaving &&
    fromSiteId.length > 0 &&
    toSiteId.length > 0 &&
    fromSiteId !== toSiteId &&
    productId.length > 0 &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('transferModal.title')}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            {t('transferModal.cancel')}
          </button>
          <button
            type="submit"
            form="inventory-transfer-form"
            className="btn-primary"
            disabled={!canSubmit}
          >
            {isSaving ? t('transferModal.submitting') : t('transferModal.submit')}
          </button>
        </div>
      }
    >
      <form
        id="inventory-transfer-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">{t('transferModal.fromSite')}</span>
            <select
              className="input mt-1"
              value={fromSiteId}
              disabled
              aria-disabled="true"
            >
              {activeSites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">{t('transferModal.toSite')}</span>
            <select
              className="input mt-1"
              value={toSiteId}
              onChange={event => setToSiteId(event.target.value)}
            >
              {activeSites
                .filter(site => site.id !== fromSiteId)
                .map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">{t('transferModal.product')}</span>
          <select
            className="input mt-1"
            value={productId}
            onChange={event => setProductId(event.target.value)}
          >
            <option value="">{t('transferModal.productPlaceholder')}</option>
            {productOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label} · {t('transferModal.onHand', {
                  amount: option.onHand.toLocaleString(),
                })}
              </option>
            ))}
          </select>
          {productOptions.length === 0 && (
            <p className="mt-1 text-sm text-secondary-500">
              {t('transferModal.noStockAtSource')}
            </p>
          )}
        </label>

        <label className="block md:max-w-xs">
          <span className="label">{t('transferModal.quantity')}</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            className="input mt-1"
            value={quantity}
            onChange={event => setQuantity(event.target.value)}
          />
          {selectedBalance && (
            <p className="mt-1 text-sm text-secondary-500">
              {t('transferModal.available', {
                amount: selectedBalance.onHand.toLocaleString(),
              })}
            </p>
          )}
        </label>

        <label className="block">
          <span className="label">{t('transferModal.notes')}</span>
          <textarea
            className="input mt-1"
            rows={2}
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder={t('transferModal.notesPlaceholder')}
          />
        </label>

        {activeError && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
            {activeError}
          </div>
        )}
      </form>
    </Modal>
  );
}
