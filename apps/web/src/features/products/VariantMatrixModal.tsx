import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { StatusStrip, Badge } from '@/components/ui';
import type { Product, ProductVariantAxis } from '@/types';
import {
  buildVariantPreview,
  MAX_VARIANT_AXES,
  parseVariantAxes,
  type VariantAxisDraft,
} from './productVariantMatrix';
interface VariantMatrixData {
  axes: ProductVariantAxis[];
  variants: Product[];
}
export interface VariantMatrixModalProps {
  isOpen: boolean;
  product: Product;
  matrix?: VariantMatrixData | null | undefined;
  isLoading?: boolean | undefined;
  isSaving?: boolean | undefined;
  error?: string | null | undefined;
  onClose: () => void;
  onSubmit: (axes: ProductVariantAxis[]) => Promise<void>;
}
const INITIAL_AXES: VariantAxisDraft[] = [
  {
    name: '',
    valuesText: '',
  },
];
export function VariantMatrixModal({
  isOpen,
  product,
  matrix,
  isLoading = false,
  isSaving = false,
  error,
  onClose,
  onSubmit,
}: VariantMatrixModalProps) {
  const { t } = useTranslation('products');
  const [drafts, setDrafts] = useState<VariantAxisDraft[]>(INITIAL_AXES);
  const isExistingMatrix = product.catalogType === 'variant_parent';
  const parsed = useMemo(() => parseVariantAxes(drafts), [drafts]);
  const preview = useMemo(
    () => (parsed.error ? [] : buildVariantPreview(product, parsed.axes)),
    [parsed, product]
  );
  const stockBlocked = Math.abs(product.stock) > 1e-9;
  const updateDraft = (index: number, patch: Partial<VariantAxisDraft>) => {
    setDrafts(current =>
      current.map((draft, draftIndex) =>
        draftIndex === index
          ? {
              ...draft,
              ...patch,
            }
          : draft
      )
    );
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isExistingMatrix
          ? t('variants.viewTitle', {
              name: product.name,
            })
          : t('variants.createTitle', {
              name: product.name,
            })
      }
      size="xl"
      contentClassName="space-y-5"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('variants.close')}
          </ModalButton>
          {!isExistingMatrix && (
            <ModalButton
              variant="primary"
              onClick={() => {
                // The parent owns the rendered mutation error. Consume the
                // mutateAsync rejection here so a handled server response
                // does not also surface as an unhandled browser rejection.
                void onSubmit(parsed.axes).catch(() => undefined);
              }}
              disabled={isSaving || stockBlocked || !!parsed.error}
            >
              {isSaving
                ? t('variants.creating')
                : t('variants.createAction', {
                    count: preview.length,
                  })}
            </ModalButton>
          )}
        </>
      }
    >
      <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4 text-sm text-primary-900">
        <div className="flex items-start gap-3">
          <Boxes className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t('variants.explainerTitle')}</p>
            <p className="mt-1 text-primary-800">
              {isExistingMatrix ? t('variants.existingExplainer') : t('variants.createExplainer')}
            </p>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-secondary-500">{t('variants.loading')}</p>}

      {isExistingMatrix && !isLoading && matrix && (
        <div className="space-y-5" data-testid="variant-matrix-view">
          <div className="grid gap-3 sm:grid-cols-3">
            {matrix.axes.map(axis => (
              <div key={axis.name} className="rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
                  {axis.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {axis.values.map(value => (
                    <Badge key={value} variant="neutral">
                      {value}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <VariantRows variants={matrix.variants} />
        </div>
      )}

      {!isExistingMatrix && (
        <div className="space-y-5" data-testid="variant-matrix-create">
          {stockBlocked && (
            <StatusStrip
              tone="warning"
              icon={AlertTriangle}
              title={t('variants.stockBlocked')}
              role="alert"
            />
          )}

          <div className="space-y-3">
            {drafts.map((draft, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-2xl border border-line bg-surface-2/50 p-4 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto]"
              >
                <label className="space-y-1.5 text-sm font-medium text-secondary-800">
                  <span id={`variant-axis-name-label-${index}`}>
                    {t('variants.axisName', {
                      number: index + 1,
                    })}
                  </span>
                  <input
                    aria-labelledby={`variant-axis-name-label-${index}`}
                    className="pv-input"
                    value={draft.name}
                    placeholder={t('variants.axisPlaceholder')}
                    onChange={event =>
                      updateDraft(index, {
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-secondary-800">
                  <span id={`variant-axis-options-label-${index}`}>{t('variants.options')}</span>
                  <input
                    aria-labelledby={`variant-axis-options-label-${index}`}
                    className="pv-input"
                    value={draft.valuesText}
                    placeholder={t('variants.optionsPlaceholder')}
                    onChange={event =>
                      updateDraft(index, {
                        valuesText: event.target.value,
                      })
                    }
                  />
                  <span className="block text-xs font-normal text-secondary-500">
                    {t('variants.optionsHelp')}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-icon mt-6 text-danger-600"
                  aria-label={t('variants.removeAxis', {
                    number: index + 1,
                  })}
                  disabled={drafts.length === 1}
                  onClick={() => setDrafts(current => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {drafts.length < MAX_VARIANT_AXES && (
              <button
                type="button"
                className="btn-outline flex items-center gap-2"
                onClick={() =>
                  setDrafts(current => [
                    ...current,
                    {
                      name: '',
                      valuesText: '',
                    },
                  ])
                }
              >
                <Plus className="h-4 w-4" />
                {t('variants.addAxis')}
              </button>
            )}
          </div>

          {parsed.error ? (
            <p className="text-sm text-danger-600" role="alert">
              {t(`variants.validation.${parsed.error}`)}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-secondary-900">{t('variants.previewTitle')}</h3>
                <Badge variant="info">
                  {t('variants.combinationCount', {
                    count: preview.length,
                  })}
                </Badge>
              </div>
              <VariantRows
                variants={preview.map(row => ({
                  ...row,
                  stock: 0,
                  isActive: true,
                }))}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
function VariantRows({
  variants,
}: {
  variants: Array<Pick<Product, 'name' | 'sku' | 'stock' | 'isActive'>>;
}) {
  const { t } = useTranslation('products');
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase tracking-wide text-secondary-500">
          <tr>
            <th className="px-4 py-3">{t('variants.variant')}</th>
            <th className="px-4 py-3">{t('details.sku')}</th>
            <th className="px-4 py-3 text-right">{t('table.stock')}</th>
            <th className="px-4 py-3">{t('table.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {variants.map(variant => (
            <tr key={variant.sku}>
              <td className="px-4 py-3 font-medium text-secondary-900">{variant.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-secondary-600">{variant.sku}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {variant.stock.toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <Badge variant={variant.isActive ? 'success' : 'neutral'}>
                  {variant.isActive ? t('table.active') : t('table.inactive')}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
