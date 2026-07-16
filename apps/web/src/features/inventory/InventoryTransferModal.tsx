import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import type { InventoryBalanceListItem } from '@/types';
import type { InventoryBalancesPanelSite } from './InventoryBalancesPanel';

export interface InventoryTransferFormValues {
  fromSiteId: string;
  toSiteId: string;
  productId: string;
  quantity: number;
  notes: string;
  defer: boolean;
  serialIds?: string[];
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

function firstAlternativeSite(sites: InventoryBalancesPanelSite[], excludeId: string): string {
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
  const activeSites = useMemo(() => sites.filter(site => site.isActive !== false), [sites]);

  // The parent conditionally mounts this lazy modal only while it is open, so
  // closing it tears down the form state. This avoids a reset `useEffect` that
  // would fire twice under StrictMode.
  const [fromSiteId] = useState(initialFromSiteId);
  const [toSiteId, setToSiteId] = useState(() =>
    firstAlternativeSite(activeSites, initialFromSiteId)
  );
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [defer, setDefer] = useState(false);
  const [serialIds, setSerialIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const productOptions = useMemo(
    () =>
      sourceBalances
        .filter(balance => balance.onHand > 0)
        .map(balance => ({
          value: balance.productId,
          label: `${balance.productName} — ${balance.productSku}`,
          onHand: balance.onHand,
          tracksSerials: balance.tracksSerials,
        })),
    [sourceBalances]
  );

  const selectedBalance = productOptions.find(option => option.value === productId);
  const tracksSerials = selectedBalance?.tracksSerials === true;
  const serialsQuery = trpc.productSerials.list.useQuery(
    { siteId: fromSiteId, productId, sellableOnly: true },
    { enabled: tracksSerials && fromSiteId.length > 0 && productId.length > 0 }
  );
  const availableSerials = serialsQuery.data?.items ?? [];
  const parsedQuantity = tracksSerials ? serialIds.length : Number.parseFloat(quantity);

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
      defer,
      ...(tracksSerials ? { serialIds } : {}),
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
      <form id="inventory-transfer-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">{t('transferModal.fromSite')}</span>
            <select className="input mt-1" value={fromSiteId} disabled aria-disabled="true">
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
            onChange={event => {
              setProductId(event.target.value);
              setQuantity('');
              setSerialIds([]);
            }}
          >
            <option value="">{t('transferModal.productPlaceholder')}</option>
            {productOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label} ·{' '}
                {t('transferModal.onHand', {
                  amount: option.onHand.toLocaleString(),
                })}
              </option>
            ))}
          </select>
          {productOptions.length === 0 && (
            <p className="mt-1 text-sm text-secondary-500">{t('transferModal.noStockAtSource')}</p>
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
            value={tracksSerials ? String(serialIds.length) : quantity}
            readOnly={tracksSerials}
            aria-readonly={tracksSerials}
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

        {tracksSerials && (
          <fieldset className="rounded-xl border border-secondary-200 p-4">
            <legend className="px-1 text-sm font-medium text-secondary-900">
              {t('transferModal.serials')}
            </legend>
            <p className="mb-3 text-xs text-secondary-500">{t('transferModal.serialsHelp')}</p>
            {serialsQuery.isLoading && (
              <p className="text-sm text-secondary-500">{t('transferModal.serialsLoading')}</p>
            )}
            <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
              {availableSerials.map(serial => {
                const checked = serialIds.includes(serial.id);
                return (
                  <label
                    key={serial.id}
                    className="flex items-center gap-2 rounded-lg border border-secondary-200 px-3 py-2 font-mono text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSerialIds(current =>
                          checked ? current.filter(id => id !== serial.id) : [...current, serial.id]
                        )
                      }
                    />
                    {serial.serialNumber}
                  </label>
                );
              })}
            </div>
            {!serialsQuery.isLoading && availableSerials.length === 0 && (
              <p className="text-sm text-warning-700">{t('transferModal.noSerials')}</p>
            )}
            <p className="mt-3 text-xs text-secondary-500">
              {t('transferModal.serialCount', { count: serialIds.length })}
            </p>
          </fieldset>
        )}

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

        <label className="flex items-start gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-secondary-300"
            checked={defer}
            onChange={event => setDefer(event.target.checked)}
          />
          <span>
            <span className="font-medium text-secondary-900">{t('transferModal.deferLabel')}</span>
            <span className="block text-xs text-secondary-500">{t('transferModal.deferHelp')}</span>
          </span>
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
