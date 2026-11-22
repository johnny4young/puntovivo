/**
 * Regression coverage for the shared restaurant ordering surface.
 *
 * The suite keeps transport mocks at the tRPC boundary and exercises the
 * operator-visible state machine: catalog gating, session/AI permissions,
 * service-state loading, the plate sheet, the order rail and round sending.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { formatCurrency } from '@/lib/utils';

/** toHaveTextContent collapses the currency's non-breaking space. */
const money = (value: number) => formatCurrency(value).replace(/\s/g, ' ');

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const logoutMock = vi.fn();

const moduleActiveMock = vi.fn((_id: string) => true);
const aiEnabledMock = vi.fn(() => true);
const voiceAvailabilityUseQueryMock = vi.fn((_input: unknown, _options: { enabled: boolean }) => ({
  data: { enabled: aiEnabledMock() },
  isLoading: false,
}));
const restrictedSettingsUseQueryMock = vi.fn(() => ({
  data: undefined,
  isLoading: false,
  error: new Error('FORBIDDEN'),
}));
const cashSessionMock = vi.fn<() => Record<string, unknown> | null>(() => ({
  id: 'cs-1',
  siteId: 'site-1',
  cashierId: 'user-1',
  registerName: 'Register A',
  openedAt: new Date().toISOString(),
}));

/** Minimal table-catalog query state exposed to the component under test. */
/** Mutable test projection returned by the table-catalog query mock. */
interface TableCatalogState {
  data: { items: Array<{ id: string; name: string; seatCount: number | null }> } | undefined;
  isLoading: boolean;
  error: Error | null;
}

/** Minimal normalized service projection exposed to the component under test. */
/** Mutable test projection returned by the table-service query mock. */
interface TableServiceState {
  data:
    | {
        service: { id: string; guestCount: number; billRequestedAt?: string | null } | null;
        checks: Array<Record<string, unknown>>;
        diners: Array<{ id: string; seatNumber: number | null }>;
      }
    | undefined;
  isLoading: boolean;
  error: Error | null;
}

const restaurantTablesMock = vi.fn<() => TableCatalogState>();
const restaurantTableStateMock = vi.fn<() => TableServiceState>();
const restaurantTablesUseQueryMock = vi.fn((_input: unknown, _options: { enabled: boolean }) =>
  restaurantTablesMock()
);
const restaurantTableStateUseQueryMock = vi.fn((_input: unknown, _options: { enabled: boolean }) =>
  restaurantTableStateMock()
);
const productGroupsMock = vi.fn(() => ({
  data: [] as unknown[],
  isLoading: false,
  isSuccess: true,
  error: null as Error | null,
  refetch: vi.fn(),
}));
const productsListMock = vi.fn(() => ({
  data: { items: [] as unknown[], totalPages: 1 },
  isLoading: false,
  error: null,
}));
const getByIdFetch = vi.fn();
const openCheckMutateAsync = vi.fn();
const invalidateSales = vi.fn();
const invalidateDrafts = vi.fn();
const invalidateSalesSummary = vi.fn();
const invalidateCashSession = vi.fn();
const invalidateTableStatus = vi.fn();
const invalidateTableSummary = vi.fn();
const setPendingRoundMutate = vi.fn();
const setBillRequestedMutate = vi.fn();
const invalidateTableState = vi.fn();
const invalidateReservations = vi.fn();
const invalidateInventoryMovements = vi.fn();
const invalidateInventoryStock = vi.fn();
const invalidateProducts = vi.fn();
const invalidateProductSearch = vi.fn();
const invalidateSerials = vi.fn();
const invalidateSerialLookup = vi.fn();

let lastVoiceOnApply:
  ((items: Array<{ selection: unknown; quantity: number; note: string | null }>) => void) | null =
  null;
let lastSearchOnSelect: ((selection: unknown) => void) | null = null;

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: vi.fn(),
  }),
}));

let mockAuthRole = 'cashier';
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Waiter Wendy',
      role: mockAuthRole,
      email: 'w@x.com',
      tenantId: 't-1',
    },
    logout: logoutMock,
  }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 't-1', name: 'Restaurante Sabor', slug: 'sabor' },
    currentSite: { id: 'site-1', name: 'Sucursal Centro', tenantId: 't-1' },
  }),
}));

