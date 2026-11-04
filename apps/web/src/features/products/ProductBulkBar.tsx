import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';

interface BulkProduct {
  id: string;
  version: number;
}

/** Applies one change to the selected rows, one at a time, and reports what could not change. */
export function ProductBulkBar({
  selected,
  categories,
  canArchive,
  onDone,
}: {
  selected: readonly BulkProduct[];
  categories: ReadonlyArray<{ id: string; name: string }>;
  canArchive: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation('products');
  const toast = useToast();
  const utils = trpc.useUtils();
  const updateMutation = trpc.products.update.useMutation();
  const deleteMutation = trpc.products.delete.useMutation();
  const [isWorking, setIsWorking] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);

  const applyToEach = async (change: (product: BulkProduct) => Promise<unknown>) => {
    setIsWorking(true);
    let failed = 0;
    for (const product of selected) {
      try {
        await change(product);
      } catch {
        failed += 1;
      }
    }
    await utils.products.list.invalidate();
    setIsWorking(false);
    const done = selected.length - failed;
    if (failed > 0) {
      toast.warning({ title: t('bulk.partial', { done, failed }) });
    } else {
      toast.success({ title: t('bulk.done', { count: done }) });
    }
    onDone();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
      role="group"
      aria-label={t('bulk.label')}
      data-testid="products-bulk-bar"
    >
      <span className="font-semibold" data-testid="products-bulk-count">
        {t('bulk.selected', { count: selected.length })}
      </span>
      <select
        className="input min-h-11 w-auto"
        aria-label={t('bulk.moveCategory')}
        disabled={isWorking}
        value=""
        onChange={event => {
          const categoryId = event.target.value;
          if (!categoryId) return;
          void applyToEach(product =>
            updateMutation.mutateAsync({ id: product.id, version: product.version, categoryId })
          );
        }}
        data-testid="products-bulk-category"
      >
        <option value="">{t('bulk.moveCategory')}</option>
        {categories.map(category => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      {canArchive && (
        <button
          type="button"
          className="btn-outline min-h-11"
          disabled={isWorking}
          onClick={() => setIsConfirmingArchive(true)}
          data-testid="products-bulk-archive"
        >
          {t('bulk.archive')}
        </button>
      )}
      <button
        type="button"
        className="btn-ghost min-h-11"
        disabled={isWorking}
        onClick={onDone}
        data-testid="products-bulk-clear"
      >
        {t('bulk.clear')}
      </button>
      <ConfirmModal
        isOpen={isConfirmingArchive}
        onClose={() => setIsConfirmingArchive(false)}
        onConfirm={() => {
          setIsConfirmingArchive(false);
          void applyToEach(product => deleteMutation.mutateAsync({ id: product.id }));
        }}
        title={t('bulk.archiveTitle', { count: selected.length })}
        message={t('bulk.archiveMessage')}
      />
    </div>
  );
}
