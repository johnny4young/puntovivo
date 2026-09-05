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
import type { ProductTemplateVerticalId } from '@puntovivo/shared/vertical-presets';
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

import {
  ProductFormModal,
  type LookupOption,
  type UnitLookupOption,
  type VatRateOption,
} from './ProductFormModal';

const CATEGORIES: LookupOption[] = [
  { id: 'cat-bakery', name: 'Panadería' },
  { id: 'cat-drinks', name: 'Bebidas' },
  { id: 'cat-dairy', name: 'Lácteos' },
];
const LOCATIONS: LookupOption[] = [{ id: 'loc-1', name: 'Bodega' }];
const PROVIDERS: LookupOption[] = [{ id: 'prov-1', name: 'Provider 1' }];
const UNITS: UnitLookupOption[] = [
  { id: 'unit-1', name: 'Unidad', abbreviation: 'UND', dimension: 'count' },
  {
    id: 'unit-kg',
    name: 'Kilogram',
    abbreviation: 'KG',
    dimension: 'mass',
    referenceFactor: 1000,
  },
  { id: 'unit-m', name: 'Metre', abbreviation: 'MTR', dimension: 'length' },
];
const VAT_RATES: VatRateOption[] = [{ id: 'vat-19', name: 'IVA 19%', rate: 19, kind: 'iva' }];

interface SuggestCategoryInput {
  name: string;
  description: string | null;
}

function renderModal(
  opts: {
    mode?: 'create' | 'edit';
    product?: Product | null;
    error?: string | null;
    onClose?: () => void;
    vatRates?: VatRateOption[];
    units?: UnitLookupOption[];
    templateVertical?: ProductTemplateVerticalId | null;
  } = {}
) {
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
      units={opts.units ?? UNITS}
      vatRates={opts.vatRates ?? VAT_RATES}
      templateVertical={opts.templateVertical === undefined ? 'butchery' : opts.templateVertical}
      isSaving={false}
      error={opts.error ?? null}
      onClose={opts.onClose ?? vi.fn()}
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

afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
  vi.useRealTimers();
});

