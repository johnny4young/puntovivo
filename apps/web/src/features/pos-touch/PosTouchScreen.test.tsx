/**
 * ENG-087 — PosTouchScreen component tests.
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
import i18next from '@/i18n';
import { render, screen, within } from '@/test/utils';
import { PosTouchScreen } from './PosTouchScreen';
import { PosTouchCartSidebar, type PosTouchCustomer } from './PosTouchCartSidebar';

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
let mockActiveSession: { id: string } | null = { id: 'session-1' };
const createMutate = vi.fn(async (_input: unknown) => ({ id: 'sale-1' }) as { id: string });
const invalidateCash = vi.fn();
const invalidateProducts = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

// ENG-052b critical-mutation helper ships its own envelope/idempotency
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
    products: {
      list: {
        useQuery: (
          input: { categoryId?: string; isActive?: boolean },
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
          return {
            data: { items: filtered, total: filtered.length },
            isLoading: false,
            error: null,
          };
        },
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
        movements: { invalidate: vi.fn() },
        // ENG-204 — the sale epilogue now refreshes the pace HUD too.
        pace: { invalidate: vi.fn() },
        report: { invalidate: vi.fn() },
        registerAssignments: { invalidate: vi.fn() },
      },
      sales: {
        list: { invalidate: vi.fn() },
        listDrafts: { invalidate: vi.fn() },
        summary: { invalidate: vi.fn() },
      },
      inventory: {
        listMovements: { invalidate: vi.fn() },
        listStock: { invalidate: vi.fn() },
      },
      customerLedger: {
        getBalance: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
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
            const base = mockProducts.find(p => p.id === id);
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
                  isBase: true,
                },
              ],
            };
          },
        },
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
  useToast: () => ({ success: toastSuccess, error: toastError }),
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

describe('PosTouchScreen (ENG-087)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockSiteId = 'site-1';
    mockActiveSession = { id: 'session-1' };
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

  it('disables Charge sale when no cash session is open', () => {
    mockActiveSession = null;
    render(<PosTouchScreen />);
    expect(screen.getByTestId('pos-touch-cart-charge')).toBeDisabled();
    expect(screen.getByTestId('pos-touch-cart-charge-hint')).toHaveTextContent(
      'Open the cash register'
    );
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

  it('adds a product to the cart on tile tap', async () => {
    const user = userEvent.setup();
    render(<PosTouchScreen />);
    await user.click(screen.getByTestId('pos-touch-tile-p-1'));
    const line = await screen.findByTestId('pos-touch-cart-line-p-1:p-1-unit-1');
    expect(within(line).getByText(/Arroz Diana 500g/)).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith({ title: 'Added Arroz Diana 500g to the cart' });
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
        canCharge={false}
        chargeDisabledReason={'noItems'}
        isCharging={false}
        onClearCart={vi.fn()}
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
    expect(call.amountReceived).toBe(3200);
    expect(Array.isArray(call.items)).toBe(true);
    expect((call.items as Array<{ productId: string; quantity: number }>)[0]).toMatchObject({
      productId: 'p-1',
      quantity: 1,
    });
    expect(invalidateCash).toHaveBeenCalled();
    expect(invalidateProducts).toHaveBeenCalled();
  });
});
