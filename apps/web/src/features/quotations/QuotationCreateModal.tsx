import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

import { QuotationLinesEditor } from './QuotationLinesEditor';
import {
  calculateQuotationTotals,
  createEmptyQuotationLine,
  resolveQuotationLine,
  type DraftLine,
  type ProductOption,
} from './quotationDraft';

interface QuotationCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional callback fired with the created quotation id on success. */
  onCreated?: (id: string) => void;
}

interface CustomerOption {
  id: string;
  name: string;
}

export function QuotationCreateModal({ isOpen, onClose, onCreated }: QuotationCreateModalProps) {
  const { t } = useTranslation(['quotations', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [customerId, setCustomerId] = useState<string>('');
  const [validUntil, setValidUntil] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<DraftLine[]>(() => [createEmptyQuotationLine()]);

  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { enabled: isOpen }
  );
  const productsQuery = trpc.products.list.useQuery({ page: 1, perPage: 200 }, { enabled: isOpen });

  const createMutation = trpc.quotations.create.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.quotations.list.invalidate(),
        utils.quotations.getById.invalidate(),
      ]);
      toast.success({ title: t('toast.createSuccess') });
      onCreated?.(result.id);
      onClose();
    },
    onError: onErrorToast(toast, t, { titleKey: 'quotations:toast.createError' }),
  });

  const productOptions: ProductOption[] = useMemo(
    () =>
      (productsQuery.data?.items ?? [])
        .filter(product => product.isActive !== false)
        .map(product => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          taxRate: product.taxRate,
        })),
    [productsQuery.data]
  );
  const productById = useMemo(
    () => new Map(productOptions.map(product => [product.id, product])),
    [productOptions]
  );
  const customerOptions: CustomerOption[] = useMemo(
    () =>
      (customersQuery.data?.items ?? []).map(customer => ({
        id: customer.id,
        name: customer.name,
      })),
    [customersQuery.data]
  );

  const resolvedLines = useMemo(
    () => lines.map(line => resolveQuotationLine(line, productById)),
    [lines, productById]
  );

  const totals = useMemo(() => calculateQuotationTotals(resolvedLines), [resolvedLines]);

  const hasFieldError = resolvedLines.some(r => r.hasFieldError);
  const hasAnyValidLine = resolvedLines.some(r => !r.isEmpty && !r.hasFieldError && r.quantity > 0);
  const canSubmit = !createMutation.isPending && !hasFieldError && hasAnyValidLine;

  function updateLine(rowId: string, patch: Partial<DraftLine>) {
    setLines(previous =>
      previous.map(line => (line.rowId === rowId ? { ...line, ...patch } : line))
    );
  }

  function handleAddLine() {
    setLines(previous => [...previous, createEmptyQuotationLine()]);
  }

  function handleRemoveLine(rowId: string) {
    setLines(previous => {
      if (previous.length === 1) {
        // Always keep at least one row visible — reset it instead of removing.
        return [createEmptyQuotationLine()];
      }
      return previous.filter(line => line.rowId !== rowId);
    });
  }

  function handleClose() {
    if (createMutation.isPending) {
      return;
    }
    setCustomerId('');
    setValidUntil('');
    setNotes('');
    setLines([createEmptyQuotationLine()]);
    createMutation.reset();
    onClose();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    // Use end-of-day in the cashier's local timezone, then convert to UTC
    // for the wire. Hardcoding `Z` (UTC midnight) would expire the quote
    // hours before the user-visible day ends in non-UTC offsets (e.g.
    // Colombia UTC-5 would lose 5 hours).
    const validUntilIso = validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : undefined;

    createMutation.mutate({
      customerId: customerId || undefined,
      validUntil: validUntilIso,
      notes: notes.trim() ? notes.trim() : undefined,
      items: resolvedLines
        .filter(r => !r.isEmpty && !r.hasFieldError)
        .map(r => ({
          productId: r.productId,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          discount: r.discount,
          // Send the effective rate (with product-VAT fallback) so the stored
          // line matches what the user saw in the live-totals panel before
          // saving. The server applies the same fallback, but sending it
          // explicitly removes the dependency.
          taxRate: r.effectiveTaxRate,
        })),
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('create.title')}
      size="xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClose}
            disabled={createMutation.isPending}
          >
            {t('create.cancel')}
          </button>
          <button
            type="submit"
            form="quotation-create-form"
            className="btn-primary"
            disabled={!canSubmit}
          >
            {createMutation.isPending ? t('create.submitting') : t('create.submit')}
          </button>
        </div>
      }
    >
      <form id="quotation-create-form" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <p className="text-sm text-secondary-600">{t('create.description')}</p>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">{t('create.customerLabel')}</span>
            <select
              className="input mt-1"
              value={customerId}
              onChange={event => setCustomerId(event.target.value)}
              disabled={customersQuery.isLoading}
            >
              <option value="">{t('create.customerPlaceholder')}</option>
              {customerOptions.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">{t('create.validUntilLabel')}</span>
            <input
              type="date"
              className="input mt-1"
              value={validUntil}
              onChange={event => setValidUntil(event.target.value)}
            />
          </label>
        </div>

        <QuotationLinesEditor
          lines={lines}
          resolvedLines={resolvedLines}
          productOptions={productOptions}
          productById={productById}
          hasFieldError={hasFieldError}
          hasAnyValidLine={hasAnyValidLine}
          onUpdateLine={updateLine}
          onAddLine={handleAddLine}
          onRemoveLine={handleRemoveLine}
        />

        <label className="block">
          <span className="label">{t('create.notesLabel')}</span>
          <textarea
            className="input mt-1"
            rows={2}
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder={t('create.notesPlaceholder')}
            maxLength={1000}
          />
        </label>

        <dl className="grid grid-cols-2 gap-2 rounded-xl border border-secondary-200 px-4 py-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-secondary-500">
              {t('create.totals.subtotal')}
            </dt>
            <dd className="font-medium text-secondary-900">{formatCurrency(totals.subtotal)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-secondary-500">
              {t('create.totals.tax')}
            </dt>
            <dd className="font-medium text-secondary-900">{formatCurrency(totals.taxAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-secondary-500">
              {t('create.totals.discount')}
            </dt>
            <dd className="font-medium text-secondary-900">
              {formatCurrency(totals.discountAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-secondary-500">
              {t('create.totals.total')}
            </dt>
            <dd className="text-base font-semibold text-secondary-900">
              {formatCurrency(totals.total)}
            </dd>
          </div>
        </dl>
      </form>
    </Modal>
  );
}
