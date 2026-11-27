/**
 * owner-mode margin traffic light in the products table.
 *
 * The column factory is pure, so the gate (null map → no column) and the
 * threshold → tone mapping are asserted directly on its output.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import i18n from '@/i18n';
import type { Product } from '@/types';
import {
  MARGIN_GOOD_PCT,
  MARGIN_WARN_PCT,
  productsColumns,
  type DisplayProduct,
} from './productsColumns';

const product = { id: 'p1', name: 'Widget', sku: 'W-1' } as Product;

function buildColumns(marginByProduct: Map<string, number> | null) {
  return productsColumns(
    () => {},
    () => {},
    () => {},
    true,
    true,
    false,
    marginByProduct
  );
}

function marginColumn(columns: DataTableColumnDef<DisplayProduct>[]) {
  return columns.find(column => column.id === 'margin');
}

function renderMarginCell(marginByProduct: Map<string, number>) {
  const column = marginColumn(buildColumns(marginByProduct));
  expect(column).toBeDefined();
  const Cell = column!.cell as (props: { row: { original: DisplayProduct } }) => ReactElement;
  return render(<Cell row={{ original: product as DisplayProduct }} />);
}

describe('productsColumns margin column', () => {
  it('is absent entirely when the margin map is null (non-admin viewers)', () => {
    expect(marginColumn(buildColumns(null))).toBeUndefined();
  });

  it.each([
    ['en', 'Margin (30 days)'],
    ['es', 'Margen (30 días)'],
  ])('labels the header as the realized 30-day margin in %s', async (language, header) => {
    await i18n.changeLanguage(language);
    const column = marginColumn(buildColumns(new Map()));
    expect((column!.header as () => string)()).toBe(header);
    await i18n.changeLanguage('en');
  });

  it('renders an em dash for a product with no sales in the window', async () => {
    await i18n.changeLanguage('en');
    renderMarginCell(new Map());
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByTestId('product-margin-badge')).not.toBeInTheDocument();
  });

  it.each([
    [MARGIN_GOOD_PCT + 5, 'success'],
    [MARGIN_WARN_PCT + 5, 'warning'],
    [MARGIN_WARN_PCT - 5, 'danger'],
  ])('maps %s%% to the %s tone', (pct, tone) => {
    renderMarginCell(new Map([[product.id, pct as number]]));
    const badge = screen.getByTestId('product-margin-badge');
    expect(badge.className).toContain(tone as string);
    expect(badge.textContent).toBe(`${(pct as number).toFixed(1)}%`);
  });
});

describe('productsColumns stock low-threshold parity', () => {
  function renderStockCell(stock: number, minStock: number) {
    const column = buildColumns(null).find(
      col => 'accessorKey' in col && col.accessorKey === 'stock'
    );
    expect(column).toBeDefined();
    const Cell = column!.cell as (props: { row: { original: DisplayProduct } }) => ReactElement;
    return render(
      <Cell
        row={{
          original: {
            ...product,
            tracksStock: true,
            stock,
            minStock,
          } as DisplayProduct,
        }}
      />
    );
  }

  it('marks stock at or below minStock as low to match the server lowStock filter', () => {
    const atMin = renderStockCell(5, 5);
    expect(atMin.container.querySelector('.pv-stock')).toHaveClass('low');
    atMin.unmount();

    const aboveMin = renderStockCell(6, 5);
    expect(aboveMin.container.querySelector('.pv-stock')).not.toHaveClass('low');
  });
});
