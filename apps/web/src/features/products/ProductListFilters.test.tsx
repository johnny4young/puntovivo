import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { NO_PRODUCT_FILTERS, ProductListFilters } from './ProductListFilters';

const categories = [{ id: 'c-1', name: 'Groceries' }];

describe('ProductListFilters', () => {
  it('reports each filter change', async () => {
    const onChange = vi.fn();
    render(
      <ProductListFilters
        filters={NO_PRODUCT_FILTERS}
        categories={categories}
        canSeeMargin
        onChange={onChange}
      />
    );

    await userEvent.click(screen.getByTestId('products-filter-low-stock'));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_PRODUCT_FILTERS, lowStock: true });
    await userEvent.click(screen.getByTestId('products-filter-low-margin'));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_PRODUCT_FILTERS, lowMargin: true });
    await userEvent.selectOptions(screen.getByTestId('products-filter-category'), 'c-1');
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_PRODUCT_FILTERS, categoryId: 'c-1' });
    await userEvent.selectOptions(screen.getByTestId('products-filter-status'), 'inactive');
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_PRODUCT_FILTERS, status: 'inactive' });
  });

  it('hides the margin filter from roles that cannot see cost', () => {
    render(
      <ProductListFilters
        filters={NO_PRODUCT_FILTERS}
        categories={categories}
        canSeeMargin={false}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId('products-filter-low-margin')).not.toBeInTheDocument();
  });
});
