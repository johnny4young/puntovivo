import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

interface QuotationCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional callback fired with the created quotation id on success. */
  onCreated?: (id: string) => void;
}

interface DraftLine {
  /** Unique row id for stable React keys (not persisted on the server). */
  rowId: string;
  productId: string;
  quantityInput: string;
  unitPriceInput: string;
  discountInput: string;
  taxRateInput: string;
}

let nextRowSequence = 0;
function makeRowId(): string {
  nextRowSequence += 1;
  return `line-${nextRowSequence}`;
}

function emptyLine(): DraftLine {
  return {
    rowId: makeRowId(),
    productId: '',
    quantityInput: '1',
    unitPriceInput: '',
    discountInput: '0',
    taxRateInput: '',
  };
}

function parseNumber(raw: string): number {
  if (raw.trim().length === 0) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  price: number;
  taxRate: number;
  isActive: boolean | null;
}

interface CustomerOption {
  id: string;
  name: string;
}

interface ResolvedLine {
  productId: string;
  product: ProductOption | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  effectiveTaxRate: number;
  total: number;
  lineTax: number;
  /** True when the row has no product picked yet (neutral, not an error). */
  isEmpty: boolean;
  /** True when a product IS picked but one of its numeric fields is invalid. */
  hasFieldError: boolean;
}

function resolveLine(
  line: DraftLine,
  productById: ReadonlyMap<string, ProductOption>
): ResolvedLine {
  const product = line.productId ? productById.get(line.productId) ?? null : null;
  const quantity = parseNumber(line.quantityInput);
  const unitPrice = parseNumber(line.unitPriceInput);
  const discount = parseNumber(line.discountInput);
  const taxRate = parseNumber(line.taxRateInput);

  const isEmpty = !product;
  const hasFieldError =
    !!product &&
    (Number.isNaN(quantity) ||
      quantity <= 0 ||
      Number.isNaN(unitPrice) ||
      unitPrice < 0 ||
      Number.isNaN(discount) ||
      discount < 0 ||
      discount > 100 ||
      Number.isNaN(taxRate) ||
      taxRate < 0);

  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const safeUnitPrice = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeDiscount = Number.isFinite(discount) ? Math.max(0, Math.min(100, discount)) : 0;
  const effectiveTaxRate = taxRate > 0 ? taxRate : product?.taxRate ?? 0;

  const grossLine = safeUnitPrice * safeQuantity;
  const discountAmount = grossLine * (safeDiscount / 100);
  const lineTotal = grossLine - discountAmount;
  const lineBase =
    effectiveTaxRate > 0 ? lineTotal / (1 + effectiveTaxRate / 100) : lineTotal;
  const lineTax = lineTotal - lineBase;

  return {
    productId: line.productId,
    product,
    quantity: safeQuantity,
    unitPrice: safeUnitPrice,
    discount: safeDiscount,
    taxRate,
    effectiveTaxRate,
    total: lineTotal,
    lineTax,
    isEmpty,
    hasFieldError,
  };
}

