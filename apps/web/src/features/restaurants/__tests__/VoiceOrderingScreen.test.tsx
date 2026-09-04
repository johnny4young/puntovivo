/**
 * Regression coverage for the shared restaurant ordering surface.
 *
 * The suite keeps transport mocks at the tRPC boundary and exercises the
 * operator-visible state machine: catalog gating, session/AI permissions,
 * service-state loading, structured line metadata and atomic check opening.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { formatCurrency } from '@/lib/utils';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const logoutMock = vi.fn();

const moduleActiveMock = vi.fn((_id: string) => true);
const aiEnabledMock = vi.fn(() => true);
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
        service: { id: string; guestCount: number } | null;
        checks: Array<{ id: string; label: string | null; saleNumber: string; total: number }>;
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
const openCheckMutateAsync = vi.fn();
const invalidateSales = vi.fn();
const invalidateDrafts = vi.fn();
const invalidateSalesSummary = vi.fn();
const invalidateCashSession = vi.fn();
const invalidateTableStatus = vi.fn();
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

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Waiter Wendy',
      role: 'cashier',
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
          useQuery: () => ({
            data: { enabled: aiEnabledMock(), monthlyBudgetUsd: 100 },
            isLoading: false,
          }),
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
    },
    useUtils: () => ({
      sales: {
        list: { invalidate: invalidateSales },
        listDrafts: { invalidate: invalidateDrafts },
        summary: { invalidate: invalidateSalesSummary },
      },
      cashSessions: { getActive: { invalidate: invalidateCashSession } },
      restaurantTables: { listWithDraftStatus: { invalidate: invalidateTableStatus } },
      restaurantServices: { getTableState: { invalidate: invalidateTableState } },
      reservations: { list: { invalidate: invalidateReservations } },
      inventory: {
        listMovements: { invalidate: invalidateInventoryMovements },
        listStock: { invalidate: invalidateInventoryStock },
      },
      products: {
        list: { invalidate: invalidateProducts },
        search: { invalidate: invalidateProductSearch },
      },
      productSerials: {
        list: { invalidate: invalidateSerials },
        lookup: { invalidate: invalidateSerialLookup },
      },
    }),
  },
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
}

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
  it('renders the focused surface without the main application chrome', () => {
    renderScreen();
    expect(screen.getByTestId('voice-ordering-screen')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  it('adds products through manual search without requiring voice', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('voice-ordering-manual-add'));
    await waitFor(() => expect(typeof lastSearchOnSelect).toBe('function'));
    await act(async () => lastSearchOnSelect?.(makeSelection()));
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(1);
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
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(2);
    expect(screen.getAllByTestId('voice-ordering-qty')[0]).toHaveTextContent('1');
    expect(screen.getAllByTestId('voice-ordering-qty')[1]).toHaveTextContent('2');
    expect(screen.getAllByTestId('voice-ordering-note-input')[0]).toHaveValue('sin sal');
    expect(screen.getAllByTestId('voice-ordering-note-input')[1]).toHaveValue('con miel');

    fireEvent.change(screen.getAllByTestId('voice-ordering-seat-select')[1]!, {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            productId: 'p-pan',
            notes: 'sin sal',
            dinerClientId: 'seat-1',
          }),
          expect.objectContaining({
            productId: 'p-pan',
            notes: 'con miel',
            dinerClientId: 'seat-2',
          }),
        ],
      })
    );
  });

  it('keeps fractional quantity controls aligned without floating-point drift', async () => {
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

    const increment = screen.getByTestId('voice-ordering-qty-increment');
    fireEvent.click(increment);
    fireEvent.click(increment);
    expect(screen.getByTestId('voice-ordering-qty')).toHaveTextContent(/^0\.3$/);

    fireEvent.click(screen.getByTestId('voice-ordering-qty-decrement'));
    expect(screen.getByTestId('voice-ordering-qty')).toHaveTextContent(/^0\.2$/);
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
    expect(screen.queryByTestId('voice-ordering-table-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('voice-ordering-table-setup-hint')).toHaveTextContent(
      /Crea al menos una mesa activa/
    );
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
    expect(openCheckMutateAsync).not.toHaveBeenCalled();
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

  it('opens one atomic check with diners, course, modifier and kitchen note', async () => {
    renderScreen();
    selectTable();
    fireEvent.change(screen.getByTestId('voice-ordering-guest-count'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-check-label'), {
      target: { value: 'Familia López' },
    });
    await addVoiceItem(
      makeSelection({ productId: 'p-burg', productName: 'Hamburguesa' }),
      2,
      'sin cebolla'
    );
    fireEvent.change(screen.getByTestId('voice-ordering-course-select'), {
      target: { value: 'starter' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-seat-select'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-name'), {
      target: { value: 'Queso extra' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-price'), {
      target: { value: '1500' },
    });
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
          notes: 'sin cebolla',
          dinerClientId: 'seat-2',
          courseKey: 'starter',
          modifiers: [{ name: 'Queso extra', quantity: 1, unitPriceDelta: 1_500 }],
        }),
      ],
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
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
  });

  it('normalizes an emptied modifier price before sending the command', async () => {
    renderScreen();
    selectTable();
    await addVoiceItem(makeSelection({ productId: 'p-soup', productName: 'Sopa' }));
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-name'), {
      target: { value: 'Pan adicional' },
    });
    const modifierPrice = screen.getByTestId('voice-ordering-modifier-price');
    fireEvent.change(modifierPrice, { target: { value: '1200' } });
    fireEvent.change(modifierPrice, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            modifiers: [{ name: 'Pan adicional', quantity: 1, unitPriceDelta: 0 }],
          }),
        ],
      })
    );
  });

  it('uses the server money rule for sub-cent modifier previews and snapshots', async () => {
    renderScreen();
    selectTable();
    await addVoiceItem(makeSelection({ productId: 'p-soup', productName: 'Sopa' }), 2);
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-name'), {
      target: { value: 'Pan adicional' },
    });
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-price'), {
      target: { value: '0.005' },
    });

    const expectedTotal = formatCurrency(10_000.02).replaceAll('\u00a0', ' ');
    expect(screen.getByText(i18n.t('restaurants:cart.total')).parentElement).toHaveTextContent(
      expectedTotal
    );

    fireEvent.click(screen.getByTestId('voice-ordering-save'));
    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            quantity: 2,
            modifiers: [{ name: 'Pan adicional', quantity: 1, unitPriceDelta: 0.01 }],
          }),
        ],
      })
    );
  });

  it('removes a stale modifier delta from preview and payload when its name is erased', async () => {
    renderScreen();
    selectTable();
    await addVoiceItem(makeSelection({ productId: 'p-soup', productName: 'Sopa' }));
    const modifierName = screen.getByTestId('voice-ordering-modifier-name');
    const modifierPrice = screen.getByTestId('voice-ordering-modifier-price');

    fireEvent.change(modifierName, { target: { value: 'Pan adicional' } });
    fireEvent.change(modifierPrice, { target: { value: '1200' } });
    expect(screen.getByText(i18n.t('restaurants:cart.total')).parentElement).toHaveTextContent(
      formatCurrency(6_200).replaceAll('\u00a0', ' ')
    );

    fireEvent.change(modifierName, { target: { value: '   ' } });
    expect(modifierPrice).toBeDisabled();
    expect(screen.getByText(i18n.t('restaurants:cart.total')).parentElement).toHaveTextContent(
      formatCurrency(5_000).replaceAll('\u00a0', ' ')
    );
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(openCheckMutateAsync).toHaveBeenCalledTimes(1));
    expect(openCheckMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ unitPrice: 5_000, modifiers: [] })],
      })
    );
  });

  it('preserves the cart when the atomic command fails', async () => {
    openCheckMutateAsync.mockRejectedValue(new Error('boom'));
    renderScreen();
    selectTable();
    await addVoiceItem();
    fireEvent.click(screen.getByTestId('voice-ordering-save'));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('voice-ordering-cart-row')).toBeInTheDocument();
  });

  it('clears a committed order and warns when projection refresh fails', async () => {
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

  it('suppresses a second save while the first atomic command is pending', async () => {
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
    expect(screen.getByTestId('voice-ordering-qty-increment')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-remove-row')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-note-input')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-course-select')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-seat-select')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-modifier-name')).toBeDisabled();
    await act(async () => resolveOpen({ id: 'draft-1' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it('blocks save while the selected table state is loading', async () => {
    restaurantTableStateMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderScreen();
    selectTable();
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-table-state-loading')).toBeInTheDocument();
    expect(screen.getByTestId('voice-ordering-save')).toBeDisabled();
  });

  it('blocks save and explains a table-state read failure', async () => {
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

  it('locks the established guest count and renders every open check', () => {
    restaurantTableStateMock.mockReturnValue({
      data: {
        service: { id: 'service-1', guestCount: 3 },
        diners: [
          { id: 'd-1', seatNumber: 1 },
          { id: 'd-2', seatNumber: 2 },
          { id: 'd-3', seatNumber: 3 },
        ],
        checks: [
          { id: 'c-1', label: 'Familia', saleNumber: 'VTA-1', total: 10_000 },
          { id: 'c-2', label: null, saleNumber: 'VTA-2', total: 20_000 },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderScreen();
    selectTable();
    expect(screen.getByTestId('voice-ordering-guest-count')).toHaveValue(3);
    expect(screen.getByTestId('voice-ordering-guest-count')).toBeDisabled();
    expect(screen.getByTestId('voice-ordering-open-checks')).toHaveTextContent('Familia');
    expect(screen.getByTestId('voice-ordering-open-checks')).toHaveTextContent('VTA-2');
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
  });

  it('localizes accessibility metadata and keeps mobile layout parity', () => {
    renderScreen('mobile');
    expect(screen.getByTestId('voice-ordering-screen')).toHaveAttribute('data-variant', 'mobile');
    expect(screen.getByTestId('voice-ordering-mic-cta')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Orden por voz|Voice order/)
    );
    expect(screen.getByTestId('voice-ordering-table-select')).toHaveAttribute(
      'aria-required',
      'true'
    );
  });

  it('mirrors the server limits on preparation notes and modifier prices', async () => {
    renderScreen('mobile');
    await addVoiceItem();
    expect(screen.getByTestId('voice-ordering-note-input')).toHaveAttribute('maxLength', '280');
    const modifierPrice = screen.getByTestId('voice-ordering-modifier-price');
    expect(modifierPrice).toHaveAttribute('max', '1000000000');
    fireEvent.change(screen.getByTestId('voice-ordering-modifier-name'), {
      target: { value: 'Edición limitada' },
    });
    fireEvent.change(modifierPrice, { target: { value: '1000000001' } });
    expect(modifierPrice).toHaveValue(1000000000);
  });
});
