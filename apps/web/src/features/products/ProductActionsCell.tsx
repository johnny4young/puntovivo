import { Eye, Pencil, Trash2 } from 'lucide-react';
import i18next from 'i18next';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import type { Product } from '@/types';
import type { DisplayProduct } from './productsColumns';

export interface ProductActions {
  onViewDetails: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product, opener: HTMLButtonElement) => void;
  canEdit: boolean;
  canDelete: boolean;
}

export type ProductActionsColumn = DataTableColumnDef<DisplayProduct> & {
  productActions: ProductActions;
};

// Module-level so the cell's element type never changes: a column array rebuilt
// for any reason must not remount the button that opened a dialog.
export function ProductActionsCell({
  row,
  column,
}: {
  row: { original: DisplayProduct };
  column: { columnDef: DataTableColumnDef<DisplayProduct> };
}) {
  const { onViewDetails, onEdit, onDelete, canEdit, canDelete } = (
    column.columnDef as ProductActionsColumn
  ).productActions;
  return (
    <div className="flex items-center gap-1">
      {/* Details is the progressive-disclosure affordance for
          the trimmed columns (provider / location / tier2 / tier3 …);
          available to every role and focusable in tab order. */}
      <button
        className="btn-ghost btn-icon h-8 w-8"
        onClick={() => onViewDetails(row.original)}
        aria-label={i18next.t('products:details.viewAria')}
        title={i18next.t('products:details.viewAria')}
      >
        <Eye className="h-4 w-4" />
      </button>
      <button
        className="btn-ghost btn-icon h-8 w-8"
        onClick={() => onEdit(row.original)}
        disabled={!canEdit || row.original.catalogType === 'variant_parent'}
        aria-label={i18next.t('common:actions.edit')}
        title={i18next.t('common:actions.edit')}
      >
        <Pencil className="h-4 w-4" />
      </button>
      {canDelete && row.original.catalogType !== 'variant_parent' && (
        <button
          className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
          onClick={event => onDelete(row.original, event.currentTarget)}
          aria-label={i18next.t('common:actions.delete')}
          title={i18next.t('common:actions.delete')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
