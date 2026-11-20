import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SalesQuickAccess } from './SalesQuickAccess';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
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

type KeyRow = inferRouterOutputs<AppRouter>['quickKeys']['list'][number];

function keyRow(overrides: Partial<KeyRow> & Pick<KeyRow, 'id' | 'productId'>): KeyRow {
  return {
    position: 0,
    kind: 'product',
    productName: 'House Coffee',
    productSku: 'COFFEE-1',
    categoryId: 'cat-drinks',
    sellable: true,
    unitId: null,
    unitAbbreviation: null,
    label: null,
    colour: 'orange',
    catalogPrice: 5,
    ...overrides,
  };
}

const state = vi.hoisted(() => ({
  keys: [] as unknown[],
  keysError: false,
  topSelling: [] as Array<{
    productId: string;
    name: string;
    sku: string;
    price: number;
    categoryId: string | null;
    quantity: number;
  }>,
  catalogPageSizes: [] as number[],
  catalogEnabled: [] as boolean[],
}));
const mutations = vi.hoisted(() => ({
  importLocal: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  setData: vi.fn(),
  refetch: vi.fn(),
}));

const getById = vi.fn(async ({ id }: { id: string }): Promise<Product> => {
  const product = products.find(candidate => candidate.id === id) ?? {
    ...products[0],
    id,
    name: 'Ground beef',
    sku: 'BEEF-1',
    price: 24000,
    sellByFraction: id === 'p-beef',
    fractionStep: 0.001,
  };
  return {
    ...product,
    sellByFraction: product.sellByFraction ?? false,
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
      {
        id: `${id}-box`,
        unitId: `${id}-box-unit`,
        unitName: 'Box',
        unitAbbreviation: 'BOX',
        equivalence: 12,
        price: product.price * 12,
        isBase: false,
      },
    ],
  } as Product;
});

// A mock that returns a value resolves the mutation and runs its onSuccess.
function mutation(fn: (input: unknown) => unknown) {
  return (options?: { onSuccess?: (data: unknown) => void }) => ({
    mutate: (input: unknown) => {
      const result = fn(input);
      if (result !== undefined) options?.onSuccess?.(result);
    },
    isIdle: vi.mocked(fn).mock.calls.length === 0,
    isPending: false,
  });
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    quickKeys: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled === false || state.keysError ? undefined : state.keys,
          isLoading: false,
          isSuccess: options.enabled !== false && !state.keysError,
          isError: state.keysError,
          refetch: mutations.refetch,
        }),
      },
      importLocal: { useMutation: mutation(mutations.importLocal) },
      set: { useMutation: mutation(mutations.set) },
      remove: { useMutation: mutation(mutations.remove) },
      reorder: { useMutation: mutation(mutations.reorder) },
    },
    products: {
      list: {
        useQuery: (input: { perPage: number }, options: { enabled?: boolean }) => {
          state.catalogPageSizes.push(input.perPage);
          state.catalogEnabled.push(options.enabled !== false);
          return {
            data: options.enabled === false ? undefined : { items: products },
            isLoading: false,
          };
        },
      },
      topSelling: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled === false ? undefined : state.topSelling,
          isFetched: options.enabled !== false,
          isLoading: false,
        }),
      },
    },
    categories: {
      tree: {
        useQuery: () => ({
          data: {
            items: [
              { id: 'cat-drinks', name: 'Drinks' },
              { id: 'cat-food', name: 'Food' },
            ],
          },
        }),
      },
    },
    useUtils: () => ({
      products: { getById: { fetch: getById } },
      quickKeys: { list: { setData: mutations.setData } },
    }),
  },
}));

const toastError = vi.fn();
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError }),
}));

vi.mock('@/features/sales/useDiscountSuggestions', () => ({
  useDiscountSuggestions: () => new Map([['p-coffee', 10]]),
}));

const baseProps = {
  scopeKey: 'tenant-1:site-1',
  siteId: 'site-1',
  onSelectProduct: vi.fn(),
};
const legacyKey = `puntovivo:sales-favorites:v1:${baseProps.scopeKey}`;