export function QuotationCreateModal({
  isOpen,
  onClose,
  onCreated,
}: QuotationCreateModalProps) {
  const { t } = useTranslation(['quotations', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [customerId, setCustomerId] = useState<string>('');
  const [validUntil, setValidUntil] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);

  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { enabled: isOpen }
  );
  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: isOpen }
  );

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
    onError: error => {
      toast.error({
        title: t('toast.createError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
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
          isActive: product.isActive,
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
    () => lines.map(line => resolveLine(line, productById)),
    [lines, productById]
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let taxAmount = 0;
    let discountAmount = 0;
    let total = 0;
    for (const r of resolvedLines) {
      const grossLine = r.unitPrice * r.quantity;
      const lineDiscount = grossLine * (r.discount / 100);
      const base = r.total - r.lineTax;
      subtotal += base;
      taxAmount += r.lineTax;
      discountAmount += lineDiscount;
      total += r.total;
    }
    return { subtotal, taxAmount, discountAmount, total };
  }, [resolvedLines]);

  const hasFieldError = resolvedLines.some(r => r.hasFieldError);
  const hasAnyValidLine = resolvedLines.some(
    r => !r.isEmpty && !r.hasFieldError && r.quantity > 0
  );
  const canSubmit = !createMutation.isPending && !hasFieldError && hasAnyValidLine;

  function updateLine(rowId: string, patch: Partial<DraftLine>) {
    setLines(previous =>
      previous.map(line => (line.rowId === rowId ? { ...line, ...patch } : line))
    );
  }

  function handleAddLine() {
    setLines(previous => [...previous, emptyLine()]);
  }

  function handleRemoveLine(rowId: string) {
    setLines(previous => {
      if (previous.length === 1) {
        // Always keep at least one row visible — reset it instead of removing.
        return [emptyLine()];
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
    setLines([emptyLine()]);
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
    const validUntilIso = validUntil
      ? new Date(`${validUntil}T23:59:59`).toISOString()
      : undefined;

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
      <form
        id="quotation-create-form"
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-700">
              {t('create.linesTitle')}
            </h3>
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1 py-1 text-sm"
              onClick={handleAddLine}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('create.addLine')}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-secondary-200">
            <table className="min-w-full divide-y divide-secondary-200 text-sm">
              <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">
                    {t('create.columns.product')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('create.columns.quantity')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('create.columns.unitPrice')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('create.columns.discount')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('create.columns.taxRate')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {t('create.columns.total')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t('create.removeLine')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {lines.map((line, index) => {
                  const resolved = resolvedLines[index];
                  return (
                    <tr key={line.rowId}>
                      <td className="px-3 py-2 align-top">
                        <select
                          className={`input w-56 ${resolved?.product ? '' : 'border-secondary-300'}`}
                          value={line.productId}
                          onChange={event => {
                            const product = productById.get(event.target.value);
                            updateLine(line.rowId, {
                              productId: event.target.value,
                              unitPriceInput: product
                                ? String(product.price)
                                : line.unitPriceInput,
                            });
                          }}
                          aria-label={t('create.columns.product')}
                        >
                          <option value="">{t('create.linePlaceholder')}</option>
                          {productOptions.map(product => (
                            <option key={product.id} value={product.id}>
                              {product.name} — {product.sku}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          className="input w-24 text-right"
                          value={line.quantityInput}
                          onChange={event =>
                            updateLine(line.rowId, { quantityInput: event.target.value })
                          }
                          aria-label={t('create.columns.quantity')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          className="input w-28 text-right"
                          value={line.unitPriceInput}
                          onChange={event =>
                            updateLine(line.rowId, { unitPriceInput: event.target.value })
                          }
                          aria-label={t('create.columns.unitPrice')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          max={100}
                          className="input w-20 text-right"
                          value={line.discountInput}
                          onChange={event =>
                            updateLine(line.rowId, { discountInput: event.target.value })
                          }
                          aria-label={t('create.columns.discount')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          className="input w-20 text-right"
                          value={line.taxRateInput}
                          onChange={event =>
                            updateLine(line.rowId, { taxRateInput: event.target.value })
                          }
                          aria-label={t('create.columns.taxRate')}
                          placeholder={
                            resolved?.product ? String(resolved.product.taxRate) : '0'
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right align-top font-medium text-secondary-900">
                        {formatCurrency(resolved?.total ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-secondary-600 hover:text-danger-600"
                          onClick={() => handleRemoveLine(line.rowId)}
                          aria-label={t('create.removeLine')}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasFieldError && (
            <p className="text-xs text-danger-700">
              {t('create.errors.lineQuantity')}
            </p>
          )}
          {!hasAnyValidLine && !hasFieldError && (
            <p className="text-xs text-secondary-500">{t('create.errors.noLines')}</p>
          )}
        </div>

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
            <dd className="font-medium text-secondary-900">
              {formatCurrency(totals.subtotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-secondary-500">
              {t('create.totals.tax')}
            </dt>
            <dd className="font-medium text-secondary-900">
              {formatCurrency(totals.taxAmount)}
            </dd>
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
