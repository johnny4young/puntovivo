import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import i18next from '@/i18n';
import { render, screen } from '@/test/utils';

import { QuotationCreateModal } from './QuotationCreateModal';

const createMutate = vi.hoisted(() => vi.fn());
const createReset = vi.hoisted(() => vi.fn());

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
        useQuery: () => ({
          data: {
            items: [
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
});
