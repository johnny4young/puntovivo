/**
 * ENG-195 — owner-mode margin traffic light in the products table.
 *
 * The column factory is pure, so the gate (null map → no column) and the
 * threshold → tone mapping are asserted directly on its output.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
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

function marginColumn(columns: ColumnDef<DisplayProduct>[]) {
  return columns.find(column => column.id === 'margin');
}

function renderMarginCell(marginByProduct: Map<string, number>) {
  const column = marginColumn(buildColumns(marginByProduct));
  expect(column).toBeDefined();
  const Cell = column!.cell as (props: { row: { original: DisplayProduct } }) => ReactElement;
  return render(<Cell row={{ original: product as DisplayProduct }} />);
}

describe('productsColumns margin column (ENG-195)', () => {
  it('is absent entirely when the margin map is null (non-admin viewers)', () => {
    expect(marginColumn(buildColumns(null))).toBeUndefined();
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
