// /  — the ProductsPage table column factory, extracted from
// ProductsPage.tsx ( slice 32). Pure presentational: given the row
// action callbacks + role/mode flags it returns the DataTable column set.

import { ColumnDef } from '@tanstack/react-table';
import { Eye, Pencil, Tag, Trash2 } from 'lucide-react';
import i18next from 'i18next';
import { cn, formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

// when ProductsPage runs in semantic-search mode the rows
// carry an extra optional `similarity` score. Using the loose row type
// here keeps the literal-mode columns identical and lets the optional
// "Match" column read the score from the semantic-mode rows without
// changing the public `Product` type for unrelated callers.
import { Badge } from '@/components/ui';
export type DisplayProduct = Product & {
  similarity?: number;
};

// the default table renders the smallest useful column set for
// an at-a-glance catalog scan (name+SKU, category, lead price, stock,
// status). Provider, location, and the tier-2 / tier-3 prices are secondary
// metadata moved behind the row-detail Drawer (`onViewDetails`) so the row
// stays narrow. Every trimmed field is still exported (productExportColumns)
// and still shown in the Drawer.
// margin traffic-light thresholds (gross margin %, last 30 days).
// Exported constants so a future tenant-level setting can replace them
// without touching the column factory.
export const MARGIN_GOOD_PCT = 30;
export const MARGIN_WARN_PCT = 15;
export const productsColumns = (
  onViewDetails: (product: Product) => void,
  onEdit: (product: Product) => void,
  onDelete: (product: Product) => void,
  canEdit: boolean,
  canDelete: boolean,
  showSimilarity: boolean,
  // productId → realized gross margin % (30-day window, from
  // reports.profit.margin). Null hides the column entirely (non-admin
  // viewers); a map without the product renders an em dash (no sales in
  // the window).
  marginByProduct: Map<string, number> | null = null
): ColumnDef<DisplayProduct>[] => [
  {
    accessorKey: 'name',
    header: () => i18next.t('products:table.product'),
    size: 240,
    // celda ancla (.pv-table .prod/.pic/.pname/.sku):
    // glifo tonal + nombre fuerte + SKU mono legible debajo.
    cell: ({ row }) => (
      <div className="prod">
        <span className="pic">
          <Tag className="h-4 w-4" />
        </span>
        <div>
          <p className="pname">{row.original.name}</p>
          <p className="sku">{row.original.sku}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'categoryName',
    header: () => i18next.t('products:table.category'),
    size: 150,
    cell: ({ row }) => row.original.categoryName ?? '-',
  },
  {
    accessorKey: 'price',
    header: () => i18next.t('products:table.tier1'),
    size: 110,
    // montos mono alineados a la derecha (`num`); el
    // tier líder en negrita vía `.pv-tier .lead`.
    meta: {
      cellClassName: 'num',
      headerClassName: 'num',
    },
    cell: ({ row }) => (
      <span className="pv-tier">
        <span className="lead">{formatCurrency(row.original.price)}</span>
      </span>
    ),
  },
  {
    accessorKey: 'stock',
    header: () => i18next.t('products:table.stock'),
    size: 120,
    // barra de stock proporcional; `low` la pinta en
    // danger. La barra llena al 50% cuando stock == mínimo y crece hacia
    // 100% (2x mínimo), con piso visible para que siempre se lea.
    meta: {
      cellClassName: 'num',
      headerClassName: 'num',
    },
    cell: ({ row }) => {
      if (row.original.catalogType === 'variant_parent') {
        return <span className="text-secondary-400">—</span>;
      }
      const { stock, minStock } = row.original;
      const isLow = stock < minStock;
      const fill =
        minStock > 0
          ? Math.max(6, Math.min(100, Math.round((stock / minStock) * 50)))
          : stock > 0
            ? 100
            : 6;
      return (
        <span
          className={cn('pv-stock', isLow && 'low')}
          title={isLow ? i18next.t('products:table.low') : undefined}
        >
          <span>{stock.toLocaleString()}</span>
          <span className="bar">
            <i
              style={{
                width: `${fill}%`,
              }}
            />
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: 'isActive',
    header: () => i18next.t('products:table.status'),
    size: 110,
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.catalogType === 'variant_parent'
            ? 'info'
            : row.original.isActive
              ? 'success'
              : 'neutral'
        }
      >
        {row.original.catalogType === 'variant_parent'
          ? i18next.t('products:table.matrixParent')
          : row.original.isActive
            ? i18next.t('products:table.active')
            : i18next.t('products:table.inactive')}
      </Badge>
    ),
  },
  ...(marginByProduct
    ? [
        {
          id: 'margin',
          header: () => i18next.t('products:table.margin'),
          size: 110,
          meta: {
            cellClassName: 'num',
            headerClassName: 'num',
          },
          cell: ({
            row,
          }: {
            row: {
              original: DisplayProduct;
            };
          }) => {
            const pct = marginByProduct.get(row.original.id);
            if (typeof pct !== 'number') {
              return (
                <span
                  className="text-secondary-400"
                  title={i18next.t('products:table.marginNoSales')}
                >
                  —
                </span>
              );
            }
            const tone =
              pct >= MARGIN_GOOD_PCT ? 'success' : pct >= MARGIN_WARN_PCT ? 'warning' : 'danger';
            return (
              <Badge
                title={i18next.t('products:table.marginTooltip')}
                data-testid="product-margin-badge"
                variant={tone}
              >
                {pct.toFixed(1)}%
              </Badge>
            );
          },
        } satisfies ColumnDef<DisplayProduct>,
      ]
    : []),
  ...(showSimilarity
    ? [
        {
          id: 'similarity',
          header: () => i18next.t('products:table.match'),
          size: 140,
          cell: ({
            row,
          }: {
            row: {
              original: DisplayProduct;
            };
          }) => {
            const sim = row.original.similarity;
            if (typeof sim !== 'number') return <span className="text-secondary-400">-</span>;
            const pct = Math.max(0, Math.min(100, Math.round(sim * 100)));
            const toneClass =
              pct >= 80 ? 'bg-success-500' : pct >= 60 ? 'bg-primary' : 'bg-warning-500';
            return (
              <div
                className="flex items-center gap-2"
                title={i18next.t('semanticSearch:score.tooltip', {
                  score: sim.toFixed(2),
                })}
              >
                <div className="h-2 w-20 overflow-hidden rounded-full bg-secondary-100">
                  <div
                    className={`h-full rounded-full ${toneClass}`}
                    style={{
                      width: `${pct}%`,
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-secondary-700">
                  {pct}%
                </span>
              </div>
            );
          },
        } satisfies ColumnDef<DisplayProduct>,
      ]
    : []),
  {
    id: 'actions',
    size: 130,
    cell: ({ row }) => (
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
            onClick={() => onDelete(row.original)}
            aria-label={i18next.t('common:actions.delete')}
            title={i18next.t('common:actions.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
  },
];