vi.mock('@/features/modules/ModulesContext', () => ({
  useIsModuleActive: (id: string) => moduleActiveMock(id),
  useIsOptionalModuleActive: (id: string | null | undefined) => (id ? moduleActiveMock(id) : true),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: openCheckMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      settings: {
        get: {
          useQuery: () => restrictedSettingsUseQueryMock(),
        },
        voiceAvailability: {
          useQuery: (input: unknown, options: { enabled: boolean }) =>
            voiceAvailabilityUseQueryMock(input, options),
        },
      },
    },
    cashSessions: {
      getActive: { useQuery: () => ({ data: cashSessionMock(), isLoading: false }) },
    },
    restaurantTables: {
      list: {
        useQuery: (input: unknown, options: { enabled: boolean }) =>
          restaurantTablesUseQueryMock(input, options),
      },
    },
    restaurantServices: {
      getTableState: {
        useQuery: (input: unknown, options: { enabled: boolean }) =>
          restaurantTableStateUseQueryMock(input, options),
      },
      setBillRequested: {
        useMutation: () => ({ mutate: setBillRequestedMutate, isPending: false }),
      },
      setPendingRound: { useMutation: () => ({ mutate: setPendingRoundMutate }) },
    },
    restaurantModifiers: {
      productGroups: { useQuery: () => productGroupsMock() },
      list: {
        useQuery: () => ({
          data: { items: [], nextOffset: null },
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    products: {
      list: { useQuery: () => productsListMock() },
      categoryCounts: { useQuery: () => ({ data: { categories: [] } }) },
    },
    categories: { tree: { useQuery: () => ({ data: { items: [] } }) } },
    useUtils: () => ({
      sales: {
        list: { invalidate: invalidateSales },
        listDrafts: { invalidate: invalidateDrafts },
        summary: { invalidate: invalidateSalesSummary },
      },
      cashSessions: { getActive: { invalidate: invalidateCashSession } },
      restaurantTables: {
        listWithDraftStatus: { invalidate: invalidateTableStatus },
        listSummary: { invalidate: invalidateTableSummary },
      },
      restaurantServices: { getTableState: { invalidate: invalidateTableState } },
      restaurantModifiers: { productGroups: { prefetch: vi.fn() } },
      reservations: { list: { invalidate: invalidateReservations } },
      inventory: {
        listMovements: { invalidate: invalidateInventoryMovements },
        listStock: { invalidate: invalidateInventoryStock },
      },
      products: {
        list: { invalidate: invalidateProducts },
        search: { invalidate: invalidateProductSearch },
        getById: { fetch: getByIdFetch },
      },
      productSerials: {
        list: { invalidate: invalidateSerials },
        lookup: { invalidate: invalidateSerialLookup },
      },
    }),
  },
}));

vi.mock('../RestaurantSplitSheet', () => ({
  RestaurantSplitSheet: ({ tableId, tableName }: { tableId: string; tableName: string }) => (
    <div data-testid="split-sheet-stub">{`${tableId} · ${tableName}`}</div>
  ),
}));

vi.mock('@/features/voice/VoiceCartCommandModal', () => ({
  VoiceCartCommandModal: ({
    isOpen,
    onApply,
  }: {
    isOpen: boolean;
    onApply: (items: Array<{ selection: unknown; quantity: number; note: string | null }>) => void;
  }) => {
    if (!isOpen) return null;
    lastVoiceOnApply = onApply;
    return <div data-testid="voice-modal-stub" />;
  },
}));

vi.mock('@/components/dialogs/ProductSearchDialog', () => ({
  ProductSearchDialog: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean;
    onSelect: (selection: unknown) => void;
  }) => {
    if (!isOpen) return null;
    lastSearchOnSelect = onSelect;
    return <div data-testid="product-search-stub" />;
  },
}));

import { VoiceOrderingScreen } from '../VoiceOrderingScreen';

