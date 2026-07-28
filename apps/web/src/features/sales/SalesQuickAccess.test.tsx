import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SalesQuickAccess } from './SalesQuickAccess';
import type { Product } from '@/types';

const products = [
  {
    id: 'p-coffee',
    tenantId: 'tenant-1',
    name: 'House Coffee',
    sku: 'COFFEE-1',
    categoryId: 'cat-drinks',
    price: 5,
    isActive: true,
  },
  {
    id: 'p-bread',
    tenantId: 'tenant-1',
    name: 'Fresh Bread',
    sku: 'BREAD-1',
    categoryId: 'cat-food',
    price: 3,
    isActive: true,
  },
] as Product[];

const toastSuccess = vi.fn();
const toastError = vi.fn();
const getById = vi.fn(async ({ id }: { id: string }): Promise<Product> => {
  const product = products.find(candidate => candidate.id === id);
  if (!product) throw new Error('missing');
  return {
    ...product,
    unitAssignments: [
      {
        id: `${id}-assignment`,
        unitId: `${id}-unit`,
        unitName: 'Unit',
        unitAbbreviation: 'EA',
        equivalence: 1,
        price: product.price,
        isBase: true,
      },
    ],
  } as Product;
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    products: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled === false ? undefined : { items: products },
          isLoading: false,
        }),
      },
    },
    categories: {
      tree: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data:
            options.enabled === false
              ? undefined
              : {
                  items: [
                    { id: 'cat-drinks', name: 'Drinks' },
                    { id: 'cat-food', name: 'Food' },
                  ],
                },
        }),
      },
    },
    useUtils: () => ({
      products: {
        getById: { fetch: getById },
      },
    }),
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock('@/features/sales/useDiscountSuggestions', () => ({
  useDiscountSuggestions: () => new Map([['p-coffee', 10]]),
}));

const baseProps = {
  scopeKey: 'tenant-1:site-1',
  siteId: 'site-1',
  hasCartItems: false,
  canFocusDiscount: false,
  onSelectProduct: vi.fn(),
  onOpenSearch: vi.fn(),
  onFocusDiscount: vi.fn(),
  onNewSale: vi.fn(),
};

describe('SalesQuickAccess', () => {
  beforeEach(() => {
    window.localStorage.clear();
    toastSuccess.mockClear();
    toastError.mockClear();
    getById.mockClear();
  });

  it('shows suggested products and filters them by category', async () => {
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} />);

    expect(screen.getByText('One-tap products')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add House Coffee to cart' })).toBeInTheDocument();
    expect(screen.getByText('-10%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Food' }));
    expect(screen.queryByRole('button', { name: 'Add House Coffee to cart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Fresh Bread to cart' })).toBeInTheDocument();
  });

  it('hydrates a favorite and adds it to the cart in one action', async () => {
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    await user.click(screen.getByRole('button', { name: 'Add House Coffee to cart' }));

    expect(getById).toHaveBeenCalledWith({ id: 'p-coffee' });
    expect(onSelectProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({ id: 'p-coffee' }),
        unit: expect.objectContaining({ unitId: 'p-coffee-unit' }),
        price: 5,
      })
    );
  });

  it('surfaces products without a sellable unit instead of mutating the cart', async () => {
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    getById.mockResolvedValueOnce(products[0] as Product);
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    await user.click(screen.getByRole('button', { name: 'Add House Coffee to cart' }));

    expect(onSelectProduct).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith({
      title: 'This product does not have a sellable unit.',
    });
  });

  it('keeps a failed product lookup recoverable', async () => {
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    getById.mockRejectedValueOnce(new Error('offline'));
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    await user.click(screen.getByRole('button', { name: 'Add House Coffee to cart' }));

    expect(onSelectProduct).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith({
      title: 'The product could not be added. Try again.',
    });
    expect(screen.getByRole('button', { name: 'Add House Coffee to cart' })).toBeEnabled();
  });

  it('stores an edited favorite selection for this register', async () => {
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} />);

    await user.click(screen.getByTestId('sales-favorites-edit'));
    await user.click(screen.getByRole('button', { name: 'Remove House Coffee from favorites' }));

    expect(
      JSON.parse(
        window.localStorage.getItem(
          'puntovivo:sales-favorites:v1:tenant-1:site-1'
        ) ?? '{}'
      )
    ).toEqual({ productIds: ['p-bread'] });
  });

  it('replaces the favorite grid with safe contextual actions after capture', async () => {
    const user = userEvent.setup();
    const onFocusDiscount = vi.fn();
    render(
      <SalesQuickAccess
        {...baseProps}
        hasCartItems
        canFocusDiscount
        onFocusDiscount={onFocusDiscount}
      />
    );

    expect(screen.queryByText('One-tap products')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adjust discount' }));
    expect(onFocusDiscount).toHaveBeenCalledOnce();
  });

  it('does not offer a second empty sale before a product is captured', () => {
    render(<SalesQuickAccess {...baseProps} />);

    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
  });
});
