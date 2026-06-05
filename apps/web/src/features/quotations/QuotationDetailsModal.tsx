import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { QUOTATION_STATUS_BADGE_CLASSES } from './quotationStatus';
import { QuotationPrintError, printQuotationReceipt } from './quotationPrinter';

interface QuotationDetailsModalProps {
  isOpen: boolean;
  quotationId: string | null;
  onClose: () => void;
}

/**
 * Read-only drawer that surfaces a quotation's line items, totals, customer
 * + status timeline. The query is gated on `isOpen && quotationId` so closed
 * state never hits the network.
 */
export function QuotationDetailsModal({
  isOpen,
  quotationId,
  onClose,
}: QuotationDetailsModalProps) {
  const { t } = useTranslation(['quotations', 'errors']);
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const detailQuery = trpc.quotations.getById.useQuery(
    { id: quotationId ?? '' },
    { enabled: isOpen && !!quotationId }
  );

  async function handlePrint() {
    if (!detailQuery.data || isPrinting) {
      return;
    }
    setIsPrinting(true);
    try {
      await printQuotationReceipt(detailQuery.data);
    } catch (error) {
      const description =
        error instanceof QuotationPrintError
          ? t(`details.printErrors.${error.code}`)
          : t('details.printErrors.unknown');
      toast.error({
        title: t('details.printError'),
        description,
      });
    } finally {
      setIsPrinting(false);
    }
  }

  const canPrint = !!detailQuery.data && !detailQuery.isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('details.title')}
      size="xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={handlePrint}
            disabled={!canPrint || isPrinting}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {isPrinting ? t('details.printPending') : t('details.print')}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('details.close')}
          </button>
        </div>
      }
    >
      {detailQuery.isLoading && !detailQuery.data && (
        <p className="text-sm text-secondary-500">{t('details.loading')}</p>
      )}
      {detailQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {translateServerError(detailQuery.error, t, t('details.error'))}
        </div>
      )}
      {detailQuery.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-secondary-700">
                {detailQuery.data.quotationNumber}
              </span>
              <span className={QUOTATION_STATUS_BADGE_CLASSES[detailQuery.data.status]}>
                {t(`status.${detailQuery.data.status}`)}
              </span>
            </div>
            <span className="text-sm text-secondary-600">
              {detailQuery.data.customerName ?? t('history.customerNone')}
            </span>
          </div>

          {/* ENG-085 — V7 customer card. Surfaces name + NIT + email/phone
            * inline so the operator can verify the buyer without leaving
            * the drawer. Credit / cupo / saldo are scaffolded with "—"
            * placeholders until the ledger from ENG-089 is wired in. */}
          <section className="card relative overflow-hidden p-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 88% 0%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 60%)',
              }}
            />
            <div className="relative grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div>
                <p className="page-kicker">{t('details.customerKicker', { defaultValue: 'Cliente' })}</p>
                <h3 className="mt-1 font-display text-xl tracking-[-0.02em] text-secondary-950">
                  {detailQuery.data.customerName ?? t('history.customerNone')}
                </h3>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                      NIT
                    </dt>
                    <dd className="mt-0.5 font-mono text-secondary-900">
                      {detailQuery.data.customerTaxId ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                      {t('details.customerContact', { defaultValue: 'Contacto' })}
                    </dt>
                    <dd className="mt-0.5 truncate text-secondary-900">
                      {detailQuery.data.customerEmail ?? detailQuery.data.customerPhone ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="grid grid-cols-3 gap-2 self-start">
                <div className="rounded-2xl border border-line/70 bg-surface/95 px-3 py-2.5">
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                    {t('details.creditLabel', { defaultValue: 'Crédito' })}
                  </p>
                  <p className="mt-0.5 font-mono text-[13px] tabular-nums text-secondary-700">—</p>
                </div>
                <div className="rounded-2xl border border-line/70 bg-surface/95 px-3 py-2.5">
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                    {t('details.cupoLabel', { defaultValue: 'Cupo' })}
                  </p>
                  <p className="mt-0.5 font-mono text-[13px] tabular-nums text-secondary-700">—</p>
                </div>
                <div className="rounded-2xl border border-line/70 bg-surface/95 px-3 py-2.5">
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
                    {t('details.saldoLabel', { defaultValue: 'Saldo' })}
                  </p>
                  <p className="mt-0.5 font-mono text-[13px] tabular-nums text-secondary-700">—</p>
                </div>
              </div>
            </div>
            <p className="relative mt-3 text-[10.5px] uppercase tracking-[0.18em] text-secondary-500">
              {t('details.ledgerPending', {
                defaultValue: 'El estado de cuenta del cliente llegará con ENG-089.',
              })}
            </p>
          </section>

          {/* ENG-085 — V7 layout: metadata sits in a card-inset with the
            * kicker pattern, and a dedicated "Despacho · vigencia" panel
            * elevates the validity date to a first-class signal. */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
            <dl className="card-inset grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              {/* ENG-132d — site moved here from the trimmed history column. */}
              <div>
                <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                  {t('details.site')}
                </dt>
                <dd className="mt-1 text-sm text-secondary-900">
                  {detailQuery.data.siteName}
                </dd>
              </div>
              <div>
                <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                  {t('details.createdAt')}
                </dt>
                <dd className="mt-1 text-sm text-secondary-900">
                  {formatDateTime(detailQuery.data.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                  {t('details.createdBy')}
                </dt>
                <dd className="mt-1 text-sm text-secondary-900">
                  {detailQuery.data.createdByName ?? detailQuery.data.createdBy}
                </dd>
              </div>
              {detailQuery.data.statusChangedAt && (
                <div className="md:col-span-2">
                  <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                    {t('details.statusChangedAt')}
                  </dt>
                  <dd className="mt-1 text-sm text-secondary-900">
                    {formatDateTime(detailQuery.data.statusChangedAt)}
                    {detailQuery.data.statusChangedByName
                      ? ` — ${detailQuery.data.statusChangedByName}`
                      : ''}
                  </dd>
                </div>
              )}
            </dl>

            <div className="card-inset relative overflow-hidden p-4">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(circle at 90% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 55%)',
                }}
              />
              <div className="relative">
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-primary-800">
                  {t('details.validityKicker', { defaultValue: 'Vigencia' })}
                </p>
                <p className="mt-2 text-xl font-bold tracking-[-0.02em] text-secondary-950">
                  {detailQuery.data.validUntil
                    ? formatDate(detailQuery.data.validUntil)
                    : t('history.validUntilNever')}
                </p>
                <p className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-secondary-500">
                  {t('details.validUntil')}
                </p>
              </div>
            </div>
          </div>

          {detailQuery.data.notes && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-secondary-500">
                {t('details.notes')}
              </p>
              <p className="whitespace-pre-line text-sm text-secondary-700">
                {detailQuery.data.notes}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">
              {t('details.lineItems')}
            </p>
            <div className="overflow-x-auto rounded-xl border border-secondary-200">
              <table className="min-w-full divide-y divide-secondary-200 text-sm">
                <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      {t('details.columns.product')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left">
                      {t('details.columns.sku')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.quantity')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.unitPrice')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.discount')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.tax')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.total')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {detailQuery.data.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-secondary-900">{item.productName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-secondary-600">
                        {item.productSku}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-900">
                        {item.quantity.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-900">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-700">
                        {item.discount > 0 ? `${item.discount}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-700">
                        {item.taxRate > 0 ? `${item.taxRate}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-secondary-900">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-secondary-200 px-4 py-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.subtotal')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.subtotal)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.tax')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.taxAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.discount')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.discountAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.total')}
              </dt>
              <dd className="text-base font-semibold text-secondary-900">
                {formatCurrency(detailQuery.data.total)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