function makeSelection(overrides?: {
  productId?: string;
  productName?: string;
  unitId?: string;
  price?: number;
  sellByFraction?: boolean;
  fractionStep?: number | null;
  fractionMinimum?: number | null;
}) {
  const productId = overrides?.productId ?? 'p-coca';
  const productName = overrides?.productName ?? 'Coca Cola';
  const unitId = overrides?.unitId ?? 'u-unit';
  const price = overrides?.price ?? 5_000;
  return {
    product: {
      id: productId,
      tenantId: 't-1',
      name: productName,
      sku: `${productId}-sku`,
      price,
      price2: 0,
      price3: 0,
      cost: 0,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 0,
      stock: 100,
      minStock: 0,
      sellByFraction: overrides?.sellByFraction ?? false,
      fractionStep: overrides?.fractionStep ?? null,
      fractionMinimum: overrides?.fractionMinimum ?? null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
    unit: {
      id: '',
      unitId,
      unitName: 'Unidad',
      unitAbbreviation: 'UND',
      equivalence: 1,
      price,
      isBase: true,
    },
    price,
  };
}

function renderScreen(variant: 'touch' | 'mobile' = 'touch') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VoiceOrderingScreen variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function selectTable(name = 'Mesa 1'): void {
  fireEvent.change(screen.getByTestId('voice-ordering-table-select'), {
    target: { value: name },
  });
}

async function addVoiceItem(
  selection = makeSelection(),
  quantity = 1,
  note: string | null = null
): Promise<void> {
  fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
  await waitFor(() => expect(screen.getByTestId('voice-modal-stub')).toBeInTheDocument());
  await act(async () => {
    lastVoiceOnApply?.([{ selection, quantity, note }]);
  });
  await waitFor(() =>
    expect(screen.getAllByTestId('voice-ordering-cart-row').length).toBeGreaterThan(0)
  );
}

async function openSheetFromSearch(selection = makeSelection()): Promise<void> {
  fireEvent.click(screen.getByTestId('voice-ordering-manual-add'));
  await waitFor(() => expect(typeof lastSearchOnSelect).toBe('function'));
  await act(async () => lastSearchOnSelect?.(selection));
  await screen.findByTestId('plate-sheet');
}

async function editLine(index = 0): Promise<void> {
  fireEvent.click(screen.getAllByTestId('order-rail-edit-line')[index]!);
  await screen.findByTestId('plate-sheet');
}

function sheet() {
  return within(screen.getByTestId('plate-sheet'));
}

const GROUPS = [
  {
    id: 'g-term',
    siteId: 'site-1',
    name: 'Término',
    kind: 'choice',
    selection: 'single',
    minSelections: 1,
    maxSelections: 1,
    isActive: true,
    version: 3,
    options: [
      {
        position: 0,
        catalogId: 'o-medio',
        name: 'Medio',
        unitPriceDelta: 0,
        maxQuantity: 1,
        requiresManager: false,
        version: 1,
      },
      {
        position: 1,
        catalogId: 'o-34',
        name: 'Tres cuartos',
        unitPriceDelta: 0,
        maxQuantity: 1,
        requiresManager: false,
        version: 1,
      },
    ],
  },
  {
    id: 'g-sin',
    siteId: 'site-1',
    name: 'Sin',
    kind: 'without',
    selection: 'multiple',
    minSelections: 0,
    maxSelections: 2,
    isActive: true,
    version: 1,
    options: [
      {
        position: 0,
        catalogId: 'o-cebolla',
        name: 'Cebolla',
        unitPriceDelta: 0,
        maxQuantity: 1,
        requiresManager: false,
        version: 1,
      },
    ],
  },
  {
    id: 'g-extra',
    siteId: 'site-1',
    name: 'Adicionales',
    kind: 'extra',
    selection: 'multiple',
    minSelections: 0,
    maxSelections: 2,
    isActive: true,
    version: 2,
    options: [
      {
        position: 0,
        catalogId: 'o-queso',
        name: 'Queso',
        unitPriceDelta: 1500,
        maxQuantity: 1,
        requiresManager: false,
        version: 4,
      },
      {
        position: 1,
        catalogId: 'o-trufa',
        name: 'Trufa',
        unitPriceDelta: 9000,
        maxQuantity: 1,
        requiresManager: true,
        version: 1,
      },
    ],
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  moduleActiveMock.mockReturnValue(true);
  aiEnabledMock.mockReturnValue(true);
  cashSessionMock.mockReturnValue({
    id: 'cs-1',
    siteId: 'site-1',
    cashierId: 'user-1',
    registerName: 'Register A',
    openedAt: new Date().toISOString(),
  });
  restaurantTablesMock.mockReturnValue({
    data: {
      items: [
        { id: 'table-1', name: 'Mesa 1', seatCount: 4 },
        { id: 'table-2', name: 'Mesa 2', seatCount: 2 },
      ],
    },
    isLoading: false,
    error: null,
  });
  restaurantTableStateMock.mockReturnValue({
    data: { service: null, checks: [], diners: [] },
    isLoading: false,
    error: null,
  });
  productGroupsMock.mockReturnValue({
    data: [],
    isLoading: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  });
  openCheckMutateAsync.mockResolvedValue({ id: 'draft-1' });
  invalidateDrafts.mockResolvedValue(undefined);
  invalidateSales.mockResolvedValue(undefined);
  invalidateSalesSummary.mockResolvedValue(undefined);
  invalidateCashSession.mockResolvedValue(undefined);
  invalidateTableStatus.mockResolvedValue(undefined);
  invalidateTableState.mockResolvedValue(undefined);
  invalidateReservations.mockResolvedValue(undefined);
  invalidateInventoryMovements.mockResolvedValue(undefined);
  invalidateInventoryStock.mockResolvedValue(undefined);
  invalidateProducts.mockResolvedValue(undefined);
  invalidateProductSearch.mockResolvedValue(undefined);
  invalidateSerials.mockResolvedValue(undefined);
  invalidateSerialLookup.mockResolvedValue(undefined);
  lastVoiceOnApply = null;
  lastSearchOnSelect = null;
  await i18n.changeLanguage('es');
});

describe('VoiceOrderingScreen', () => {
  it('uses cashier-safe voice availability instead of restricted full AI settings', async () => {
    renderScreen();
    expect(voiceAvailabilityUseQueryMock).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(restrictedSettingsUseQueryMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('voice-ordering-mic-cta')).toBeEnabled();
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.getByTestId('voice-modal-stub')).toBeInTheDocument());
  });

  it('renders the focused surface without the main application chrome', () => {
    renderScreen();
    expect(screen.getByTestId('voice-ordering-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('opens the plate sheet from search and adds the plate to the unsent round', async () => {
    renderScreen();
    expect(screen.getByTestId('plate-sheet-empty')).toHaveTextContent('Elija un plato');
    await openSheetFromSearch();
    expect(screen.queryByTestId('voice-ordering-cart-row')).not.toBeInTheDocument();
    fireEvent.click(sheet().getByTestId('plate-sheet-submit'));
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(1);
    expect(screen.queryByTestId('plate-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-rail-draft-round')).toHaveTextContent('Ronda 1 · sin enviar');
  });

  it('opens the plate sheet from a dish tile with the hydrated base unit', async () => {
    const selection = makeSelection({
      productId: 'p-bandeja',
      productName: 'Bandeja',
      price: 38_000,
    });
    productsListMock.mockReturnValue({
      data: {
        items: [{ id: 'p-bandeja', name: 'Bandeja', price: 38_000, categoryId: 'c-1' }],
        totalPages: 1,
      },
      isLoading: false,
      error: null,
    });
    getByIdFetch.mockResolvedValue({
      ...selection.product,
      unitAssignments: [{ ...selection.unit, isBase: true }],
    });
    renderScreen();
    fireEvent.click(screen.getByTestId('dish-tile-p-bandeja'));
    await screen.findByTestId('plate-sheet');
    expect(getByIdFetch).toHaveBeenCalledWith({ id: 'p-bandeja', siteId: 'site-1' });
    expect(sheet().getByRole('heading', { name: 'Bandeja' })).toBeInTheDocument();
    expect(sheet().getByTestId('plate-sheet-price')).toHaveTextContent(money(38_000));
    expect(screen.getByTestId('dish-tile-p-bandeja')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps repeated products distinct for diner-specific kitchen details', async () => {
    renderScreen();
    selectTable();
    fireEvent.change(screen.getByTestId('voice-ordering-guest-count'), {
      target: { value: '2' },
    });
    await addVoiceItem(makeSelection({ productId: 'p-pan', productName: 'Pan' }), 1, 'sin sal');
    await act(async () => {
      lastVoiceOnApply?.([
        {
          selection: makeSelection({ productId: 'p-pan', productName: 'Pan' }),
          quantity: 2,
          note: 'con miel',
        },
      ]);
    });
    const rows = screen.getAllByTestId('voice-ordering-cart-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('sin sal');
    expect(rows[1]).toHaveTextContent('con miel');

    await editLine(1);
    fireEvent.click(sheet().getByTestId('plate-sheet-seat-2'));
    fireEvent.click(sheet().getByTestId('plate-sheet-submit'));
    expect(screen.getAllByTestId('voice-ordering-cart-row')[1]).toHaveTextContent('C2');
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            productId: 'p-pan',
            quantity: 1,
            notes: 'sin sal',
            dinerClientId: 'seat-1',
          }),
          expect.objectContaining({
            productId: 'p-pan',
            quantity: 2,
            notes: 'con miel',
            dinerClientId: 'seat-2',
          }),
        ],
      })
    );
  });

  it('keeps fractional quantity steps aligned without floating-point drift', async () => {
    renderScreen();
    await addVoiceItem(
      makeSelection({
        productId: 'p-weighted',
        productName: 'Producto por peso',
        sellByFraction: true,
        fractionStep: 0.1,
        fractionMinimum: 0.1,
      }),
      0.1
    );
    await editLine();
    const increment = sheet().getByTestId('voice-ordering-qty-increment');
    fireEvent.click(increment);
    fireEvent.click(increment);
    expect(sheet().getByTestId('voice-ordering-qty')).toHaveTextContent(/^0\.3$/);
    fireEvent.click(sheet().getByTestId('voice-ordering-qty-decrement'));
    expect(sheet().getByTestId('voice-ordering-qty')).toHaveTextContent(/^0\.2$/);
    fireEvent.click(sheet().getByTestId('plate-sheet-submit'));
    expect(screen.getByTestId('voice-ordering-cart-row')).toHaveTextContent(/^0\.2/);
  });

  it.each([
    [
      'semantic-search module',
      () => moduleActiveMock.mockImplementation(id => id !== 'semantic-search'),
    ],
    ['tenant AI setting', () => aiEnabledMock.mockReturnValue(false)],
    ['active cash session', () => cashSessionMock.mockReturnValue(null)],
  ])('disables voice capture without the %s', (_label, arrange) => {
    arrange();
    renderScreen();
    expect(screen.getByTestId('voice-ordering-mic-cta')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-mic-disabled-hint')).toBeInTheDocument();
  });

  it('fails closed with setup guidance when no authoritative table exists', async () => {
    restaurantTablesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    renderScreen();
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-table-setup-hint')).toHaveTextContent(
      /Cree al menos una mesa activa/
    );
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
    expect(openCheckMutateAsync).not.toHaveBeenCalled();
  });

  it('offers table creation in the empty state only to those who can create them', () => {
    restaurantTablesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    const cashier = renderScreen('mobile');
    expect(screen.queryByTestId('voice-ordering-create-tables')).not.toBeInTheDocument();
    cashier.unmount();

    mockAuthRole = 'admin';
    renderScreen('mobile');
    expect(screen.getByTestId('voice-ordering-create-tables')).toHaveAttribute(
      'href',
      '/restaurants/tables'
    );
    mockAuthRole = 'cashier';
  });

  it('lets the waiter pick a table from a grid while the till keeps the dropdown', () => {
    const phone = renderScreen('mobile');
    expect(screen.queryByTestId('voice-ordering-table-select')).not.toBeInTheDocument();
    const option = within(screen.getByTestId('voice-ordering-table-grid')).getByRole('button', {
      name: 'Mesa 1',
    });
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-pressed', 'true');
    phone.unmount();

    renderScreen('touch');
    expect(screen.getByTestId('voice-ordering-table-select')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-ordering-table-grid')).not.toBeInTheDocument();
  });

  it('opens the sheet in a dialog on phones and keeps the send action in reach', async () => {
    renderScreen('mobile');
    expect(screen.queryByTestId('plate-sheet-empty')).not.toBeInTheDocument();
    await openSheetFromSearch(makeSelection({ productName: 'Limonada' }));
    expect(screen.getByRole('dialog', { name: 'Limonada' })).toContainElement(
      screen.getByTestId('plate-sheet')
    );
    fireEvent.click(sheet().getByTestId('plate-sheet-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('voice-ordering-save').closest('footer')).toHaveClass('sticky');
  });

  it('fails closed when the table catalog cannot be loaded', () => {
    restaurantTablesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('db'),
    });
    renderScreen();
    expect(screen.getByTestId('voice-ordering-table-setup-hint')).toHaveTextContent(
      /No se pudieron cargar las mesas/
    );
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
  });

  it('sends one atomic round with diner, course, grouped options and kitchen note', async () => {
    productGroupsMock.mockReturnValue({
      data: GROUPS,
      isLoading: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
    });
    renderScreen();
    selectTable();
    fireEvent.change(screen.getByTestId('voice-ordering-guest-count'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-check-label'), {
      target: { value: 'Familia López' },
    });
    await openSheetFromSearch(makeSelection({ productId: 'p-burg', productName: 'Hamburguesa' }));
    expect(sheet().getByRole('heading', { name: 'Término · Elija uno' })).toBeInTheDocument();

    fireEvent.click(sheet().getByTestId('plate-sheet-submit'));
    expect(sheet().getByRole('alert')).toHaveTextContent('Falta elegir: Término');
    expect(screen.queryByTestId('voice-ordering-cart-row')).not.toBeInTheDocument();

    fireEvent.click(sheet().getByTestId('plate-sheet-option-o-medio'));
    fireEvent.click(sheet().getByTestId('plate-sheet-option-o-34'));
    expect(sheet().getByTestId('plate-sheet-option-o-medio')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(sheet().getByTestId('plate-sheet-option-o-cebolla'));
    fireEvent.click(sheet().getByTestId('plate-sheet-option-o-queso'));
    expect(sheet().getByTestId('plate-sheet-option-o-trufa')).toBeDisabled();
    expect(sheet().getByTestId('plate-sheet-price')).toHaveTextContent(money(6_500));
    fireEvent.click(sheet().getByTestId('plate-sheet-seat-2'));
    fireEvent.click(sheet().getByTestId('plate-sheet-course-starter'));
    fireEvent.click(sheet().getByTestId('plate-sheet-note-toggle'));
    fireEvent.change(sheet().getByTestId('plate-sheet-note'), {
      target: { value: ' bien caliente ' },
    });
    fireEvent.click(sheet().getByTestId('voice-ordering-qty-increment'));
    fireEvent.click(sheet().getByTestId('plate-sheet-submit'));

    const row = screen.getByTestId('voice-ordering-cart-row');
    expect(row).toHaveTextContent('Tres cuartos · sin Cebolla · + Queso · bien caliente');
    expect(row).toHaveTextContent(money(13_000));
    expect(screen.getByTestId('order-rail-total')).toHaveTextContent(money(13_000));
    expect(screen.getByTestId('voice-ordering-save')).toHaveTextContent('Enviar ronda 1 a cocina');
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith({
      tableId: 'table-1',
      guestCount: 2,
      checkLabel: 'Familia López',
      diners: [
        { clientId: 'seat-1', seatNumber: 1 },
        { clientId: 'seat-2', seatNumber: 2 },
      ],
      items: [
        expect.objectContaining({
          productId: 'p-burg',
          quantity: 2,
          unitPrice: 5_000,
          notes: 'bien caliente',
          dinerClientId: 'seat-2',
          courseKey: 'starter',
          modifierGroups: [
            { id: 'g-term', version: 3 },
            { id: 'g-sin', version: 1 },
            { id: 'g-extra', version: 2 },
          ],
          modifiers: [
            {
              catalogId: 'o-34',
              catalogVersion: 1,
              groupId: 'g-term',
              name: 'Tres cuartos',
              quantity: 1,
              unitPriceDelta: 0,
            },
            {
              catalogId: 'o-cebolla',
              catalogVersion: 1,
              groupId: 'g-sin',
              name: 'Cebolla',
              quantity: 1,
              unitPriceDelta: 0,
            },
            {
              catalogId: 'o-queso',
              catalogVersion: 4,
              groupId: 'g-extra',
              name: 'Queso',
              quantity: 1,
              unitPriceDelta: 1_500,
            },
          ],
        }),
      ],
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith({ title: 'Ronda 1 enviada a cocina · Mesa 1' })
    );
    expect(invalidateSales).toHaveBeenCalled();
    expect(invalidateDrafts).toHaveBeenCalled();
    expect(invalidateSalesSummary).toHaveBeenCalled();
    expect(invalidateTableStatus).toHaveBeenCalled();
    expect(invalidateTableState).toHaveBeenCalledWith();
    expect(invalidateReservations).toHaveBeenCalledWith();
    expect(invalidateInventoryMovements).toHaveBeenCalled();
    expect(invalidateInventoryStock).toHaveBeenCalled();
    expect(invalidateProducts).toHaveBeenCalled();
    expect(invalidateProductSearch).toHaveBeenCalled();
    expect(invalidateSerials).toHaveBeenCalled();
    expect(invalidateSerialLookup).toHaveBeenCalled();
    expect(screen.queryByTestId('voice-ordering-cart-row')).not.toBeInTheDocument();
    // The table stays picked so the rail can show the round as sent.
    expect(screen.getByTestId('voice-ordering-table-select')).toHaveValue('Mesa 1');
  });

  it('shares a plate with the table and lets managers price a custom add-on', async () => {
    mockAuthRole = 'manager';
    try {
      renderScreen();
      selectTable();
      await openSheetFromSearch();
      fireEvent.click(sheet().getByTestId('plate-sheet-seat-shared'));
      fireEvent.click(sheet().getByTestId('plate-sheet-more-extras'));
      fireEvent.change(await screen.findByTestId('modifier-picker-custom-name'), {
        target: { value: 'Velas' },
      });
      fireEvent.change(screen.getByTestId('modifier-picker-custom-price'), {
        target: { value: '2000' },
      });
      fireEvent.click(screen.getByTestId('modifier-picker-custom-add'));
      await waitFor(() =>
        expect(sheet().getByRole('button', { name: 'Quitar Velas' })).toBeInTheDocument()
      );
      fireEvent.click(sheet().getByTestId('plate-sheet-submit'));
      expect(screen.getByTestId('voice-ordering-cart-row')).toHaveTextContent('mesa');
      fireEvent.click(screen.getByTestId('voice-ordering-save'));
      await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
      expect(openCheckMutateAsync.mock.calls[0]![0].items[0]).toMatchObject({
        dinerClientId: null,
        modifiers: [{ name: 'Velas', quantity: 1, unitPriceDelta: 2_000 }],
      });
      expect(openCheckMutateAsync.mock.calls[0]![0].items[0]).not.toHaveProperty('modifierGroups');
    } finally {
      mockAuthRole = 'cashier';
    }
  });

  it('keeps a plate out while its options cannot load', async () => {
    productGroupsMock.mockReturnValue({
      data: undefined as unknown as unknown[],
      isLoading: false,
      isSuccess: false,
      error: new Error('offline'),
      refetch: vi.fn(),
    });
    renderScreen();
    await openSheetFromSearch();
    expect(sheet().getByRole('alert')).toBeInTheDocument();
    expect(sheet().getByTestId('plate-sheet-submit')).toBeDisabled();
  });

  async function addCustom(name: string, price: string): Promise<void> {
    fireEvent.click(sheet().getByTestId('plate-sheet-more-extras'));
    fireEvent.change(await screen.findByTestId('modifier-picker-custom-name'), {
      target: { value: name },
    });
    fireEvent.change(screen.getByTestId('modifier-picker-custom-price'), {
      target: { value: price },
    });
  }

  it('keeps the dish options in their groups and custom add-ons apart', async () => {
    mockAuthRole = 'manager';
    productGroupsMock.mockReturnValue({
      data: GROUPS,
      isLoading: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
    });
    try {
      renderScreen();
      await openSheetFromSearch();
      // A dish option is picked from its group, where the group rule applies.
      await addCustom('queso', '100');
      expect(screen.getByTestId('modifier-picker-custom-add')).toBeDisabled();
      fireEvent.change(screen.getByTestId('modifier-picker-custom-name'), {
        target: { value: 'Velas' },
      });
      fireEvent.click(screen.getByTestId('modifier-picker-custom-add'));
      await waitFor(() =>
        expect(sheet().getByRole('button', { name: 'Quitar Velas' })).toBeInTheDocument()
      );
      fireEvent.click(sheet().getByTestId('plate-sheet-option-o-medio'));
      fireEvent.click(sheet().getByTestId('plate-sheet-submit'));

      // A second sheet for the same line must not reuse the first add-on's id.
      await editLine();
      await addCustom('Flores', '500');
      fireEvent.click(screen.getByTestId('modifier-picker-custom-add'));
      fireEvent.click(await sheet().findByRole('button', { name: 'Quitar Flores' }));
      expect(sheet().getByRole('button', { name: 'Quitar Velas' })).toBeInTheDocument();
      expect(sheet().queryByRole('button', { name: 'Quitar Flores' })).not.toBeInTheDocument();
    } finally {
      mockAuthRole = 'cashier';
    }
  });

  it('keeps the custom add-on form away from cashiers', async () => {
    renderScreen();
    await openSheetFromSearch();
    fireEvent.click(sheet().getByTestId('plate-sheet-more-extras'));
    await screen.findByRole('dialog', { name: 'Elegir adicional aprobado' });
    expect(screen.queryByTestId('modifier-picker-custom-name')).not.toBeInTheDocument();
  });

  it('lists sent rounds from the table state and numbers the next one', () => {
    restaurantTableStateMock.mockReturnValue({
      data: {
        service: { id: 'service-1', guestCount: 3 },
        diners: [
          { id: 'd-1', seatNumber: 1 },
          { id: 'd-2', seatNumber: 2 },
          { id: 'd-3', seatNumber: 3 },
        ],
        checks: [
          {
            id: 'c-2',
            label: null,
            openedAt: '2026-11-21T20:30:00.000Z',
            total: 20_000,
            rounds: [{ id: 'r-2', submittedAt: '2026-11-21T20:30:00.000Z', createdAt: '' }],
            lines: [
              {
                id: 'l-2',
                roundId: 'r-2',
                dinerId: 'd-2',
                quantity: 1,
                productName: 'Bandeja',
                total: 20_000,
                notes: 'sin sal',
                modifiers: [{ name: 'Tres cuartos', quantity: 1, groupKind: 'choice' }],
              },
            ],
          },
          {
            id: 'c-1',
            label: 'Familia',
            openedAt: '2026-11-21T19:00:00.000Z',
            total: 10_000,
            rounds: [{ id: 'r-1', submittedAt: '2026-11-21T19:00:00.000Z', createdAt: '' }],
            lines: [
              {
                id: 'l-1',
                roundId: 'r-1',
                dinerId: null,
                quantity: 4,
                productName: 'Empanadas',
                total: 10_000,
                notes: null,
                modifiers: [],
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderScreen();
    selectTable();
    expect(screen.getByTestId('voice-ordering-guest-count')).toHaveValue(3);
    expect(screen.getByTestId('voice-ordering-guest-count')).toBeDisabled();
    const rounds = screen.getAllByTestId('order-rail-sent-round');
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toHaveTextContent(/Ronda 1 · enviada .*Familia/);
    expect(rounds[0]).toHaveTextContent('Empanadas');
    expect(rounds[0]).toHaveTextContent('mesa');
    expect(rounds[1]).toHaveTextContent('Ronda 2');
    expect(rounds[1]).toHaveTextContent('C2');
    expect(rounds[1]).toHaveTextContent('Tres cuartos · sin sal');
    expect(screen.getByTestId('order-rail-draft-round')).toHaveTextContent('Ronda 3 · sin enviar');
    expect(screen.getByTestId('voice-ordering-save')).toHaveTextContent('Enviar ronda 3 a cocina');
    expect(screen.getByTestId('order-rail-total')).toHaveTextContent(money(30_000));
  });

  it('shows a round once when a split copied it into several checks', () => {
    const line = (id: string, dinerId: string, total: number) => ({
      id,
      roundId: `r-${id}`,
      dinerId,
      quantity: 1,
      productName: `Plato ${id}`,
      total,
      notes: null,
      modifiers: [],
    });
    const check = (id: string, lines: ReturnType<typeof line>[]) => ({
      id,
      label: null,
      openedAt: '2026-11-21T19:00:00.000Z',
      total: lines.reduce((sum, row) => sum + row.total, 0),
      rounds: lines.map(row => ({
        id: row.roundId,
        submittedAt: '2026-11-21T19:00:00.000Z',
        createdAt: '',
      })),
      lines,
    });
    restaurantTableStateMock.mockReturnValue({
      data: {
        service: { id: 'service-1', guestCount: 2 },
        diners: [
          { id: 'd-1', seatNumber: 1 },
          { id: 'd-2', seatNumber: 2 },
        ],
        checks: [check('c-1', [line('a', 'd-1', 5_000)]), check('c-2', [line('b', 'd-2', 7_000)])],
      },
      isLoading: false,
      error: null,
    });
    renderScreen();
    selectTable();
    const rounds = screen.getAllByTestId('order-rail-sent-round');
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toHaveTextContent('Plato a');
    expect(rounds[0]).toHaveTextContent('Plato b');
    expect(screen.getByTestId('order-rail-draft-round')).toHaveTextContent('Ronda 2 · sin enviar');
  });

  it('offers Dividir cuenta to managers once the table has two sent plates', async () => {
    restaurantTableStateMock.mockReturnValue({
      data: {
        service: { id: 'service-1', guestCount: 2, billRequestedAt: null },
        diners: [{ id: 'd-1', seatNumber: 1 }],
        checks: [
          {
            id: 'c-1',
            label: null,
            openedAt: '2026-11-21T19:00:00.000Z',
            total: 12_000,
            rounds: [{ id: 'r-1', submittedAt: '2026-11-21T19:00:00.000Z', createdAt: '' }],
            lines: ['a', 'b'].map(id => ({
              id,
              roundId: 'r-1',
              dinerId: 'd-1',
              quantity: 1,
              productName: `Plato ${id}`,
              total: 6_000,
              notes: null,
              modifiers: [],
            })),
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    const view = renderScreen();
    selectTable();
    // Regrouping checks is a manager override; a cashier never sees it.
    expect(screen.queryByTestId('voice-ordering-split')).not.toBeInTheDocument();
    view.unmount();

    mockAuthRole = 'manager';
    try {
      renderScreen();
      selectTable();
      fireEvent.click(screen.getByTestId('voice-ordering-split'));
      expect(await screen.findByTestId('split-sheet-stub')).toHaveTextContent('table-1 · Mesa 1');
    } finally {
      mockAuthRole = 'cashier';
    }
  });

  it('lets staff mark that an open table asked for the bill', () => {
    restaurantTableStateMock.mockReturnValue({
      data: {
        service: { id: 'service-1', guestCount: 2, billRequestedAt: null },
        diners: [],
        checks: [],
      },
      isLoading: false,
      error: null,
    });
    renderScreen();
    expect(screen.queryByTestId('restaurant-bill-request-toggle')).not.toBeInTheDocument();
    selectTable();
    const toggle = screen.getByTestId('restaurant-bill-request-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('Pidió la cuenta');
    fireEvent.click(toggle);
    expect(setBillRequestedMutate).toHaveBeenCalledWith({ tableId: 'table-1', requested: true });
  });

  it('reports the unsent round of an open table and clears it on leaving', async () => {
    restaurantTableStateMock.mockReturnValue({
      data: { service: { id: 'service-1', guestCount: 2 }, diners: [], checks: [] },
      isLoading: false,
      error: null,
    });
    const { unmount } = renderScreen();
    selectTable();
    await waitFor(() =>
      expect(setPendingRoundMutate).toHaveBeenCalledWith({ tableId: 'table-1', itemCount: 0 })
    );
    await addVoiceItem();
    await waitFor(() =>
      expect(setPendingRoundMutate).toHaveBeenLastCalledWith({ tableId: 'table-1', itemCount: 1 })
    );
    unmount();
    expect(setPendingRoundMutate).toHaveBeenLastCalledWith({ tableId: 'table-1', itemCount: 0 });
  });

  it('keeps refreshing an unsent round so the floor map does not expire it', async () => {
    restaurantTableStateMock.mockReturnValue({
      data: { service: { id: 'service-1', guestCount: 2 }, diners: [], checks: [] },
      isLoading: false,
      error: null,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen();
      selectTable();
      await addVoiceItem();
      await waitFor(() =>
        expect(setPendingRoundMutate).toHaveBeenLastCalledWith({ tableId: 'table-1', itemCount: 1 })
      );
      const before = setPendingRoundMutate.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      expect(setPendingRoundMutate.mock.calls.length).toBe(before + 1);
      expect(setPendingRoundMutate).toHaveBeenLastCalledWith({ tableId: 'table-1', itemCount: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('says it saves the round when no kitchen screen is on', async () => {
    moduleActiveMock.mockImplementation(id => id !== 'kds');
    renderScreen();
    selectTable();
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-save')).toHaveTextContent('Guardar ronda 1');
    fireEvent.click(screen.getByTestId('voice-ordering-save'));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith({ title: 'Ronda 1 guardada · Mesa 1' })
    );
  });

  it('preserves the round when the atomic command fails', async () => {
    openCheckMutateAsync.mockRejectedValue(new Error('boom'));
    renderScreen();
    selectTable();
    await addVoiceItem();
    fireEvent.click(screen.getByTestId('voice-ordering-save'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No se pudo enviar la ronda' })
    );
    expect(screen.getByTestId('voice-ordering-cart-row')).toBeInTheDocument();
  });

  it('clears a committed round and warns when projection refresh fails', async () => {
    invalidateTableState.mockRejectedValueOnce(new Error('cache refresh failed'));
    renderScreen();
    selectTable();
    await addVoiceItem();
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        description: i18n.t('common:toast.committedRefreshWarning'),
      })
    );
    expect(screen.queryByTestId('voice-ordering-cart-row')).not.toBeInTheDocument();
  });

  it('suppresses a second send while the first atomic command is pending', async () => {
    let resolveOpen!: (value: { id: string }) => void;
    openCheckMutateAsync.mockReturnValue(
      new Promise(resolve => {
        resolveOpen = resolve;
      })
    );
    renderScreen();
    selectTable();
    await addVoiceItem();
    const save = screen.getByTestId('voice-ordering-save');
    fireEvent.click(save);
    fireEvent.click(save);
    expect(openCheckMutateAsync).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-screen')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('voice-ordering-table-select')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-guest-count')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-check-label')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-mic-cta')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-manual-add')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-remove-row')).toBeDisabled();
    expect(screen.getByTestId('order-rail-edit-line')).toBeDisabled();
    await act(async () => resolveOpen({ id: 'draft-1' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it('blocks send while the selected table state is loading', async () => {
    restaurantTableStateMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderScreen();
    selectTable();
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-table-state-loading')).toBeInTheDocument();
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
  });

  it('blocks send and explains a table-state read failure', async () => {
    restaurantTableStateMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('busy'),
    });
    renderScreen();
    selectTable();
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-table-state-error')).toHaveTextContent(
      /No se pudo verificar el estado de la mesa/
    );
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
  });

  it('uses capacity as a ceiling without inventing a capacity-sized party', () => {
    renderScreen();
    selectTable('Mesa 1');
    expect(screen.getByTestId('voice-ordering-guest-count')).toHaveValue(1);
    fireEvent.change(screen.getByTestId('voice-ordering-guest-count'), {
      target: { value: '4' },
    });
    selectTable('Mesa 2');
    expect(screen.getByTestId('voice-ordering-guest-count')).toHaveValue(2);
  });

  it('normalizes guest counts to whole diners and the selected table capacity', async () => {
    renderScreen();
    selectTable('Mesa 1');
    const guestInput = screen.getByTestId('voice-ordering-guest-count');
    expect(guestInput).toHaveAttribute('max', '4');
    expect(guestInput).toHaveAttribute('step', '1');

    fireEvent.change(guestInput, { target: { value: '3.9' } });
    expect(guestInput).toHaveValue(3);
    fireEvent.change(guestInput, { target: { value: '99' } });
    expect(guestInput).toHaveValue(4);
    await addVoiceItem();
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        guestCount: 4,
        diners: [
          { clientId: 'seat-1', seatNumber: 1 },
          { clientId: 'seat-2', seatNumber: 2 },
          { clientId: 'seat-3', seatNumber: 3 },
          { clientId: 'seat-4', seatNumber: 4 },
        ],
      })
    );
  });

  it('does not query the restaurant catalog when dine-in is disabled', () => {
    moduleActiveMock.mockImplementation(id => id !== 'dine-in');
    renderScreen('mobile');
    expect(restaurantTablesUseQueryMock).toHaveBeenCalledWith(
      { siteId: 'site-1', includeArchived: false },
      { enabled: false }
    );
    expect(screen.getByTestId('voice-ordering-table-setup-hint')).toHaveTextContent(
      /servicio en salón está desactivado/i
    );
    expect(screen.queryByTestId('dish-catalog')).not.toBeInTheDocument();
  });

  it('localizes accessibility metadata and keeps mobile layout parity', () => {
    renderScreen('mobile');
    expect(screen.getByTestId('voice-ordering-screen')).toHaveAttribute('data-variant', 'mobile');
    expect(screen.getByTestId('voice-ordering-mic-cta')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Orden por voz|Voice order/)
    );
    expect(screen.getByTestId('voice-ordering-table-grid')).toHaveAccessibleName(/Mesa|Table/);
    expect(screen.getByTestId('order-rail')).toHaveAccessibleName('Pedido de la mesa');
  });

  it('marks the till table dropdown as required', () => {
    renderScreen('touch');
    expect(screen.getByTestId('voice-ordering-table-select')).toHaveAttribute(
      'aria-required',
      'true'
    );
  });

  it('mirrors the server limit on kitchen notes', async () => {
    renderScreen('mobile');
    await openSheetFromSearch();
    fireEvent.click(sheet().getByTestId('plate-sheet-note-toggle'));
    expect(sheet().getByTestId('plate-sheet-note')).toHaveAttribute('maxLength', '280');
    expect(sheet().getByTestId('plate-sheet-note-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});
