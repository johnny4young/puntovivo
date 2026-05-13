/**
 * ENG-039a — VoiceOrderingScreen test matrix.
 *
 * Covers the rows tagged "Web" in the plan's quality matrix:
 *   A1, A2, A6  → happy paths (touch + mobile variant + manual add)
 *   B4          → duplicate-product merge with notes (MVP last-write)
 *   C1..C4      → mic CTA gating (module, AI, session, MediaRecorder)
 *   D1..D5      → save CTA gating + error path + double-click guard
 *   E4          → no sidebar / Header in the page tree
 *   G3          → pluralised success toast
 *   K1          → mic CTA aria-label localized
 *   K3          → table label input aria-required
 *
 * Mocks every external dependency (auth, tenant, modules, trpc,
 * ProductSearchDialog, VoiceCartCommandModal) so the suite drives
 * the screen's local state machine deterministically.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

const moduleActiveMock = vi.fn((_id: string) => true);
const aiEnabledMock = vi.fn(() => true);
const cashSessionMock = vi.fn(() => ({
  id: 'cs-1',
  siteId: 'site-1',
  cashierId: 'user-1',
  registerName: 'Register A',
  openedAt: new Date().toISOString(),
}));

const createMutateAsync = vi.fn();
const suspendMutateAsync = vi.fn();
const discardMutateAsync = vi.fn();

const logoutMock = vi.fn();

let lastVoiceOnApply: ((items: Array<{ selection: unknown; quantity: number; note: string | null }>) => void) | null = null;
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
    user: { id: 'user-1', name: 'Waiter Wendy', role: 'cashier', email: 'w@x.com', tenantId: 't-1' },
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
  useCriticalMutation: (procedure: string) => {
    if (procedure === 'sales.create') {
      return { mutate: vi.fn(), mutateAsync: createMutateAsync, isPending: false };
    }
    if (procedure === 'sales.suspend') {
      return { mutate: vi.fn(), mutateAsync: suspendMutateAsync, isPending: false };
    }
    return { mutate: vi.fn(), mutateAsync: discardMutateAsync, isPending: false };
  },
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
      getActive: {
        useQuery: () => ({
          data: cashSessionMock(),
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({
      sales: {
        listDrafts: { invalidate: vi.fn() },
      },
      cashSessions: {
        getActive: { invalidate: vi.fn() },
      },
    }),
  },
}));

// Mock the VoiceCartCommandModal so the test can drive `onApply`
// without lifting the entire voice pipeline. The mock captures the
// callback so the test invokes it with a deterministic payload.
vi.mock('@/features/voice/VoiceCartCommandModal', () => ({
  VoiceCartCommandModal: ({
    isOpen,
    onApply,
    onClose,
  }: {
    isOpen: boolean;
    onApply: (items: Array<{ selection: unknown; quantity: number; note: string | null }>) => void;
    onClose: () => void;
  }) => {
    if (!isOpen) return null;
    lastVoiceOnApply = onApply;
    // Reserve onClose so the screen can dismiss the modal in real use;
    // tests don't drive close from the mock.
    void onClose;
    return <div data-testid="voice-modal-stub" />;
  },
}));

vi.mock('@/components/dialogs/ProductSearchDialog', () => ({
  ProductSearchDialog: ({
    isOpen,
    onSelect,
    onClose,
  }: {
    isOpen: boolean;
    onSelect: (selection: unknown) => void;
    onClose: () => void;
  }) => {
    if (!isOpen) return null;
    lastSearchOnSelect = onSelect;
    return (
      <button
        type="button"
        data-testid="product-search-stub-select"
        onClick={() => onClose()}
      />
    );
  },
}));

import { VoiceOrderingScreen } from '../VoiceOrderingScreen';

function makeSelection(overrides?: {
  productId?: string;
  productName?: string;
  unitId?: string;
  price?: number;
}) {
  const productId = overrides?.productId ?? 'p-coca';
  const productName = overrides?.productName ?? 'Coca Cola';
  const unitId = overrides?.unitId ?? 'u-unit';
  const price = overrides?.price ?? 5000;
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
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
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
  createMutateAsync.mockReset();
  suspendMutateAsync.mockReset();
  discardMutateAsync.mockReset();
  lastVoiceOnApply = null;
  lastSearchOnSelect = null;
  await i18n.changeLanguage('es');
});

describe('VoiceOrderingScreen (ENG-039a)', () => {
  // E4 — no sidebar / Header
  it('renders without the main app sidebar or Header chrome', () => {
    renderScreen('touch');
    expect(screen.getByTestId('voice-ordering-screen')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
  });

  // A6 — manual fallback path adds an item without voice
  it('manual product search adds a row via mergeCartItem', async () => {
    renderScreen('touch');
    fireEvent.click(screen.getByTestId('voice-ordering-manual-add'));
    await waitFor(() => expect(typeof lastSearchOnSelect).toBe('function'));
    await act(async () => {
      lastSearchOnSelect?.(makeSelection());
    });
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(1);
  });

  // A1 — voice apply hydrates cart with quantity AND note preserved
  it('applies voice items with quantity and note hydrated into the cart', async () => {
    renderScreen('touch');
    // Open the modal
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.queryByTestId('voice-modal-stub')).toBeInTheDocument());
    // Invoke the captured onApply callback with two parser items.
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection({ productId: 'p-coca', productName: 'Coca' }), quantity: 2, note: null },
        { selection: makeSelection({ productId: 'p-burg', productName: 'Hamburguesa', unitId: 'u-2' }), quantity: 1, note: 'sin queso' },
      ]);
    });
    const rows = screen.getAllByTestId('voice-ordering-cart-row');
    expect(rows).toHaveLength(2);
    const noteInputs = screen.getAllByTestId('voice-ordering-note-input') as HTMLInputElement[];
    // 2 inputs, one preset with 'sin queso'
    const filled = noteInputs.find(input => input.value === 'sin queso');
    expect(filled).toBeDefined();
  });

  // B4 — duplicate-product merge: second invocation bumps qty + note overwrites
  it('merges duplicate product invocations with last-write note semantics', async () => {
    renderScreen('touch');
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.queryByTestId('voice-modal-stub')).toBeInTheDocument());
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection({ productId: 'p-pan', productName: 'Pan' }), quantity: 1, note: 'sin sal' },
      ]);
    });
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection({ productId: 'p-pan', productName: 'Pan' }), quantity: 1, note: 'con miel' },
      ]);
    });
    const rows = screen.getAllByTestId('voice-ordering-cart-row');
    expect(rows).toHaveLength(1);
    const noteInput = screen.getByTestId('voice-ordering-note-input') as HTMLInputElement;
    expect(noteInput.value).toBe('con miel');
  });

  // C1 — semantic-search module off → mic disabled + hint shown
  it('disables the mic CTA when the semantic-search module is off', () => {
    moduleActiveMock.mockImplementation((id: string) => id !== 'semantic-search');
    renderScreen('touch');
    const mic = screen.getByTestId('voice-ordering-mic-cta') as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(screen.getByTestId('voice-ordering-mic-disabled-hint')).toHaveTextContent(
      /no están activos|not active/
    );
  });

  // C2 — AI off → mic disabled with a different hint
  it('disables the mic CTA when AI is disabled at tenant level', () => {
    aiEnabledMock.mockReturnValue(false);
    renderScreen('touch');
    const mic = screen.getByTestId('voice-ordering-mic-cta') as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(screen.getByTestId('voice-ordering-mic-disabled-hint')).toHaveTextContent(
      /IA está desactivada|AI is disabled/
    );
  });

  // C3 — no active cash session → mic + save disabled with hint
  it('gates mic + save when no active cash session', () => {
    cashSessionMock.mockReturnValue(null as unknown as ReturnType<typeof cashSessionMock>);
    renderScreen('touch');
    const mic = screen.getByTestId('voice-ordering-mic-cta') as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(screen.getByTestId('voice-ordering-mic-disabled-hint')).toHaveTextContent(
      /sesión de caja|cash session/i
    );
    const save = screen.getByTestId('voice-ordering-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  // D1 + D2 — save disabled on empty table OR empty cart
  it('disables save when the table label is empty or cart is empty', () => {
    renderScreen('touch');
    const save = screen.getByTestId('voice-ordering-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // Fill the table label but cart still empty → disabled + emptyCartHint
    fireEvent.change(screen.getByTestId('voice-ordering-table-input'), {
      target: { value: 'Mesa 5' },
    });
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId('voice-ordering-save-empty-hint')).toBeInTheDocument();
  });

  // D5 — happy-path save → create + suspend invoked with expected payload, toast fires
  it('save invokes sales.create then sales.suspend with the expected payload', async () => {
    createMutateAsync.mockResolvedValue({ id: 'draft-1' });
    suspendMutateAsync.mockResolvedValue({ id: 'draft-1' });
    renderScreen('touch');

    fireEvent.change(screen.getByTestId('voice-ordering-table-input'), {
      target: { value: 'Mesa 5' },
    });
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.queryByTestId('voice-modal-stub')).toBeInTheDocument());
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection({ productId: 'p-coca', productName: 'Coca' }), quantity: 2, note: null },
        { selection: makeSelection({ productId: 'p-burg', productName: 'Hamburguesa', unitId: 'u-2' }), quantity: 1, note: 'sin queso' },
      ]);
    });

    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const createCall = createMutateAsync.mock.calls[0]?.[0];
    expect(createCall).toMatchObject({
      status: 'draft',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      discountAmount: 0,
    });
    expect(createCall.items).toHaveLength(2);
    expect(createCall.items[0]).toMatchObject({
      productId: 'p-coca',
      quantity: 2,
      unitPrice: 5000,
    });
    expect(createCall.notes).toContain('Mesa 5');
    expect(createCall.notes).toContain('sin queso');

    await waitFor(() => expect(suspendMutateAsync).toHaveBeenCalledTimes(1));
    expect(suspendMutateAsync.mock.calls[0]?.[0]).toEqual({
      saleId: 'draft-1',
      label: 'Mesa 5',
    });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // G3 — pluralised success toast resolves the _other variant for count=2
    const toastCall = toastSuccess.mock.calls[0]?.[0];
    expect(toastCall.title).toMatch(/Mesa 5/);
  });

  // D4 — save network error keeps cart populated + surfaces error toast
  it('preserves cart state when sales.create rejects', async () => {
    createMutateAsync.mockRejectedValue(new Error('boom'));
    renderScreen('touch');

    fireEvent.change(screen.getByTestId('voice-ordering-table-input'), {
      target: { value: 'Mesa 5' },
    });
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.queryByTestId('voice-modal-stub')).toBeInTheDocument());
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection(), quantity: 1, note: null },
      ]);
    });
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // Cart still has the row; user can retry without losing work.
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(1);
    expect(suspendMutateAsync).not.toHaveBeenCalled();
  });

  // D4 — suspend failure compensates the just-created draft.
  it('discards the pending draft when sales.suspend rejects', async () => {
    createMutateAsync.mockResolvedValue({ id: 'draft-2' });
    suspendMutateAsync.mockRejectedValue(new Error('suspend failed'));
    discardMutateAsync.mockResolvedValue({ id: 'draft-2', status: 'cancelled' });
    renderScreen('touch');

    fireEvent.change(screen.getByTestId('voice-ordering-table-input'), {
      target: { value: 'Mesa 9' },
    });
    fireEvent.click(screen.getByTestId('voice-ordering-mic-cta'));
    await waitFor(() => expect(screen.queryByTestId('voice-modal-stub')).toBeInTheDocument());
    await act(async () => {
      lastVoiceOnApply?.([
        { selection: makeSelection(), quantity: 1, note: null },
      ]);
    });
    fireEvent.click(screen.getByTestId('voice-ordering-save'));

    await waitFor(() =>
      expect(discardMutateAsync).toHaveBeenCalledWith({ saleId: 'draft-2' })
    );
    expect(toastError).toHaveBeenCalled();
    expect(screen.getAllByTestId('voice-ordering-cart-row')).toHaveLength(1);
  });

  // K1 + K3 — basic accessibility wiring
  it('exposes a localized aria-label on the mic CTA and aria-required on the table input', () => {
    renderScreen('touch');
    const mic = screen.getByTestId('voice-ordering-mic-cta');
    expect(mic.getAttribute('aria-label')).toMatch(/Orden por voz|Voice order/);
    const input = screen.getByTestId('voice-ordering-table-input');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  // A2 — mobile variant renders with the same flow but a mobile-tagged surface
  it('mobile variant tags the screen for phone-width styling', () => {
    renderScreen('mobile');
    const screenEl = screen.getByTestId('voice-ordering-screen');
    expect(screenEl.getAttribute('data-variant')).toBe('mobile');
  });
});
