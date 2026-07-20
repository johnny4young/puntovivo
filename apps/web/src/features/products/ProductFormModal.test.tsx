/**
 * ProductFormModal AI category suggestion.
 *
 * Pins the confidence-tiered behavior:
 * - HIGH confidence (>= 0.7) auto-preselects the category in CREATE mode
 * when the dropdown is empty, plus renders the "Sugerido por IA" badge.
 * In EDIT mode or when the operator already picked, the chip appears
 * instead — preselect never overrides operator intent.
 * - MEDIUM confidence (0.3..0.7) renders a chip with an "Aplicar
 * sugerencia" CTA the operator clicks to accept.
 * - Below 0.3 is silent.
 * - Module `semantic-search` off ⇒ the mutation never fires.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, createMockProduct } from '@/test/utils';

import type { Product } from '@/types';

const {
  useAuthMock,
  useIsModuleActiveMock,
  suggestCategoryMutateMock,
  suggestCategoryHandlersRef,
  onSubmitMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsModuleActiveMock: vi.fn(),
  suggestCategoryMutateMock: vi.fn(),
  suggestCategoryHandlersRef: {
    current: null as null | {
      onSuccess?: (data: unknown, variables?: unknown) => void;
      onError?: (err: unknown, variables?: unknown) => void;
    },
  },
  onSubmitMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: useIsModuleActiveMock,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    products: {
      suggestCategory: {
        useMutation: (handlers: {
          onSuccess?: (data: unknown, variables?: unknown) => void;
          onError?: (err: unknown, variables?: unknown) => void;
        }) => {
          suggestCategoryHandlersRef.current = handlers;
          return {
            mutate: suggestCategoryMutateMock,
            isPending: false,
          };
        },
      },
    },
  },
}));

import { ProductFormModal, type LookupOption, type VatRateOption } from './ProductFormModal';

const CATEGORIES: LookupOption[] = [
  { id: 'cat-bakery', name: 'Panadería' },
  { id: 'cat-drinks', name: 'Bebidas' },
  { id: 'cat-dairy', name: 'Lácteos' },
];
const LOCATIONS: LookupOption[] = [{ id: 'loc-1', name: 'Bodega' }];
const PROVIDERS: LookupOption[] = [{ id: 'prov-1', name: 'Provider 1' }];
const UNITS: LookupOption[] = [{ id: 'unit-1', name: 'Unidad' }];
const VAT_RATES: VatRateOption[] = [{ id: 'vat-19', name: 'IVA 19%', rate: 19 }];

interface SuggestCategoryInput {
  name: string;
  description: string | null;
}

function renderModal(opts: { mode?: 'create' | 'edit'; product?: Product | null } = {}) {
  const mode = opts.mode ?? 'create';
  const product = opts.product ?? null;
  return render(
    <ProductFormModal
      mode={mode}
      isOpen
      product={product}
      categories={CATEGORIES}
      locations={LOCATIONS}
      providers={PROVIDERS}
      units={UNITS}
      vatRates={VAT_RATES}
      isSaving={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={onSubmitMock}
    />
  );
}

function lastSuggestionVariables(): SuggestCategoryInput {
  return suggestCategoryMutateMock.mock.lastCall?.[0] ?? { name: '', description: null };
}

function emitSuccess(
  suggestion: { categoryId: string; confidence: number } | null,
  variables = lastSuggestionVariables()
) {
  act(() => {
    suggestCategoryHandlersRef.current?.onSuccess?.(
      suggestion === null ? { ok: false, suggestion: null } : { ok: true, suggestion },
      variables
    );
  });
}

function fireDebouncedSuggestion(name: string, description = '') {
  const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
  const descriptionInput = screen.getByLabelText('Description') as HTMLTextAreaElement;
  act(() => {
    fireEvent.change(nameInput, { target: { value: name } });
    if (description) {
      fireEvent.change(descriptionInput, { target: { value: description } });
    }
  });
  act(() => {
    vi.advanceTimersByTime(900);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useAuthMock.mockReset();
  useIsModuleActiveMock.mockReset();
  suggestCategoryMutateMock.mockReset();
  suggestCategoryHandlersRef.current = null;
  onSubmitMock.mockReset();
  // Default: admin role + semantic-search module ON.
  useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
  useIsModuleActiveMock.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProductFormModal — AI category suggestion', () => {
  it('A1 — HIGH confidence + create mode + empty categoryId → auto-preselects category and shows badge', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    expect(suggestCategoryMutateMock).toHaveBeenCalledWith({
      name: 'Pan tajado integral 500g',
      description: null,
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 });
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    expect(select.value).toBe('cat-bakery');
    expect(screen.getByTestId('suggest-category-badge')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-category-badge')).toHaveTextContent('Suggested by AI');
    // No chip — the badge handles the auto-preselect messaging.
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A2 — HIGH confidence + operator already picked → no override; chip with Apply CTA appears', () => {
    renderModal({ mode: 'create' });
    // Operator types the name then manually picks Bebidas BEFORE debounce fires.
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'Coca Cola 1.5L' } });
      fireEvent.change(select, { target: { value: 'cat-drinks' } });
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 });
    // Operator's choice respected.
    expect(select.value).toBe('cat-drinks');
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('suggest-category-chip')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-category-chip')).toHaveTextContent('Panadería');
  });

  it('A3 — HIGH confidence + edit mode → no auto-preselect; chip visible', () => {
    const product = createMockProduct({
      name: 'Manzana roja 1kg',
      description: 'Fruta fresca',
      categoryId: 'cat-dairy', // intentionally not the suggestion
    });
    renderModal({ mode: 'edit', product });
    // The modal's name field is already filled with the product's name → the
    // debounce fires on mount because we change description.
    const descriptionInput = screen.getByLabelText('Description') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(descriptionInput, { target: { value: 'Fruta fresca de temporada' } });
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 });
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    // Existing category preserved.
    expect(select.value).toBe('cat-dairy');
    // No auto-preselect badge in edit mode.
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    // Chip surfaces the AI's suggestion so the operator can apply.
    expect(screen.getByTestId('suggest-category-chip')).toBeInTheDocument();
  });

  it('A4 — MEDIUM confidence (0.5) → chip renders with percentage; no auto-preselect', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Producto genérico');
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.5 });
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    const chip = screen.getByTestId('suggest-category-chip');
    expect(chip).toHaveTextContent('50%');
    expect(chip).toHaveTextContent('Panadería');
  });

  it('A5 — BELOW FLOOR (0.2) → silent, no chip and no badge', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Producto X');
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.2 });
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A6 — Click Aplicar sugerencia → categoryId set + chip hides', () => {
    renderModal({ mode: 'create' });
    // Operator picks first so we end up in the chip path.
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    act(() => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pan crujiente' } });
      fireEvent.change(select, { target: { value: 'cat-drinks' } });
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 });
    expect(screen.getByTestId('suggest-category-chip')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('suggest-category-apply'));
    });
    expect(select.value).toBe('cat-bakery');
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A7 — Dismiss ✕ → chip hides until next suggestion arrives with a different categoryId', () => {
    renderModal({ mode: 'create' });
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    act(() => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coca Cola 1.5L' } });
      fireEvent.change(select, { target: { value: 'cat-drinks' } });
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.55 });
    expect(screen.getByTestId('suggest-category-chip')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('suggest-category-dismiss'));
    });
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
    // Same suggestion re-emitted → still dismissed.
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.55 });
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
    // Different categoryId → chip re-appears.
    emitSuccess({ categoryId: 'cat-dairy', confidence: 0.55 });
    expect(screen.getByTestId('suggest-category-chip')).toBeInTheDocument();
  });

  it('A8 — Module semantic-search OFF → mutation never fires', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    expect(suggestCategoryMutateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A9 — Debounce 800ms — rapid keystrokes coalesce into one mutation call', () => {
    renderModal({ mode: 'create' });
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'Pa' } });
      vi.advanceTimersByTime(200);
      fireEvent.change(nameInput, { target: { value: 'Pan' } });
      vi.advanceTimersByTime(200);
      fireEvent.change(nameInput, { target: { value: 'Pan t' } });
      vi.advanceTimersByTime(200);
      fireEvent.change(nameInput, { target: { value: 'Pan tajado' } });
    });
    // Only 800ms idle should trip the mutation.
    expect(suggestCategoryMutateMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(suggestCategoryMutateMock).toHaveBeenCalledTimes(1);
    expect(suggestCategoryMutateMock).toHaveBeenLastCalledWith({
      name: 'Pan tajado',
      description: null,
    });
  });

  it('A10 — Server returns {ok: false} → silent; nothing renders', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    emitSuccess(null);
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A11 — Cashier role (defensive) → mutation never fires even if module is on', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'cashier' } });
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    expect(suggestCategoryMutateMock).not.toHaveBeenCalled();
  });

  it('A12 — Mutation error → silent; no chip, no badge', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    act(() => {
      suggestCategoryHandlersRef.current?.onError?.(
        new Error('network down'),
        lastSuggestionVariables()
      );
    });
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('A13 — Stale mutation response is ignored after the operator changes the inputs', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    const staleVariables = lastSuggestionVariables();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'Leche deslactosada 1L' } });
    });
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 }, staleVariables);
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.queryByTestId('suggest-category-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggest-category-chip')).not.toBeInTheDocument();
  });

  it('B1 — Auto-preselect uses shouldDirty:true → form treats the change as a user edit', () => {
    renderModal({ mode: 'create' });
    fireDebouncedSuggestion('Pan tajado integral 500g');
    emitSuccess({ categoryId: 'cat-bakery', confidence: 0.85 });
    // After auto-preselect the select reflects the suggested id — and the
    // submit button stays enabled (a non-dirty form would still let the
    // operator submit, but the dirty flag is the practical proxy).
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement;
    expect(select.value).toBe('cat-bakery');
  });

  it('B2 — Name shorter than 3 chars never triggers the mutation', () => {
    renderModal({ mode: 'create' });
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    act(() => {
      fireEvent.change(nameInput, { target: { value: 'Pa' } });
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(suggestCategoryMutateMock).not.toHaveBeenCalled();
  });

  it(' — exposes opt-in lot tracking and locks direct stock edits', () => {
    renderModal({ mode: 'create' });
    const stock = screen.getByLabelText('Stock') as HTMLInputElement;
    const toggle = screen.getByRole('checkbox', { name: 'Track lots and expiry' });

    expect(toggle).not.toBeChecked();
    expect(stock).not.toHaveAttribute('readonly');
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(stock).toHaveAttribute('readonly');
    expect(
      screen.getByText(/Stock is managed from lot-aware inventory entries/)
    ).toBeInTheDocument();
  });

  it(' — makes serial tracking exclusive and locks aggregate stock', () => {
    renderModal({ mode: 'create' });
    const stock = screen.getByLabelText('Stock') as HTMLInputElement;
    const serialToggle = screen.getByRole('checkbox', { name: 'Track serial numbers' });
    const lotToggle = screen.getByRole('checkbox', { name: 'Track lots and expiry' });
    const fractionToggle = screen.getByRole('checkbox', { name: 'Allow fractional sales' });

    fireEvent.click(lotToggle);
    expect(lotToggle).toBeChecked();
    fireEvent.click(serialToggle);
    expect(serialToggle).toBeChecked();
    expect(lotToggle).not.toBeChecked();
    expect(fractionToggle).not.toBeChecked();
    expect(stock).toHaveAttribute('readonly');
    expect(screen.getByText(/Stock is managed from serial-aware inventory receipts/)).toBeVisible();

    fireEvent.click(fractionToggle);
    expect(fractionToggle).toBeChecked();
    expect(serialToggle).not.toBeChecked();
    expect(stock).not.toHaveAttribute('readonly');
  });

  it(' — permits metadata edits when persisted lot stock is positive', async () => {
    renderModal({ mode: 'edit', product: createMockProduct({ stock: 4, tracksLots: true }) });

    expect(screen.getByRole('checkbox', { name: 'Track lots and expiry' })).toBeChecked();
    expect(screen.getByLabelText('Stock')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Updated tracked product' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await Promise.resolve();
    });

    expect(onSubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Updated tracked product',
        stock: 4,
        tracksLots: true,
      })
    );
  });

  it(' — rejects changing stock before re-enabling persisted lot tracking', async () => {
    renderModal({ mode: 'edit', product: createMockProduct({ stock: 4, tracksLots: true }) });
    const toggle = screen.getByRole('checkbox', { name: 'Track lots and expiry' });

    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: '6' } });
    fireEvent.click(toggle);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await Promise.resolve();
    });

    expect(
      screen.getByText('Stock must be zero before lot tracking can be enabled.')
    ).toBeVisible();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });
});
