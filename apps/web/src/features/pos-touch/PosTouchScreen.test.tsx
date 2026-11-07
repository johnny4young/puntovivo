/**
 * PosTouchScreen component tests.
 *
 * Pins the V1 surface contract: no-site fallback, cash-session
 * gating on Cobrar, category counts + filter, add-to-cart via
 * tile tap, multi-item subtotal math, customer slot behaviour
 * (empty vs loyaltyProfile), and the `sales.create` payload
 * shape used by Cobrar.
 *
 * trpc + useTenant + useToast are mocked via the same pattern as
 * `DeliveryPage.test.tsx` so we never hit the network or pull in
 * the full app shell.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent } from '@testing-library/react';
import i18next from '@/i18n';
import { render, screen, waitFor, within } from '@/test/utils';
import { PosTouchScreen } from './PosTouchScreen';
import { PosTouchCartSidebar, type PosTouchCustomer } from './PosTouchCartSidebar';
import { PosTouchProductGrid } from './PosTouchProductGrid';
import type { Product } from '@/types';

interface MockProduct {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  price: number;
  price2: number;
  price3: number;
  cost: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
  taxRate: number;
  initialCost: number;
  stock: number;
  minStock: number;
  sellByFraction: boolean;
  isActive: boolean;
  categoryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

let mockSiteId: string | null = 'site-1';
let mockProducts: MockProduct[] = [];
let mockCategories: Array<{ id: string; name: string }> = [];
let mockCustomers: Array<{
  id: string;
  name: string;
  priceTier?: number;
  taxId?: string | null;
  email?: string | null;
}> = [];
let mockInvoiceAvailability: {
  available: boolean;
  identificationTypes: Array<{ code: string; abbr: string; nameEs: string; nameEn: string }>;
} = { available: false, identificationTypes: [] };
let mockActiveSession: { id: string } | null = { id: 'session-1' };
let mockDineInActive = true;
let productFetchOverride: ((input: { id: string }) => Promise<Record<string, unknown>>) | null =
  null;
const createMutate = vi.fn(async (_input: unknown) => ({ id: 'sale-1' }) as { id: string });
const invalidateCash = vi.fn();
const invalidateProducts = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

// critical-mutation helper ships its own envelope/idempotency
// wrapper around React Query. We mock it directly so we don't need to
// pull in the desktop bridge or fetch the envelope header.
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    _path: string,
    opts?: {
      onSuccess?: (data: unknown, variables: unknown) => unknown | Promise<unknown>;
      onError?: (err: unknown) => unknown;
    }
  ) => ({
    mutateAsync: async (input: unknown) => {
      const result = await createMutate(input);
      await opts?.onSuccess?.(result, input);
      return result;
    },
    isPending: false,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    peripherals: {
      activeForSite: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
    },
    products: {
      list: {
        useQuery: (
          input: {
            categoryId?: string;
            isActive?: boolean;
            siteId?: string;
            search?: string;
            page?: number;
            perPage?: number;
          },
          options?: { enabled?: boolean }
        ) => {
          if (options?.enabled === false) {
            return { data: undefined, isLoading: false, error: null };
          }
          const filtered = mockProducts.filter(product => {
            if (input.isActive !== undefined && product.isActive !== input.isActive) {
              return false;
            }
            return input.categoryId ? product.categoryId === input.categoryId : true;
          });
          const matching = input.search
            ? filtered.filter(product => product.name.includes(input.search ?? ''))
            : filtered;
          const page = input.page ?? 1;
          const perPage = input.perPage ?? 50;
          const pageItems = matching.slice((page - 1) * perPage, page * perPage);
          const items = input.siteId
            ? pageItems.map(product => ({ ...product, siteStock: 7 }))
            : pageItems;
          return {
            data: {
              items,
              totalItems: matching.length,
              totalPages: Math.ceil(matching.length / perPage),
            },
            isLoading: false,
            error: null,
          };
        },
      },
      categoryCounts: {
        useQuery: () => {
          const active = mockProducts.filter(product => product.isActive);
          const counts = new Map<string, number>();
          for (const product of active) {
            if (!product.categoryId) continue;
            counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
          }
          return {
            data: {
              total: active.length,
              categories: [...counts].map(([categoryId, count]) => ({ categoryId, count })),
            },
          };
        },
      },
    },
    customers: {
      list: {
        useQuery: () => ({
          data: { items: mockCustomers, totalItems: mockCustomers.length },
          isLoading: false,
          error: null,
        }),
      },
    },
    categories: {
      tree: {
        useQuery: () => ({
          data: { items: mockCategories },
          isLoading: false,
          error: null,
        }),
      },
    },
    cashSessions: {
      getActive: {
        useQuery: () => ({
          data: mockActiveSession,
          isLoading: false,
          error: null,
        }),
      },
    },
    sales: {
      electronicInvoiceAvailability: {
        useQuery: () => ({ data: mockInvoiceAvailability }),
      },
      create: {
        useMutation: (opts?: {
          onSuccess?: (data: unknown, variables: unknown) => unknown | Promise<unknown>;
          onError?: (err: unknown) => unknown;
        }) => ({
          mutateAsync: async (input: unknown) => {
            const result = await createMutate(input);
            await opts?.onSuccess?.(result, input);
            return result;
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      // The charge epilogue invalidates the shared SALE_COMPLETION_INVALIDATIONS
      // set, so every picked leaf must exist on the mock.
      setupReadiness: {
        firstSale: { invalidate: vi.fn() },
      },
      cashSessions: {
        getActive: { invalidate: invalidateCash },
        myPace: { invalidate: vi.fn() },
        movements: { invalidate: vi.fn() },
        // the sale epilogue now refreshes the pace HUD too.
        pace: { invalidate: vi.fn() },
        report: { invalidate: vi.fn() },
        registerAssignments: { invalidate: vi.fn() },
      },
      sales: {
        list: { invalidate: vi.fn() },
        listDrafts: { invalidate: vi.fn() },
        summary: { invalidate: vi.fn() },
      },
      restaurantTables: {
        listWithDraftStatus: { invalidate: vi.fn() },
      },
      restaurantServices: {
        getTableState: { invalidate: vi.fn() },
      },
      reservations: { list: { invalidate: vi.fn() } },
      // Quote conversion shares the canonical sale epilogue. Touch sales do
      // not originate from a quotation, but the invalidation leaf set is
      // deliberately surface-agnostic and must remain fully represented.
      quotations: {
        list: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
      inventory: {
        listMovements: { invalidate: vi.fn() },
        listStock: { invalidate: vi.fn() },
      },
      customerLedger: {
        getBalance: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
      },
      loyalty: {
        forCustomer: { invalidate: vi.fn() },
      },
      products: {
        list: { invalidate: invalidateProducts },
        search: { invalidate: vi.fn() },
        // `handleAddToCart` calls `utils.products.getById.fetch` to
        // hydrate the unit assignments missing from `products.list`.
        // The mock returns the product augmented with a single base
        // unit assignment so `selectionFromProduct` succeeds.
        getById: {
          fetch: async ({ id }: { id: string }) => {
            if (productFetchOverride) return productFetchOverride({ id });
            return hydrateProductForTest(id);
          },
        },
      },
      productSerials: {
        list: { invalidate: vi.fn() },
        lookup: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 'tenant-1', name: 'Tenant 1' },
    currentSite: mockSiteId ? { id: mockSiteId, name: 'Site 1' } : null,
    tenantSettings: { currency: 'USD' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: toastWarning }),
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: () => mockDineInActive,
}));

function makeProduct(overrides: Partial<MockProduct> = {}): MockProduct {
  return {
    id: 'p-1',
    tenantId: 'tenant-1',
    name: 'Arroz Diana 500g',
    sku: 'ABR-0001',
    price: 3200,
    price2: 3200,
    price3: 3200,
    cost: 2000,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 2000,
    stock: 50,
    minStock: 0,
    sellByFraction: false,
    isActive: true,
    categoryId: 'cat-abarrotes',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function hydrateProductForTest(id: string): Record<string, unknown> {
  const base = mockProducts.find(product => product.id === id);
  if (!base) throw new Error('Product not found');
  return {
    ...base,
    unitAssignments: [
      {
        id: `${id}-ua`,
        productId: id,
        unitId: `${id}-unit-1`,
        unitName: 'UND',
        unitAbbreviation: 'UND',
        equivalence: 1,
        price: base.price,
        price2: base.price2,
        price3: base.price3,
        isBase: true,
      },
    ],
  };
}

describe('PosTouchScreen', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockSiteId = 'site-1';
    mockActiveSession = { id: 'session-1' };
    mockDineInActive = true;
    productFetchOverride = null;
    mockCustomers = [];
    mockInvoiceAvailability = { available: false, identificationTypes: [] };
    mockProducts = [
      makeProduct({
        id: 'p-1',
        name: 'Arroz Diana 500g',
        price: 3200,
        categoryId: 'cat-abarrotes',
      }),
      makeProduct({
        id: 'p-2',
        name: 'Azúcar Incauca 1kg',
        price: 4500,
        categoryId: 'cat-abarrotes',
      }),
      makeProduct({ id: 'p-3', name: 'Pan Bimbo', price: 5800, categoryId: 'cat-panaderia' }),
      makeProduct({
        id: 'p-4',
        name: 'Producto desactivado',
        price: 9900,
        categoryId: 'cat-abarrotes',
        isActive: false,
      }),
    ];
    mockCategories = [
      { id: 'cat-abarrotes', name: 'Abarrotes' },
      { id: 'cat-panaderia', name: 'Panadería' },
    ];
  });

  it('renders the no-active-site banner when there is no active site', () => {
    mockSiteId = null;
    render(<PosTouchScreen />);
    expect(screen.getByTestId('pos-touch-no-site')).toBeInTheDocument();
  });

  it('declares a two-track grid so the cart renders as a right rail', () => {
    render(<PosTouchScreen />);
    // A comma between tracks compiles to an invalid template that browsers drop silently.
    expect(screen.getByTestId('pos-touch-layout')).toHaveClass(
      'lg:grid-cols-[minmax(0,1fr)_22rem]'
    );
  });

  it('disables Charge sale when no cash session is open', () => {
    mockActiveSession = null;
    render(<PosTouchScreen />);
    expect(screen.getByTestId('pos-touch-cart-charge')).toBeDisabled();
    expect(screen.getByTestId('pos-touch-cart-charge-hint')).toHaveTextContent(
      'Open the cash register'
    );
  });

  it('hides voice ordering when dine-in is disabled', () => {
    mockDineInActive = false;
    render(<PosTouchScreen />);
    expect(screen.queryByTestId('pos-touch-voice-link')).not.toBeInTheDocument();
  });

  it('shows category tabs with the correct per-category item counts', () => {
    render(<PosTouchScreen />);
    expect(screen.getByTestId('pos-touch-category-all-count')).toHaveTextContent('3');
    expect(screen.getByTestId('pos-touch-category-cat-abarrotes-count')).toHaveTextContent('2');
    expect(screen.getByTestId('pos-touch-category-cat-panaderia-count')).toHaveTextContent('1');
    expect(screen.queryByTestId('pos-touch-tile-p-4')).not.toBeInTheDocument();
  });

  it('filters the product grid when a category tab is clicked', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    expect(screen.getAllByTestId(/^pos-touch-tile-/).length).toBe(3);
    await user.click(screen.getByTestId('pos-touch-category-cat-panaderia'));
    const tiles = screen.getAllByTestId(/^pos-touch-tile-/);
    expect(tiles.length).toBe(1);
    expect(tiles[0]).toHaveAttribute('data-testid', 'pos-touch-tile-p-3');
  });

  it('pages the catalog and returns to the first page on a new filter', async () => {
    const user = userEvent.setup();
    const base = mockProducts[0]!;
    mockProducts = Array.from({ length: 30 }, (_, index) => ({
      ...base,
      id: `bulk-${index}`,
      name: `Bulk ${index}`,
    }));
    render(<PosTouchScreen />);

    expect(screen.getAllByTestId(/^pos-touch-tile-/)).toHaveLength(24);
    expect(screen.getByTestId('pos-touch-page-status')).toHaveTextContent(
      'Page 1 of 2 · 30 products'
    );
    expect(screen.getByTestId('pos-touch-page-previous')).toBeDisabled();

    const catalog = screen.getByTestId('pos-touch-catalog');
    catalog.scrollTop = 200;
    await user.click(screen.getByTestId('pos-touch-page-next'));
    expect(catalog.scrollTop).toBe(0);
    expect(screen.getAllByTestId(/^pos-touch-tile-/)).toHaveLength(6);
    expect(screen.getByTestId('pos-touch-page-next')).toBeDisabled();

    await user.click(screen.getByTestId('pos-touch-category-all'));
    expect(screen.getByTestId('pos-touch-page-status')).toHaveTextContent('Page 1 of 2');
  });

  it('clears a scanner burst that lands in the focused search field', async () => {
    render(<PosTouchScreen />);
    const search = screen.getByTestId<HTMLInputElement>('pos-touch-search');
    search.focus();

    // A wedge scanner types into the focused field before its end-of-scan key.
    fireEvent.change(search, { target: { value: '7701234567890' } });
    for (const key of '7701234567890') fireEvent.keyDown(search, { key });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() => expect(search).toHaveValue(''));
  });

  it('moves back to the last page when the catalog shrinks under it', async () => {
    const user = userEvent.setup();
    const base = mockProducts[0]!;
    const bulk = (length: number) =>
      Array.from({ length }, (_, index) => ({ ...base, id: `bulk-${index}` }));
    mockProducts = bulk(30);
    const { rerender } = render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-page-next'));

    mockProducts = bulk(5);
    rerender(<PosTouchScreen />);

    expect(await screen.findAllByTestId(/^pos-touch-tile-/)).toHaveLength(5);
    expect(screen.queryByTestId('pos-touch-grid-empty')).not.toBeInTheDocument();
  });

  it('searches the catalog and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);

    await user.type(screen.getByTestId('pos-touch-search'), 'zzz-none');
    expect(await screen.findByTestId('pos-touch-grid-empty')).toHaveTextContent(
      'No products match your search.'
    );
    expect(screen.queryByTestId('pos-touch-pagination')).not.toBeInTheDocument();
  });

  it('shows stock state on tiles and a quantity badge once in the cart', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);

    const stock = screen.getByTestId('pos-touch-stock-p-1');
    expect(stock).toHaveAttribute('data-stock-state', 'ok');
    // The mock only returns a site balance when the screen asks for its site.
    expect(stock).toHaveTextContent('7 in stock');
    expect(screen.queryByTestId('pos-touch-quantity-p-1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));

    expect(screen.getByTestId('pos-touch-quantity-p-1')).toHaveTextContent('2');
    expect(screen.getByTestId('pos-touch-tile-p-1')).toHaveAccessibleName(/2 in cart/);
  });

  it('marks low and out of stock tiles and skips products without stock tracking', () => {
    const product = (overrides: Partial<Product>) =>
      ({ ...mockProducts[0], ...overrides }) as unknown as Product;
    render(
      <PosTouchProductGrid
        isLoading={false}
        isError={false}
        onSelect={vi.fn()}
        products={[
          product({ id: 'low', stock: 3, minStock: 5, tracksStock: true }),
          product({ id: 'out', stock: 0, minStock: 5, tracksStock: true }),
          product({ id: 'service', stock: 0, minStock: 0, tracksStock: false }),
          product({ id: 'other-site', stock: 40, siteStock: 0, minStock: 5, tracksStock: true }),
        ]}
      />
    );

    expect(screen.getByTestId('pos-touch-stock-low')).toHaveAttribute('data-stock-state', 'low');
    expect(screen.getByTestId('pos-touch-stock-out')).toHaveTextContent('Out of stock');
    expect(screen.queryByTestId('pos-touch-stock-service')).not.toBeInTheDocument();
    // Stock held only at another site must not read as available here.
    expect(screen.getByTestId('pos-touch-stock-other-site')).toHaveTextContent('Out of stock');
  });

  it('adds a product to the cart on tile tap', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    const line = await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    expect(within(line).getByText(/Arroz Diana 500g/)).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith({ title: 'Added Arroz Diana 500g to the cart' });
  });

  it('uses an adaptive high-contrast treatment for the selected price tier', () => {
    render(<PosTouchScreen />);
    expect(screen.getByRole('button', { name: 'Tier 1' })).toHaveClass(
      'bg-primary-800',
      'text-primary-foreground'
    );
  });

  it('computes the multi-item subtotal correctly', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await user.click(screen.getByTestId('pos-touch-tile-p-2'));
    // 3200 + 4500 = 7700. Currency formatting may add commas/decimals.
    const total = screen.getByTestId('pos-touch-cart-total');
    expect(total.textContent?.replace(/[^0-9]/g, '')).toContain('7700');
  });

  it('shows the walk-in placeholder when no customer is attached', () => {
    render(<PosTouchScreen />);
    expect(
      within(screen.getByTestId('pos-touch-cart-customer')).getByText('Walk-in customer')
    ).toBeInTheDocument();
    // Loyalty surface stays invisible without loyaltyProfile.
    expect(screen.queryByTestId('pos-touch-cart-loyalty')).not.toBeInTheDocument();
  });

  it('never reprices on customer selection and applies the suggested tier explicitly', async () => {
    const user = userEvent.setup();
    mockCustomers = [{ id: 'cust-wholesale', name: 'Wholesale Customer', priceTier: 2 }];
    mockProducts = [
      makeProduct({ id: 'p-1', name: 'Arroz Diana 500g', price: 3200, price2: 2800 }),
    ];

    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    expect(
      screen.getByTestId('pos-touch-cart-total').textContent?.replace(/[^0-9]/g, '')
    ).toContain('3200');

    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-wholesale');
    expect(
      screen.getByTestId('pos-touch-cart-total').textContent?.replace(/[^0-9]/g, '')
    ).toContain('3200');

    await user.click(screen.getByRole('button', { name: "Apply customer's Tier 2 prices" }));
    expect(
      screen.getByTestId('pos-touch-cart-total').textContent?.replace(/[^0-9]/g, '')
    ).toContain('2800');

    await user.click(screen.getByTestId('pos-touch-cart-charge'));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-wholesale',
        priceTier: 2,
        amountReceived: 2800,
        items: [expect.objectContaining({ productId: 'p-1', unitPrice: 2800 })],
      })
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Customer')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Tier 1' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  });

  it('prices a slow product hydration with the tier selected before it resolves', async () => {
    const user = userEvent.setup();
    mockProducts = [
      makeProduct({ id: 'p-1', name: 'Arroz Diana 500g', price: 3200, price2: 2800 }),
    ];
    let resolveProduct: ((value: Record<string, unknown>) => void) | undefined;
    const productHydration = new Promise<Record<string, unknown>>(resolve => {
      resolveProduct = resolve;
    });
    productFetchOverride = async () => productHydration;

    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await user.click(screen.getByRole('button', { name: 'Tier 2' }));
    await act(async () => {
      resolveProduct?.(hydrateProductForTest('p-1'));
      await productHydration;
    });

    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    expect(
      screen.getByTestId('pos-touch-cart-total').textContent?.replace(/[^0-9]/g, '')
    ).toContain('2800');
  });

  it('renders the loyalty badge + Sumar puntos CTA when the customer carries a loyaltyProfile', () => {
    const customer: PosTouchCustomer = {
      id: 'cust-1',
      name: 'Cliente Frecuente',
      loyaltyProfile: { tier: 'gold', points: 120 },
    };
    render(
      <PosTouchCartSidebar
        items={[]}
        summary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        customer={customer}
        customers={[customer]}
        priceTier={1}
        canCharge={false}
        chargeDisabledReason={'noItems'}
        isCharging={false}
        onClearCart={vi.fn()}
        onCustomerChange={vi.fn()}
        onPriceTierChange={vi.fn()}
        onRemoveLine={vi.fn()}
        onCharge={vi.fn()}
      />
    );
    expect(screen.getByTestId('pos-touch-cart-loyalty')).toBeInTheDocument();
    expect(screen.getByTestId('pos-touch-cart-loyalty-cta')).toHaveTextContent('Add points');
  });

  it('fires sales.create with the correct payload shape when Charge sale is tapped', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await user.click(screen.getByTestId('pos-touch-cart-charge'));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const call = createMutate.mock.calls.at(0)?.at(0) as Record<string, unknown>;
    expect(call.paymentMethod).toBe('cash');
    expect(call.paymentStatus).toBe('paid');
    expect(call.status).toBe('completed');
    expect(call.priceTier).toBe(1);
    expect(call.amountReceived).toBe(3200);
    expect(Array.isArray(call.items)).toBe(true);
    expect((call.items as Array<{ productId: string; quantity: number }>)[0]).toMatchObject({
      productId: 'p-1',
      quantity: 1,
    });
    expect(invalidateCash).toHaveBeenCalled();
    expect(invalidateProducts).toHaveBeenCalled();
  });

  it('locks the entire ticket and ignores stale product hydration while charging', async () => {
    const user = userEvent.setup();
    let resolveCharge: ((value: { id: string }) => void) | undefined;
    createMutate.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>(resolve => {
          resolveCharge = resolve;
        })
    );
    let resolveSecondProduct: ((value: Record<string, unknown>) => void) | undefined;
    const secondProductHydration = new Promise<Record<string, unknown>>(resolve => {
      resolveSecondProduct = resolve;
    });

    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    productFetchOverride = async ({ id }) =>
      id === 'p-2' ? secondProductHydration : hydrateProductForTest(id);
    await user.click(screen.getByTestId('pos-touch-tile-p-2'));
    await user.click(screen.getByTestId('pos-touch-cart-charge'));

    await waitFor(() => {
      expect(screen.getByTestId('pos-touch-cart')).toHaveAttribute('aria-busy', 'true');
    });
    expect(screen.getByTestId('pos-touch-tile-p-1')).toBeDisabled();
    expect(screen.getByTestId('pos-touch-category-all')).toBeDisabled();
    expect(screen.getByLabelText('Customer')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tier 2' })).toBeDisabled();
    expect(screen.getByTestId('pos-touch-cart-line-p-1:p-1-unit-1-remove')).toBeDisabled();
    expect(screen.getByTestId('pos-touch-cart-clear')).toBeDisabled();
    expect(screen.getByTestId('pos-touch-voice-link')).toHaveAttribute('aria-disabled', 'true');
    expect(createMutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCharge?.({ id: 'sale-locked' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('pos-touch-cart-empty')).toBeInTheDocument();
      expect(screen.getByTestId('pos-touch-cart')).toHaveAttribute('aria-busy', 'false');
    });

    await act(async () => {
      resolveSecondProduct?.(hydrateProductForTest('p-2'));
      await secondProductHydration;
    });
    expect(screen.getByTestId('pos-touch-cart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-touch-cart-line-p-2:p-2-unit-1')).not.toBeInTheDocument();
  });
});

describe('PosTouchScreen — customer asked for an electronic invoice', () => {
  const toggleName = 'Customer asked for an electronic invoice';

  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockSiteId = 'site-1';
    mockActiveSession = { id: 'session-1' };
    productFetchOverride = null;
    mockCustomers = [];
    mockProducts = [makeProduct({ id: 'p-1', name: 'Arroz Diana 500g', price: 3200 })];
    mockCategories = [];
    mockInvoiceAvailability = {
      available: true,
      identificationTypes: [
        { code: '13', abbr: 'CC', nameEs: 'Cédula de ciudadanía', nameEn: 'Citizenship ID' },
        {
          code: '31',
          abbr: 'NIT',
          nameEs: 'Número de identificación tributaria',
          nameEn: 'Tax ID',
        },
      ],
    };
  });

  function lastCharge(): Record<string, unknown> {
    return createMutate.mock.calls.at(-1)?.at(0) as Record<string, unknown>;
  }

  it('hides the selector where the site cannot issue an invoice', async () => {
    mockInvoiceAvailability = { available: false, identificationTypes: [] };
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');

    expect(screen.queryByTestId('sale-electronic-invoice')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('pos-touch-cart-charge'));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(lastCharge()).not.toHaveProperty('electronicInvoice');
  });

  it('charges with the POS document and asks for no buyer data while the selector is off', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    const toggle = await screen.findByRole('checkbox', { name: toggleName });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText('Name or business name')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    await user.click(screen.getByTestId('pos-touch-cart-charge'));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const charge = lastCharge();
    expect(charge).not.toHaveProperty('electronicInvoice');
    expect(charge).not.toHaveProperty('invoiceRequested');
    expect(charge).not.toHaveProperty('invoiceBuyer');
  });

  it('requires the buyer once the selector is on, submits the request and clears it after the sale', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');

    await user.click(await screen.findByRole('checkbox', { name: toggleName }));
    expect(screen.getByLabelText('Name or business name')).toHaveClass('min-h-[44px]');
    await user.click(screen.getByTestId('pos-touch-cart-charge'));
    expect(await screen.findAllByText('Required')).toHaveLength(2);
    expect(createMutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Name or business name'), '  Ferretería La 14 SAS ');
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-3');
    await user.type(screen.getByLabelText('Email (optional)'), ' compras@la14.co ');
    await user.click(screen.getByTestId('pos-touch-cart-charge'));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(lastCharge()).toMatchObject({
      paymentMethod: 'cash',
      status: 'completed',
      electronicInvoice: {
        buyer: {
          name: 'Ferretería La 14 SAS',
          identificationTypeCode: '31',
          identificationNumber: '900373115-3',
          email: 'compras@la14.co',
        },
      },
    });
    // The next walk-in sale must not inherit this buyer.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: toggleName })).not.toBeChecked()
    );
    expect(screen.queryByLabelText('Name or business name')).not.toBeInTheDocument();
  });

  it('drops the buyer when the cashier clears the ticket', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    await user.click(await screen.findByRole('checkbox', { name: toggleName }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ferretería La 14 SAS');

    await user.click(screen.getByTestId('pos-touch-cart-clear'));

    expect(screen.getByRole('checkbox', { name: toggleName })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: toggleName }));
    expect(screen.getByLabelText('Name or business name')).toHaveValue('');
  });

  it('drops the buyer when the active site changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PosTouchScreen />);
    await user.click(await screen.findByRole('checkbox', { name: toggleName }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ferretería La 14 SAS');

    mockSiteId = 'site-2';
    rerender(<PosTouchScreen />);

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: toggleName })).not.toBeChecked()
    );
  });

  it('prefills the buyer from the customer attached on the touch cart', async () => {
    mockCustomers = [
      { id: 'cust-ana', name: 'Ana Gómez', taxId: '1020304050', email: 'ana@example.co' },
    ];
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-ana');

    await user.click(await screen.findByRole('checkbox', { name: toggleName }));
    expect(screen.getByLabelText('Name or business name')).toHaveValue('Ana Gómez');
    expect(screen.getByLabelText('ID number')).toHaveValue('1020304050');
    await user.click(screen.getByTestId('pos-touch-cart-charge'));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(lastCharge()).toMatchObject({
      customerId: 'cust-ana',
      electronicInvoice: {
        buyer: {
          name: 'Ana Gómez',
          identificationTypeCode: '13',
          identificationNumber: '1020304050',
          email: 'ana@example.co',
        },
      },
    });
  });

  it('locks the buyer fields while the charge is in flight', async () => {
    let resolveCharge: ((value: { id: string }) => void) | undefined;
    createMutate.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>(resolve => {
          resolveCharge = resolve;
        })
    );
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    await user.click(await screen.findByRole('checkbox', { name: toggleName }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ana Gómez');
    await user.type(screen.getByLabelText('ID number'), '1020304050');
    await user.click(screen.getByTestId('pos-touch-cart-charge'));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: toggleName })).toBeDisabled());
    expect(screen.getByLabelText('Name or business name')).toBeDisabled();

    await act(async () => {
      resolveCharge?.({ id: 'sale-invoice' });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: toggleName })).toBeEnabled());
  });
});
