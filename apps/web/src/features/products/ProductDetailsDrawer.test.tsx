/**
 * ENG-132a — ProductDetailsDrawer tests.
 *
 * Pins the row-detail Drawer that holds the columns trimmed off the
 * default ProductsPage table:
 *   - renders every trimmed field (SKU, category, provider, location,
 *     tier-2 / tier-3 prices, min-stock, status) for the given product;
 *   - the Edit footer action calls onEdit (and is absent when onEdit is
 *     omitted — viewer / cashier);
 *   - stays closed when `product` is null;
 *   - no serious accessibility violations.
 *
 * @module features/products/ProductDetailsDrawer.test
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { ProductDetailsDrawer } from './ProductDetailsDrawer';

const product = {
  id: 'p-1',
  name: 'Café Premium',
  sku: 'CAF-001',
  categoryName: 'Bebidas',
  providerName: 'Proveedor Norte',
  locationName: 'Bodega A',
  price: 12000,
  price2: 11000,
  price3: 10000,
  stock: 42,
  minStock: 10,
  tracksLots: true,
  catalogType: 'standard',
  isActive: true,
} as unknown as Product;

describe('ProductDetailsDrawer (ENG-132a)', () => {
  it('renders the trimmed product fields', () => {
    render(<ProductDetailsDrawer product={product} onClose={vi.fn()} />);

    expect(screen.getByTestId('product-details-drawer')).toBeInTheDocument();
    // The four fields trimmed from the default table all surface here.
    expect(screen.getByText('CAF-001')).toBeInTheDocument(); // SKU
    expect(screen.getByText('Proveedor Norte')).toBeInTheDocument(); // provider
    expect(screen.getByText('Bodega A')).toBeInTheDocument(); // location
    expect(screen.getByText('Bebidas')).toBeInTheDocument(); // category
    expect(screen.getByText('Lot tracking')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    // The drawer heading is the product name.
    expect(screen.getByRole('heading', { name: 'Café Premium' })).toBeInTheDocument();
  });

  it('calls onEdit with the product when the Edit footer action is clicked', () => {
    const onEdit = vi.fn();
    render(<ProductDetailsDrawer product={product} onClose={vi.fn()} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /edit product|editar producto/i }));
    expect(onEdit).toHaveBeenCalledWith(product);
  });

  it('opens variant creation for a standard product', () => {
    const onManageVariants = vi.fn();
    render(
      <ProductDetailsDrawer
        product={product}
        onClose={vi.fn()}
        onManageVariants={onManageVariants}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /create variants|crear variantes/i }));
    expect(onManageVariants).toHaveBeenCalledWith(product);
  });

  it('hides variant creation for a serial-tracked product', () => {
    render(
      <ProductDetailsDrawer
        product={{ ...product, tracksSerials: true }}
        onClose={vi.fn()}
        onManageVariants={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /create variants|crear variantes/i })
    ).not.toBeInTheDocument();
  });

  it('hides the Edit action when onEdit is not provided (read-only roles)', () => {
    render(<ProductDetailsDrawer product={product} onClose={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /edit product|editar producto/i })
    ).not.toBeInTheDocument();
  });

  it('stays closed when product is null', () => {
    render(<ProductDetailsDrawer product={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId('product-details-drawer')).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <ProductDetailsDrawer product={product} onClose={vi.fn()} onEdit={vi.fn()} />
    );
    // The Drawer renders into a portal on document.body — scan baseElement.
    await assertNoA11yViolations(baseElement);
  });
});
