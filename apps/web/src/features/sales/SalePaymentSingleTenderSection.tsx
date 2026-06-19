/**
 * Single-tender section of the sale payment modal (method tiles + amount +
 * change/outstanding + split-enable). Rediseño §06 / ENG-090.
 *
 * ENG-178 — JSX extracted verbatim from the former single-file
 * `SalePaymentModal.tsx`. Presentational: receives the RHF `form` + derived
 * flags from `useSalePaymentModal`. The hidden sr-only `<select>` stays the
 * registered form control (the tiles only drive `setValue`).
 *
 * @module features/sales/SalePaymentSingleTenderSection
 */
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { formatCurrency } from '@/lib/utils';
import type { PaymentMethod } from '@/types';
import { QuickDenominationSelector } from './QuickDenominationSelector';
import type { SalePaymentValues } from './salePaymentModal.types';
import { PAYMENT_METHOD_TILES } from './salePaymentModal.constants';

interface SalePaymentSingleTenderSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  paymentMethod: PaymentMethod;
  creditMethodAvailable: boolean;
  isCash: boolean;
  isCredit: boolean;
  grandTotal: number;
  amountReceivedValue: number;
  change: number;
  outstanding: number;
  handleEnableSplit: () => void;
}

export function SalePaymentSingleTenderSection({
  form,
  paymentMethod,
  creditMethodAvailable,
  isCash,
  isCredit,
  grandTotal,
  amountReceivedValue,
  change,
  outstanding,
  handleEnableSplit,
}: SalePaymentSingleTenderSectionProps) {
  const { t } = useTranslation('sales');

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <span className="label">{t('payment.paymentMethod')}</span>
          {/*
            Rediseño §06 — método de pago como tiles de 2 columnas.
            Cada tile es un .pv-btn.tile (64px, columna, ícono +
            etiqueta); el método activo añade .on. El <select>
            registrado vive oculto (sr-only) y sigue siendo la
            fuente de verdad del formulario: las tiles solo llaman a
            form.setValue('paymentMethod', …). Mantener el select
            preserva la accesibilidad por teclado y el contrato de
            los tests (selectOptions / toHaveValue / testids).
          */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PAYMENT_METHOD_TILES.filter(
              // ENG-090 — credit tile gated to manager + admin AND
              // requires a customer attached. Cashier never sees it
              // (server router also enforces the role gate on the
              // credit payment method). Walk-in (no customer) hides
              // the tile because credit is per-customer by definition.
              tile => tile.method !== 'credit' || creditMethodAvailable
            ).map(tile => {
              const TileIcon = tile.icon;
              const isActive = paymentMethod === tile.method;
              return (
                <button
                  key={tile.method}
                  type="button"
                  className={`pv-btn outline tile${isActive ? ' on' : ''}`}
                  aria-pressed={isActive}
                  onClick={() =>
                    form.setValue('paymentMethod', tile.method, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <TileIcon aria-hidden="true" />
                  <span style={{ fontSize: 12 }}>{t(tile.labelKey)}</span>
                </button>
              );
            })}
          </div>
          <label htmlFor="sale-payment-method" className="sr-only">
            {t('payment.paymentMethod')}
          </label>
          <select
            id="sale-payment-method"
            className="sr-only"
            data-testid="sale-payment-method-select"
            {...form.register('paymentMethod')}
          >
            <option value="cash">{t('payment.cash')}</option>
            <option value="card">{t('payment.card')}</option>
            <option value="transfer">{t('payment.transfer')}</option>
            {/* ENG-090 — credit option gated to manager + admin AND
                requires a customer attached. Cashier never sees it
                (server router also enforces the role gate on the
                credit payment method). Walk-in (no customer) hides the
                option because credit is per-customer by definition. */}
            {creditMethodAvailable && (
              <option value="credit" data-testid="sale-payment-method-credit-option">
                {t('payment.credit')}
              </option>
            )}
            <option value="other">{t('payment.other')}</option>
          </select>
        </div>

        <div>
          <label htmlFor="sale-payment-amount" className="label">
            {t('payment.amountReceived')}
          </label>
          <input
            id="sale-payment-amount"
            type="number"
            min={0}
            step="0.01"
            className="input mt-1"
            disabled={isCredit}
            {...form.register('amountReceived', {
              valueAsNumber: true,
              min: { value: 0, message: t('payment.amountNegative') },
            })}
          />
          {form.formState.errors.amountReceived && (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.amountReceived.message}
            </p>
          )}
        </div>
      </div>

      {isCash && grandTotal > 0 && (
        <QuickDenominationSelector
          total={grandTotal}
          currentValue={amountReceivedValue}
          onSelect={amount =>
            form.setValue('amountReceived', amount, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
      )}

      {/* ENG-090 — the change/outstanding overlay does not
          apply to credit sales (the entire total is deferred
          onto the ledger). The credit customer card above
          already carries the relevant amounts. */}
      {!isCredit && (
        <div className="surface-panel-muted text-sm">
          <div className="flex items-center justify-between">
            <span className="text-secondary-500">{t('payment.amountReceived')}</span>
            <span className="font-medium text-secondary-900">{formatCurrency(amountReceivedValue)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-secondary-500">{isCash ? t('payment.change') : t('payment.balance')}</span>
            <span className="font-medium text-secondary-900">
              {formatCurrency(isCash ? change : outstanding)}
            </span>
          </div>
        </div>
      )}

      {/* ENG-014 — when the single-tender method is already
          credit, splitting is redundant: the operator has
          signaled the entire sale is on account. To split a
          credit portion, the operator starts from a non-credit
          method (cash / card / transfer) and adds a credit row
          inside split mode via the tender selector. */}
      {!isCredit && (
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-2 text-sm"
          onClick={handleEnableSplit}
        >
          <Plus className="h-4 w-4" />
          {t('payment.splitEnable')}
        </button>
      )}
    </>
  );
}
