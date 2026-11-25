import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { SaleItem } from '@/types';
import {
  lineBaseQuantity,
  RETURN_EPSILON as EPSILON,
  type ReturnPreviewState,
  type ReturnSelection,
} from '@/features/sales/returns/useReturnDraft';

/** Lot quantities and serial numbers for one selected line that tracks them. */
export function ReturnLineAllocations({
  line,
  selection,
}: {
  line: SaleItem;
  selection: ReturnSelection;
}) {
  const { t } = useTranslation('sales');
  const quantity = selection.selectedQuantities[line.id];
  if (quantity === undefined) return null;
  const requiredBase = lineBaseQuantity(line, quantity);
  return (
    <>
      {(line.lots?.length ?? 0) > 0 && (
        <fieldset className="mt-3 rounded-lg border border-line/60 bg-surface-2/65 p-3">
          <legend className="px-1 text-xs font-semibold text-secondary-600">
            {t('refund.lotsLegend', { quantity: requiredBase })}
          </legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {line.lots
              ?.filter(lot => lot.remainingQuantity > EPSILON)
              .map(lot => (
                <label key={lot.id} className="text-xs text-secondary-600">
                  <span className="block truncate">
                    {t('refund.lotLabel', { lot: lot.lotNumber, quantity: lot.remainingQuantity })}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={lot.remainingQuantity}
                    step="any"
                    value={selection.lotsFor(line.id)[lot.id] ?? 0}
                    onChange={event =>
                      selection.setLotQuantity(
                        line,
                        lot.id,
                        Number(event.target.value),
                        lot.remainingQuantity
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-sm text-secondary-950"
                  />
                </label>
              ))}
          </div>
        </fieldset>
      )}
      {(line.serials?.length ?? 0) > 0 && (
        <fieldset className="mt-3 rounded-lg border border-line/60 bg-surface-2/65 p-3">
          <legend className="px-1 text-xs font-semibold text-secondary-600">
            {t('refund.serialsLegend', { quantity: requiredBase })}
          </legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {line.serials
              ?.filter(serial => !serial.returned)
              .map(serial => (
                <label
                  key={serial.id}
                  className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface px-2 py-2 text-xs text-secondary-700"
                >
                  <input
                    type="checkbox"
                    checked={selection.serialsFor(line.id).includes(serial.productSerialId)}
                    onChange={event =>
                      selection.toggleSerial(line, serial.productSerialId, event.target.checked)
                    }
                  />
                  <span className="font-mono">{serial.serialNumber}</span>
                </label>
              ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

/** One reference field per card or transfer portion the refund sends back outside the drawer. */
export function ReturnExternalReferences({
  preview,
  currencyCode,
}: {
  preview: ReturnPreviewState;
  currencyCode?: string | undefined;
}) {
  const { t } = useTranslation('sales');
  if (preview.externalAllocations.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line/70 bg-surface-2/55 px-4 py-4">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
        {t('refund.externalReferencesLabel')}
      </p>
      <p className="mt-1 text-sm text-secondary-600">{t('refund.externalReferencesHint')}</p>
      <div className="mt-3 space-y-3">
        {preview.externalAllocations.map(allocation => {
          const key = preview.referenceKey(allocation);
          return (
            <label key={key} className="block text-sm font-medium text-secondary-700">
              {t('refund.externalReferenceFor', {
                method: t(`payment.${allocation.originalMethod}`),
                amount: formatCurrency(allocation.amount, currencyCode),
              })}
              <input
                type="text"
                maxLength={120}
                value={preview.externalReferences[key] ?? ''}
                onChange={event => preview.setExternalReference(key, event.target.value)}
                className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-secondary-950"
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
