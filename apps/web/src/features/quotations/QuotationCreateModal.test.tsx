import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import i18next from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';

import { QuotationCreateModal } from './QuotationCreateModal';

const createMutate = vi.hoisted(() => vi.fn());
const createReset = vi.hoisted(() => vi.fn());
const remoteProduct = {
  id: 'remote',
  name: 'Remote Tea',
  sku: 'REMOTE-201',
  price: 50,
  price2: 40,
  price3: 30,
  taxRate: 0,
  isActive: true,
};
let catalogError = false;
const retryCatalog = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      quotations: {
        list: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    customers: {
      list: {
        useQuery: () => ({
          data: {
            items: [{ id: 'customer-tier-2', name: 'Wholesale Customer', priceTier: 2 }],
          },
          isLoading: false,
        }),
      },
    },
    products: {
      list: {
        useQuery: (input: { search?: string }) => ({
          isError: catalogError,
          refetch: retryCatalog,
          data: {
            items: input.search?.includes('REMOTE')
              ? [remoteProduct]
              : [
                  {
                    id: 'product-1',
                    name: 'Coffee',
                    sku: 'COFFEE-1',
                    price: 119,
                    price2: 100,
                    price3: 90,
                    taxRate: 19,
                    isActive: true,
                  },
                ],
          },
          isLoading: false,
        }),
      },
    },
    quotations: {
      create: {
        useMutation: () => ({
          mutate: createMutate,
          reset: createReset,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('QuotationCreateModal price tiers', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    catalogError = false;
  });

  it('does not reprice on customer selection and applies the customer tier explicitly', async () => {
    const user = userEvent.setup();
    render(<QuotationCreateModal isOpen onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Product'), 'product-1');
    const priceInput = screen.getByLabelText('Unit price');
    expect(priceInput).toHaveValue(119);

    await user.selectOptions(screen.getByLabelText('Customer'), 'customer-tier-2');
    expect(priceInput).toHaveValue(119);

    await user.click(screen.getByRole('button', { name: "Apply customer's Tier 2 prices" }));
    expect(priceInput).toHaveValue(100);

    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-tier-2',
        priceTier: 2,
        items: [expect.objectContaining({ productId: 'product-1', unitPrice: 100 })],
      })
    );
  });

  it('preserves a manually edited price when the operator changes tiers', async () => {
    const user = userEvent.setup();
    render(<QuotationCreateModal isOpen onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Product'), 'product-1');
    const priceInput = screen.getByLabelText('Unit price');
    await user.clear(priceInput);
    await user.type(priceInput, '115');
    await user.click(screen.getByRole('button', { name: 'Tier 3' }));

    expect(priceInput).toHaveValue(115);
    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        priceTier: 3,
        items: [expect.objectContaining({ unitPrice: 115 })],
      })
    );
  });
  it('searches beyond the first page and retains selected lines across later searches', async () => {
    const user = userEvent.setup();
    render(<QuotationCreateModal isOpen onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Product'), 'product-1');
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    const search = screen.getByRole('searchbox', { name: 'Search catalog' });
    await user.type(search, 'REMOTE-201');
    await screen.findAllByRole('option', { name: /Remote Tea/ });
    expect(search).toHaveFocus();
    await user.selectOptions(screen.getAllByLabelText('Product')[1]!, 'remote');
    await user.clear(search);
    await user.type(search, 'Coffee');
    await waitFor(() => expect(screen.getAllByLabelText('Unit price')[1]).toHaveValue(50));
    expect(screen.getAllByLabelText('Product')[0]).toHaveValue('product-1');
    expect(screen.getAllByLabelText('Product')[1]).toHaveValue('remote');
    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ productId: 'product-1', unitPrice: 119 }),
          expect.objectContaining({ productId: 'remote', unitPrice: 50 }),
        ],
      })
    );
  });

  it('offers catalog retry without discarding selected lines', async () => {
    const user = userEvent.setup();
    const view = render(<QuotationCreateModal isOpen onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Product'), 'product-1');
    catalogError = true;
    view.rerender(<QuotationCreateModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The catalog could not be loaded. Retry your search.'
    );
    await user.click(screen.getByRole('button', { name: 'Retry catalog' }));
    expect(retryCatalog).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Product')).toHaveValue('product-1');
  });
});