describe('ProductFormModal — AI category suggestion', () => {
  it('applies the weighted-cut template explicitly and keeps its base-unit price aligned', async () => {
    renderModal({ mode: 'create' });

    await act(async () => {
      await import('./VerticalProductTemplatesPanel');
    });
    fireEvent.click(screen.getByTestId('product-template-butchery-weighted-cut'));

    expect(screen.getByRole('checkbox', { name: 'Track lots and expiry' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow fractional sales' })).toBeChecked();
    expect(screen.getByLabelText('Fraction step')).toHaveValue(0.001);
    expect(screen.getByLabelText('Fraction minimum')).toHaveValue(0.001);
    expect(screen.getByLabelText('Stock')).toHaveAttribute('readonly');
    expect(screen.getByText(/Weighted cut applied\./)).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Pricing' }));
      await import('./ProductPricingTab');
    });
    const tierOnePrice = document.querySelector<HTMLInputElement>('input[name="price"]');
    expect(tierOnePrice).not.toBeNull();
    fireEvent.change(tierOnePrice!, { target: { value: '12500' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Units' }));
      await import('./ProductUnitsTab');
    });
    expect(screen.getByLabelText('Unit')).toHaveValue('unit-kg');
    expect(screen.getByLabelText('Equivalence')).toHaveValue(1);
    expect(screen.getByLabelText('Equivalence')).toHaveAttribute('min', '0.001');
    expect(screen.getByLabelText('Tier 1 unit price')).toHaveValue(12500);
  });

  it('does not mutate the form or create a unit when a template unit is missing', async () => {
    renderModal({
      mode: 'create',
      units: [{ id: 'unit-1', name: 'Unit', abbreviation: 'UND', dimension: 'count' }],
    });

    await act(async () => {
      await import('./VerticalProductTemplatesPanel');
    });
    fireEvent.click(screen.getByTestId('product-template-butchery-weighted-cut'));

    expect(screen.getByRole('alert')).toHaveTextContent('KG, KGS, KILO');
    expect(screen.getByRole('checkbox', { name: 'Track lots and expiry' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Allow fractional sales' })).not.toBeChecked();
  });

  it('does not show vertical templates when the tenant selected another profile', () => {
    renderModal({ mode: 'create', templateVertical: null });

    expect(screen.queryByTestId('vertical-product-templates')).not.toBeInTheDocument();
  });

  it('protects edits to an existing product until discard is explicit', () => {
    const onClose = vi.fn();
    const product = createMockProduct({ name: 'Original product' });
    renderModal({ mode: 'edit', product, onClose });

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Edited product' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved product changes');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Discard product changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

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

  it('renders an error handled by the owning mutation without treating it as success', async () => {
    onSubmitMock.mockResolvedValue(undefined);
    renderModal({ error: 'A product with this SKU already exists.' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test product' } });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'TEST-001' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
      await Promise.resolve();
    });

    expect(onSubmitMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('A product with this SKU already exists.');
  });

  it('keeps the primary tax first and submits an explicit additional component', async () => {
    onSubmitMock.mockResolvedValue(undefined);
    renderModal({
      vatRates: [...VAT_RATES, { id: 'inc-8', name: 'INC 8%', rate: 8, kind: 'inc' }],
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mixed tax meal' } });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'MIXED-TAX-01' } });
    fireEvent.change(screen.getByLabelText('VAT Rate'), { target: { value: 'vat-19' } });
    const inc = screen.getByRole('checkbox', { name: /INC 8%/ });
    fireEvent.click(inc);

    expect(inc).toBeChecked();
    expect(screen.getByText('2 of 4 components · combined rate 27%')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Product' }));
      await Promise.resolve();
    });
    expect(onSubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vatRateId: 'vat-19',
        taxRate: 19,
        taxComponentVatRateIds: ['vat-19', 'inc-8'],
      })
    );
  });

  it('shows the primary rate separately from the combined compatibility total on edit', () => {
    const vatRates: VatRateOption[] = [
      ...VAT_RATES,
      { id: 'inc-8', name: 'INC 8%', rate: 8, kind: 'inc' },
    ];
    renderModal({
      mode: 'edit',
      vatRates,
      product: createMockProduct({
        vatRateId: 'vat-19',
        taxRate: 27,
        taxComponents: [
          {
            componentKey: 'vat:vat-19',
            vatRateId: 'vat-19',
            taxKind: 'iva',
            taxRate: 19,
            position: 0,
          },
          {
            componentKey: 'vat:inc-8',
            vatRateId: 'inc-8',
            taxKind: 'inc',
            taxRate: 8,
            position: 1,
          },
        ],
      }),
    });

    expect(screen.getByLabelText('Tax Rate (%)')).toHaveValue(19);
    expect(screen.getByText('2 of 4 components · combined rate 27%')).toBeVisible();
  });

  it('lets a new product return to the implicit base-unit default', async () => {
    renderModal({ mode: 'create' });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Units' }));
      await import('./ProductUnitsTab');
    });
    expect(screen.getByText(/No sale unit assigned/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Unit' }));
    expect(screen.getByRole('checkbox', { name: 'Base unit' })).toBeChecked();
    const removeButton = screen.getByRole('button', { name: 'Remove' });
    expect(removeButton).toBeEnabled();

    fireEvent.click(removeButton);
    expect(screen.getByText(/No sale unit assigned/)).toBeInTheDocument();
  });

  it('keeps one explicit base unit on an existing product and explains why', async () => {
    renderModal({ mode: 'edit', product: createMockProduct() });

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Units' }));
      await import('./ProductUnitsTab');
    });
    const removeButton = screen.getByRole('button', { name: 'Remove' });
    expect(removeButton).toBeDisabled();
    expect(screen.getByText('An existing product must keep one base sale unit.')).toBeVisible();
    expect(removeButton).toHaveAccessibleDescription(
      'An existing product must keep one base sale unit.'
    );
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

  it(' — exposes opt-in lot tracking and locks direct stock edits', async () => {
    renderModal({ mode: 'create' });
    const stock = screen.getByLabelText('Stock') as HTMLInputElement;
    const toggle = screen.getByRole('checkbox', { name: 'Track lots and expiry' });

    expect(toggle).not.toBeChecked();
    expect(stock).not.toHaveAttribute('readonly');
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(toggle).toBeChecked();
    expect(stock).toHaveAttribute('readonly');
    expect(
      screen.getByText(/Stock is managed from lot-aware inventory entries/)
    ).toBeInTheDocument();
  });

  it(' — makes serial tracking exclusive and locks aggregate stock', async () => {
    renderModal({ mode: 'create' });
    const stock = screen.getByLabelText('Stock') as HTMLInputElement;
    const serialToggle = screen.getByRole('checkbox', { name: 'Track serial numbers' });
    const lotToggle = screen.getByRole('checkbox', { name: 'Track lots and expiry' });
    const fractionToggle = screen.getByRole('checkbox', { name: 'Allow fractional sales' });

    await act(async () => {
      fireEvent.click(lotToggle);
      await Promise.resolve();
    });
    expect(lotToggle).toBeChecked();
    await act(async () => {
      fireEvent.click(serialToggle);
      await Promise.resolve();
    });
    expect(serialToggle).toBeChecked();
    expect(lotToggle).not.toBeChecked();
    expect(fractionToggle).not.toBeChecked();
    expect(stock).toHaveAttribute('readonly');
    expect(screen.getByText(/Stock is managed from serial-aware inventory receipts/)).toBeVisible();

    await act(async () => {
      fireEvent.click(fractionToggle);
      await Promise.resolve();
    });
    expect(fractionToggle).toBeChecked();
    expect(serialToggle).not.toBeChecked();
    expect(stock).not.toHaveAttribute('readonly');
  });

  it(' — permits metadata edits when persisted lot stock is positive', async () => {
    renderModal({ mode: 'edit', product: createMockProduct({ stock: 4, tracksLots: true }) });

    expect(screen.getByRole('checkbox', { name: 'Track lots and expiry' })).toBeChecked();
    expect(screen.getByLabelText('Stock')).toHaveAttribute('readonly');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Updated tracked product' },
      });
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

    await act(async () => {
      fireEvent.click(toggle);
      fireEvent.change(screen.getByLabelText('Stock'), { target: { value: '6' } });
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await Promise.resolve();
    });

    expect(
      screen.getByText('Stock must be zero before lot tracking can be enabled.')
    ).toBeVisible();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });
});
