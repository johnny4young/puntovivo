import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SalesQuickAccess } from './SalesQuickAccess';
import type { Product } from '@/types';
import { writeSalesFavoriteIds } from './salesFavorites';

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

const remoteProduct = {
  ...products[0],
  id: 'p-remote',
  name: 'Remote Favorite',
  sku: 'REMOTE-1',
} as Product;
let favoriteLookupError = false;
const favoriteRefetch = vi.fn(async () => undefined);
function favoriteQuery({ id }: { id: string }) {
  return {
    data: favoriteLookupError
      ? undefined
      : [...products, remoteProduct].find(product => product.id === id),
    isLoading: false,
    isError: favoriteLookupError,
    refetch: favoriteRefetch,
  };
}

const toastSuccess = vi.fn();
const toastError = vi.fn();
const getById = vi.fn(async ({ id }: { id: string }): Promise<Product> => {
  const product = [...products, remoteProduct].find(candidate => candidate.id === id);
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
    useQueries: (
      select: (api: {
        products: { getById: typeof favoriteQuery };
      }) => ReturnType<typeof favoriteQuery>[]
    ) => select({ products: { getById: favoriteQuery } }),
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
    favoriteLookupError = false;
    favoriteRefetch.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    getById.mockClear();
  });

  it('loads a configured favorite outside the first catalog page and adds it once', async () => {
    writeSalesFavoriteIds(baseProps.scopeKey, [remoteProduct.id]);
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);
    await user.click(screen.getByRole('button', { name: 'Add Remote Favorite to cart' }));
    expect(getById).toHaveBeenCalledTimes(1);
    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct).toHaveBeenCalledWith(
      expect.objectContaining({ product: expect.objectContaining({ id: remoteProduct.id }) })
    );
  });

  it('keeps failed favorite loading recoverable without changing the saved IDs', async () => {
    writeSalesFavoriteIds(baseProps.scopeKey, [remoteProduct.id]);
    favoriteLookupError = true;
    const user = userEvent.setup();
    const view = render(<SalesQuickAccess {...baseProps} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some favorite products could not be loaded. Retry or use catalog search.'
    );
    await user.click(screen.getByRole('button', { name: 'Retry favorites' }));
    expect(favoriteRefetch).toHaveBeenCalledTimes(1);
    favoriteLookupError = false;
    view.rerender(<SalesQuickAccess {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Add Remote Favorite to cart' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem('puntovivo:sales-favorites:v1:' + baseProps.scopeKey)
    ).toContain(remoteProduct.id);
  });

  it('shows suggested products and filters them by category', async () => {
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} />);

    expect(screen.getByText('One-tap products')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add House Coffee to cart' })).toBeInTheDocument();
    expect(screen.getByText('-10%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Food' }));
    expect(
      screen.queryByRole('button', { name: 'Add House Coffee to cart' })
    ).not.toBeInTheDocument();
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
        window.localStorage.getItem('puntovivo:sales-favorites:v1:tenant-1:site-1') ?? '{}'
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

  it('keeps the latest completed receipt one action away', async () => {
    const user = userEvent.setup();
    const onOpenLastReceipt = vi.fn();
    render(
      <SalesQuickAccess
        {...baseProps}
        lastCompletedSaleId="sale-1"
        onOpenLastReceipt={onOpenLastReceipt}
      />
    );

    await user.click(screen.getByTestId('sales-open-last-receipt'));
    expect(onOpenLastReceipt).toHaveBeenCalledOnce();
  });
  it('keeps a saved favorite outside the first page editable', async () => {
    const user = userEvent.setup();
    writeSalesFavoriteIds(baseProps.scopeKey, [remoteProduct.id]);
    render(<SalesQuickAccess {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    await user.click(screen.getByRole('button', { name: 'Remove Remote Favorite from favorites' }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(
      screen.queryByRole('button', { name: 'Add Remote Favorite to cart' })
    ).not.toBeInTheDocument();
  });
});