describe('SalesQuickAccess', () => {
  beforeEach(() => {
    state.keys = [];
    state.keysError = false;
    state.topSelling = [];
    state.catalogPageSizes = [];
    state.catalogEnabled = [];
    window.localStorage.clear();
    Object.values(mutations).forEach(mock => mock.mockReset());
    toastError.mockClear();
    getById.mockClear();
  });

  it('shows the site keys with their label and swatch and adds one in a single action', async () => {
    state.keys = [
      keyRow({ id: 'k1', productId: 'p-coffee', label: 'Tinto', unitId: 'p-coffee-box-unit' }),
      keyRow({ id: 'k2', productId: 'p-gone', productSku: 'GONE-1', sellable: false }),
    ];
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    const key = screen.getByTestId('sales-quick-product-COFFEE-1');
    expect(key).toHaveTextContent('Tinto');
    expect(key.querySelector('[data-colour="orange"]')).not.toBeNull();
    expect(screen.queryByTestId('sales-quick-product-GONE-1')).not.toBeInTheDocument();
    expect(state.catalogEnabled.every(enabled => !enabled)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Add Tinto to cart' }));
    expect(getById).toHaveBeenCalledWith({ id: 'p-coffee', siteId: 'site-1' }, { staleTime: 0 });
    expect(onSelectProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: expect.objectContaining({ unitId: 'p-coffee-box-unit' }),
        price: 60,
      })
    );
  });

  it('sells an open-value key by amount at the catalog price', async () => {
    state.keys = [
      keyRow({
        id: 'k-beef',
        kind: 'open_value',
        productId: 'p-beef',
        productSku: 'BEEF-1',
        label: 'Ground beef',
      }),
      keyRow({
        id: 'k-coffee',
        kind: 'open_value',
        productId: 'p-coffee',
        label: 'Coffee refill',
        position: 1,
      }),
    ];
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    expect(screen.getByTestId('sales-quick-value-BEEF-1')).toHaveTextContent('amount…');
    await user.click(screen.getByRole('button', { name: 'Sell Ground beef by amount' }));
    await user.type(screen.getByTestId('sales-quick-value-amount'), '5000');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSelectProduct).toHaveBeenCalledWith(expect.objectContaining({ price: 24000 }), 0.208);
    expect(screen.queryByTestId('sales-quick-value-form')).not.toBeInTheDocument();

    onSelectProduct.mockClear();
    await user.click(screen.getByRole('button', { name: 'Sell Coffee refill by amount' }));
    await user.type(screen.getByTestId('sales-quick-value-amount'), '12');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('enter a multiple of');
    expect(onSelectProduct).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('sales-quick-value-amount'));
    await user.type(screen.getByTestId('sales-quick-value-amount'), '15');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSelectProduct).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it('imports this browser favourites once into a site without keys', () => {
    window.localStorage.setItem(legacyKey, JSON.stringify({ productIds: ['p-bread'] }));
    const imported = [keyRow({ id: 'k1', productId: 'p-bread' })];
    mutations.importLocal.mockReturnValue(imported);
    render(<SalesQuickAccess {...baseProps} />);

    expect(mutations.importLocal).toHaveBeenCalledTimes(1);
    expect(mutations.importLocal).toHaveBeenCalledWith({
      siteId: 'site-1',
      productIds: ['p-bread'],
    });
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(mutations.setData).toHaveBeenCalledWith({ siteId: 'site-1' }, imported);
  });

  it('falls back to the catalog when none of the old favourites can be imported', () => {
    window.localStorage.setItem(legacyKey, JSON.stringify({ productIds: ['p-gone'] }));
    mutations.importLocal.mockReturnValue([]);
    const view = render(<SalesQuickAccess {...baseProps} />);
    expect(mutations.importLocal).toHaveBeenCalledTimes(1);

    view.rerender(<SalesQuickAccess {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Add House Coffee to cart' })).toBeInTheDocument();
  });

  it('drops the favourites without importing when the site already has keys', () => {
    window.localStorage.setItem(legacyKey, JSON.stringify({ productIds: ['p-bread'] }));
    state.keys = [keyRow({ id: 'k1', productId: 'p-coffee' })];
    render(<SalesQuickAccess {...baseProps} />);
    expect(mutations.importLocal).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });

  it('suggests the site top sellers, then the catalog, while the site has no keys', async () => {
    state.topSelling = [
      {
        productId: 'p-bread',
        name: 'Fresh Bread',
        sku: 'BREAD-1',
        price: 3,
        categoryId: 'cat-food',
        quantity: 12,
      },
    ];
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} canEdit />);

    expect(screen.getByText('No barcode · one touch')).toBeInTheDocument();
    const tiles = screen.getAllByRole('button', { name: /to cart$/ });
    expect(tiles.map(tile => tile.getAttribute('aria-label'))).toEqual([
      'Add Fresh Bread to cart',
      'Add House Coffee to cart',
    ]);
    expect(screen.getByText('-10%')).toBeInTheDocument();
    expect(new Set(state.catalogPageSizes)).toEqual(new Set([8]));
    // The tiles already show the top seller, so the add-a-key banner waits for real keys.
    expect(screen.queryByTestId('sales-quick-suggestion')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Food' }));
    expect(
      screen.queryByRole('button', { name: 'Add House Coffee to cart' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Fresh Bread to cart' })).toBeInTheDocument();
  });

  it('gives cashiers the keys without the editor or the suggestion', () => {
    state.topSelling = [
      {
        productId: 'p-bread',
        name: 'Bread',
        sku: 'BREAD-1',
        price: 3,
        categoryId: null,
        quantity: 5,
      },
    ];
    state.keys = [keyRow({ id: 'k1', productId: 'p-coffee' })];
    render(<SalesQuickAccess {...baseProps} />);
    expect(screen.queryByTestId('sales-favorites-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sales-quick-suggestion')).not.toBeInTheDocument();
  });

  it('suggests what sold this week to managers until they add or dismiss it', async () => {
    state.topSelling = [
      {
        productId: 'p-bread',
        name: 'Bread',
        sku: 'BREAD-1',
        price: 3,
        categoryId: null,
        quantity: 84,
      },
    ];
    state.keys = [keyRow({ id: 'k1', productId: 'p-coffee' })];
    const user = userEvent.setup();
    const view = render(<SalesQuickAccess {...baseProps} canEdit />);

    expect(screen.getByTestId('sales-quick-suggestion')).toHaveTextContent('84 times');
    await user.click(screen.getByTestId('sales-quick-suggestion-add'));
    expect(mutations.set).toHaveBeenCalledWith({ siteId: 'site-1', productId: 'p-bread' });

    await user.click(screen.getByTestId('sales-quick-suggestion-dismiss'));
    expect(screen.queryByTestId('sales-quick-suggestion')).not.toBeInTheDocument();
    view.unmount();
    render(<SalesQuickAccess {...baseProps} canEdit />);
    expect(screen.queryByTestId('sales-quick-suggestion')).not.toBeInTheDocument();
  });

  it('opens the owner editor from the strip', async () => {
    state.keys = [keyRow({ id: 'k1', productId: 'p-coffee' })];
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} canEdit />);

    await user.click(screen.getByRole('button', { name: 'You choose what goes here' }));
    expect(await screen.findByRole('dialog', { name: 'Keys without a barcode' })).toBeVisible();
  });

  it('keeps the keys during a sale and drops a hidden category filter', async () => {
    state.keys = [
      keyRow({ id: 'k1', productId: 'p-coffee' }),
      keyRow({
        id: 'k2',
        productId: 'p-bread',
        productName: 'Fresh Bread',
        productSku: 'BREAD-1',
        categoryId: 'cat-food',
      }),
    ];
    const user = userEvent.setup();
    const { rerender } = render(<SalesQuickAccess {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Food' }));
    expect(screen.queryByTestId('sales-quick-product-COFFEE-1')).not.toBeInTheDocument();

    rerender(<SalesQuickAccess {...baseProps} hasCartItems />);
    expect(screen.queryByRole('button', { name: 'Food' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-quick-product-COFFEE-1')).toBeEnabled();
  });

  it('offers a retry when the keys cannot load', async () => {
    state.keysError = true;
    const user = userEvent.setup();
    render(<SalesQuickAccess {...baseProps} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The quick keys could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Retry quick keys' }));
    expect(mutations.refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces products without a sellable unit and failed lookups instead of mutating the cart', async () => {
    state.keys = [keyRow({ id: 'k1', productId: 'p-coffee' })];
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    getById.mockResolvedValueOnce(products[0] as Product);
    getById.mockRejectedValueOnce(new Error('offline'));
    render(<SalesQuickAccess {...baseProps} onSelectProduct={onSelectProduct} />);

    await user.click(screen.getByRole('button', { name: 'Add House Coffee to cart' }));
    await user.click(screen.getByRole('button', { name: 'Add House Coffee to cart' }));

    expect(onSelectProduct).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenNthCalledWith(1, {
      title: 'This product does not have a sellable unit.',
    });
    expect(toastError).toHaveBeenNthCalledWith(2, {
      title: 'The product could not be added. Try again.',
    });
    expect(screen.getByRole('button', { name: 'Add House Coffee to cart' })).toBeEnabled();
  });
});
