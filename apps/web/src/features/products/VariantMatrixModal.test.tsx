import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockProduct } from '@/test/utils';
import { assertNoA11yViolations } from '@/test/a11y';
import { VariantMatrixModal } from './VariantMatrixModal';

describe('VariantMatrixModal', () => {
  it('previews a cartesian matrix and submits normalized axes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <VariantMatrixModal
        isOpen
        product={createMockProduct({ name: 'Classic Shirt', sku: 'SHIRT', stock: 0 })}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Axis 1 name'), { target: { value: 'Size' } });
    fireEvent.change(screen.getByLabelText('Options'), { target: { value: 'S, M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another axis' }));
    fireEvent.change(screen.getByLabelText('Axis 2 name'), { target: { value: 'Color' } });
    fireEvent.change(screen.getAllByLabelText('Options')[1]!, {
      target: { value: 'Blue, Red' },
    });

    expect(screen.getByText('4 combinations')).toBeInTheDocument();
    expect(screen.getByText('Classic Shirt · M / Red')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create 4 variants' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Blue', 'Red'] },
    ]);
  });

  it('blocks conversion while the parent has stock', () => {
    render(
      <VariantMatrixModal
        isOpen
        product={createMockProduct({ stock: 2 })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/zero stock at every site/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create/i })).toBeDisabled();
  });

  it('renders an existing matrix without mutation controls', () => {
    const parent = createMockProduct({ catalogType: 'variant_parent', isActive: false });
    render(
      <VariantMatrixModal
        isOpen
        product={parent}
        matrix={{
          axes: [{ name: 'Color', values: ['Blue', 'Red'] }],
          variants: [
            createMockProduct({ name: 'Shirt · Blue', sku: 'SHIRT-BLUE', stock: 3 }),
            createMockProduct({ name: 'Shirt · Red', sku: 'SHIRT-RED', stock: 0 }),
          ],
        }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('variant-matrix-view')).toBeInTheDocument();
    expect(screen.getByText('Shirt · Blue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create variants/i })).not.toBeInTheDocument();
  });

  it('renders a handled server error without leaking the rejected submission', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('conflict'));
    render(
      <VariantMatrixModal
        isOpen
        product={createMockProduct({ stock: 0 })}
        error="A generated SKU already exists."
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Axis 1 name'), { target: { value: 'Size' } });
    fireEvent.change(screen.getByLabelText('Options'), { target: { value: 'S' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 variant' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('A generated SKU already exists.');
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <VariantMatrixModal
        isOpen
        product={createMockProduct({ stock: 0 })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    await assertNoA11yViolations(baseElement);
  });
});
