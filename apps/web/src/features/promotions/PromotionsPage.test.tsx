import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import i18n from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import { PromotionsPage } from './PromotionsPage';

const createMutateAsync = vi.fn(async () => undefined);
const updateMutateAsync = vi.fn(async () => undefined);
const transitionMutate = vi.fn();
let promotionTotal = 1;

const promotion = {
  id: 'promo-1',
  name: 'Weekend offer',
  status: 'draft' as const,
  discountPct: 15,
  siteId: null,
  siteName: null,
  productId: null,
  productName: null,
  categoryId: null,
  categoryName: null,
  customerId: null,
  customerName: null,
  minQuantity: 1,
  startsAt: null,
  endsAt: null,
  priority: 0,
  combinable: false,
  source: 'manual' as const,
  sourceLotId: null,
  version: 1,
};

const listUseQuery = vi.fn((input: { page: number; perPage: number; status?: string }) => {
  const pageItems =
    promotionTotal > input.perPage
      ? input.page === 1
        ? Array.from({ length: input.perPage }, (_, index) => ({
            ...promotion,
            id: `promo-${index + 1}`,
            name: `Offer ${index + 1}`,
          }))
        : [{ ...promotion, id: 'promo-21', name: 'Last offer' }]
      : [promotion];

  return {
    data: {
      items: pageItems,
      total: promotionTotal,
      page: input.page,
      perPage: input.perPage,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ promotions: { list: { invalidate: vi.fn() } } }),
    promotions: {
      list: {
        useQuery: (...args: Parameters<typeof listUseQuery>) => listUseQuery(...args),
      },
      create: {
        useMutation: () => ({ mutateAsync: createMutateAsync, isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
      },
      transition: {
        useMutation: () => ({ mutate: transitionMutate, isPending: false }),
      },
    },
    categories: {
      tree: {
        useQuery: () => ({ data: { items: [{ id: 'cat-1', name: 'Food' }] } }),
      },
    },
    sites: {
      list: {
        useQuery: () => ({ data: { items: [{ id: 'site-1', name: 'Main site' }] } }),
      },
    },
    products: {
      search: { useQuery: () => ({ data: { items: [] } }) },
    },
    customers: {
      search: { useQuery: () => ({ data: { items: [] } }) },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('PromotionsPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    promotionTotal = 1;
    vi.clearAllMocks();
  });

  it('creates an inert global draft from human-readable controls', async () => {
    const user = userEvent.setup();
    render(<PromotionsPage />);

    await user.click(screen.getByRole('button', { name: 'Create promotion' }));
    await user.type(screen.getByLabelText('Promotion name'), 'Morning offer');
    await user.clear(screen.getByLabelText('Discount percentage'));
    await user.type(screen.getByLabelText('Discount percentage'), '12.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: 'Morning offer',
        discountPct: 12.5,
        siteId: null,
        productId: null,
        categoryId: null,
        customerId: null,
        minQuantity: 1,
        startsAt: null,
        endsAt: null,
        priority: 0,
        combinable: false,
      })
    );
  });

  it('exposes the explicit draft activation with optimistic version', async () => {
    const user = userEvent.setup();
    render(<PromotionsPage />);

    expect(screen.getByText('Weekend offer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(transitionMutate).toHaveBeenCalledWith({
      id: 'promo-1',
      version: 1,
      status: 'active',
    });
  });

  it('pages through every server result and resets the page when filtering', async () => {
    promotionTotal = 21;
    const user = userEvent.setup();
    render(<PromotionsPage />);

    expect(listUseQuery).toHaveBeenLastCalledWith(
      { page: 1, perPage: 20 },
      expect.objectContaining({ placeholderData: expect.any(Function) })
    );
    expect(screen.getByText('Showing 1-20 of 21')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(listUseQuery).toHaveBeenLastCalledWith(
      { page: 2, perPage: 20 },
      expect.objectContaining({ placeholderData: expect.any(Function) })
    );
    expect(screen.getByText('Last offer')).toBeInTheDocument();
    expect(screen.getByText('Showing 21-21 of 21')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Active' }));

    expect(listUseQuery).toHaveBeenLastCalledWith(
      { page: 1, perPage: 20, status: 'active' },
      expect.objectContaining({ placeholderData: expect.any(Function) })
    );
  });
});
