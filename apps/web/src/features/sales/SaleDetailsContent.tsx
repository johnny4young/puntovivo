import { useTranslation } from 'react-i18next';
import { hasSplitPayments } from '@/features/sales/checkoutPayment';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Sale } from '@/types';
import type { PaymentMethod } from '@/types/ui';

const PAYMENT_METHOD_TRANSLATION_KEYS = {
  cash: 'payment.cash',
  card: 'payment.card',
  transfer: 'payment.transfer',
  credit: 'payment.credit',
  loyalty: 'payment.loyalty',
  store_credit: 'payment.storeCredit',
  other: 'payment.other',
} as const satisfies Record<PaymentMethod, string>;

interface SaleDetailsContentProps {
  sale: Sale;
  returnError: string | null;
  voidError: string | null;
  printError: string | null;
  onStartExchange?: ((saleReturn: NonNullable<Sale['returns']>[number]) => void) | undefined;
}

export function SaleDetailsContent({
  sale,
  returnError,
  voidError,
  printError,
  onStartExchange,
}: SaleDetailsContentProps) {
  const { t } = useTranslation('sales');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('details.customer')}
          </p>
          <p className="mt-2 font-medium text-secondary-900">
            {sale.customerNameSnapshot ?? sale.customerName ?? t('details.walkIn')}
          </p>
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('details.payment')}
          </p>
          <p className="mt-2 font-medium capitalize text-secondary-900">
            {t(PAYMENT_METHOD_TRANSLATION_KEYS[sale.paymentMethod])}
          </p>
          <p className="text-sm capitalize text-secondary-500">
            {t(`paymentStatus.${sale.paymentStatus}`)}
          </p>
          {/* Two independent facts now that collection and return state no
              longer share a column: what is still owed, and what came back.
              Showing only one of them is what hid an unpaid balance behind a
              partial return in the first place. */}
          {sale.returnState && (
            <p className="text-sm capitalize text-warning-700">
              {t(`paymentStatus.${sale.returnState}`)}
            </p>
          )}
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('details.status')}
          </p>
          <p className="mt-2 font-medium capitalize text-secondary-900">
            {t(`status.${sale.status}`)}
          </p>
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('details.created')}
          </p>
          <p className="mt-2 font-medium text-secondary-900">{formatDateTime(sale.createdAt)}</p>
        </div>
      </div>

      {Number(sale.returnedAmount ?? 0) > 0 && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-warning-700">
            {sale.returnState === 'refunded' ? t('details.refund') : t('details.partialRefund')}
          </p>
          <p className="mt-2 font-medium text-warning-900">
            {formatCurrency(
              Number(sale.returnedAmount ?? sale.refundAmount ?? 0),
              sale.currencyCode
            )}
          </p>
          {sale.returnState !== 'refunded' && (
            <p className="text-sm text-warning-800">
              {t('details.returnableRemaining', {
                amount: formatCurrency(Number(sale.returnableAmount ?? 0), sale.currencyCode),
              })}
            </p>
          )}
          {sale.returnedAt && (
            <p className="mt-1 text-xs text-warning-700">
              {t('details.processedOn', { date: formatDateTime(sale.returnedAt) })}
            </p>
          )}
        </div>
      )}

      {(sale.returns?.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-[14px] border border-line/80 bg-surface">
          <div className="border-b border-line/70 bg-surface-2/86 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
              {t('details.returnsHeading', { count: sale.returns?.length ?? 0 })}
            </p>
          </div>
          <div className="divide-y divide-line/70">
            {sale.returns?.map(saleReturn => (
              <article key={saleReturn.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-secondary-950">
                      {formatCurrency(saleReturn.refundAmount, saleReturn.currencyCode)}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {t(`refund.destination.${saleReturn.destination}.title`)}
                      {' · '}
                      {formatDateTime(saleReturn.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-secondary-700">
                      {saleReturn.reason
                        ? t(`refund.reasons.${saleReturn.reason}`, {
                            defaultValue: saleReturn.reason,
                          })
                        : t('details.refundNoNote')}
                    </p>
                  </div>
                  {saleReturn.exchange ? (
                    <span className="rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700">
                      {saleReturn.exchange.replacementSaleNumber
                        ? t('details.exchangeLinkedNumber', {
                            number: saleReturn.exchange.replacementSaleNumber,
                          })
                        : t('details.exchangeLinked')}
                    </span>
                  ) : (
                    onStartExchange && (
                      <button
                        type="button"
                        className="btn-outline text-xs"
                        onClick={() => onStartExchange(saleReturn)}
                      >
                        {t('details.startExchange')}
                      </button>
                    )
                  )}
                </div>
                {saleReturn.legacyFullTicket ? (
                  <p className="text-xs text-secondary-500">{t('details.legacyFullReturn')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {saleReturn.items.map(item => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-surface-2/70 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate text-secondary-800">
                          {item.productNameSnapshot}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-secondary-600">
                          ×{item.quantity}
                        </span>
                        <span className="shrink-0 font-medium text-secondary-900">
                          {formatCurrency(item.total, saleReturn.currencyCode)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-[14px] border border-line/80 bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line/70">
            <thead className="bg-surface-2/86">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th className="px-4 py-3">{t('details.product')}</th>
                <th className="px-4 py-3">{t('details.quantity')}</th>
                <th className="px-4 py-3">{t('details.unitPrice')}</th>
                <th className="px-4 py-3">{t('details.tax')}</th>
                <th className="px-4 py-3">{t('details.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 bg-surface">
              {sale.items?.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">
                        {item.productNameSnapshot ?? item.productName ?? item.productId}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {item.productSkuSnapshot ?? item.productSku ?? t('details.noSku')}
                        {' · '}
                        {item.unitName ?? item.unitAbbreviation ?? item.unitId ?? t('details.unit')}
                      </p>
                      {(item.serialNumbers?.length ?? 0) > 0 && (
                        <p className="mt-1 text-xs text-secondary-600">
                          {t('details.serials')}:{' '}
                          <span className="font-mono">{item.serialNumbers?.join(', ')}</span>
                        </p>
                      )}
                      {(item.promotions?.length ?? 0) > 0 && (
                        <ul
                          className="mt-1 space-y-0.5"
                          data-testid={`sale-item-promotions-${item.id}`}
                        >
                          {item.promotions?.map(promotion => (
                            <li key={promotion.id} className="text-xs text-success-700">
                              {t('details.promotionApplied', {
                                name: promotion.nameSnapshot,
                                amount: formatCurrency(promotion.discountAmount, sale.currencyCode),
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {item.quantity}
                    {Number(item.returnedQuantity ?? 0) > 0 && (
                      <span className="mt-1 block text-xs text-warning-700">
                        {t('details.returnedQuantity', { quantity: item.returnedQuantity })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.unitPrice, sale.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.taxAmount, sale.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                    {formatCurrency(item.total, sale.currencyCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(hasSplitPayments(sale) ||
        sale.payments?.some(
          payment => payment.method === 'loyalty' || payment.method === 'store_credit'
        )) &&
        sale.payments && (
          <div className="overflow-hidden rounded-[14px] border border-line/80 bg-surface">
            <div className="flex items-center justify-between border-b border-line/70 bg-surface-2/86 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
                {t('details.paymentsHeading')}
              </p>
              <p className="text-xs text-secondary-500">
                {t('details.paymentsSplit', { count: sale.payments.length })}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line/70">
                <thead className="bg-surface-2/86">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                    <th className="px-4 py-3">{t('details.paymentsMethod')}</th>
                    <th className="px-4 py-3">{t('details.paymentsReference')}</th>
                    <th className="px-4 py-3 text-right">{t('details.paymentsAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70 bg-surface">
                  {sale.payments.map(payment => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                        {t(PAYMENT_METHOD_TRANSLATION_KEYS[payment.method])}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-700">
                        {payment.method === 'loyalty' && payment.loyaltyPoints
                          ? t('details.loyaltyPoints', { count: payment.loyaltyPoints })
                          : payment.reference?.trim() || t('details.paymentsNoReference')}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-secondary-900">
                        {formatCurrency(payment.amount, sale.currencyCode)}
                        {Number(payment.returnedAmount ?? 0) > 0 && (
                          <span className="mt-1 block text-xs font-normal text-warning-700">
                            {t('details.paymentReturned', {
                              amount: formatCurrency(
                                Number(payment.returnedAmount),
                                sale.currencyCode
                              ),
                            })}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.subtotal')}</p>
          <p className="mt-1 text-lg font-semibold text-secondary-900">
            {formatCurrency(sale.subtotal, sale.currencyCode)}
          </p>
        </div>
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.vat')}</p>
          <p className="mt-1 text-lg font-semibold text-secondary-900">
            {formatCurrency(sale.taxAmount, sale.currencyCode)}
          </p>
        </div>
        <div className="rounded-[14px] border border-primary-300/30 bg-primary-400/12 px-4 py-4">
          <p className="text-sm text-primary-700">{t('details.total')}</p>
          <p className="mt-1 text-xl font-semibold text-primary-900">
            {formatCurrency(sale.total, sale.currencyCode)}
          </p>
        </div>
      </div>

      {sale.notes && (
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.notes')}</p>
          <p className="mt-2 text-sm text-secondary-700">{sale.notes}</p>
        </div>
      )}

      {returnError && <p className="text-sm text-danger-500">{returnError}</p>}
      {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
      {printError && <p className="text-sm text-danger-500">{printError}</p>}
    </div>
  );
}
