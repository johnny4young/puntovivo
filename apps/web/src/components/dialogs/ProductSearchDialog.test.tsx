/**
 * ENG-105c — Coverage for the empty-state CTA in `ProductSearchDialog`.
 *
 * The dialog renders a quick-create CTA when (a) the caller wired
 * `onQuickCreateRequested`, (b) the typed query produced zero
 * results, and (c) `canCreateProducts` is `true`. Cashier role
 * (or any caller passing `canCreateProducts={false}`) sees a hint
 * pointing to the manager instead of the button.
 *
 * @module components/dialogs/ProductSearchDialog.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import { ProductSearchDialog } from './ProductSearchDialog';

// Default mock: zero matches, not loading, no error. Individual tests
// override per-suite when they need other shapes.
const trpcQueryState = {
  data: { items: [] as unknown[], total: 0 },
  isLoading: false,
  error: null as { message: string } | null,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    products: {
      search: {
        useQuery: () => trpcQueryState,
      },
    },
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  trpcQueryState.data = { items: [], total: 0 };
  trpcQueryState.isLoading = false;
  trpcQueryState.error = null;
});

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ProductSearchDialog>> = {}
) {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    categories: [],
    providers: [],
    ...overrides,
  };
  return render(<ProductSearchDialog {...baseProps} />);
}

describe('<ProductSearchDialog /> empty-state CTA (ENG-105c)', () => {
  it('does not surface the empty-state block when the query is empty', () => {
    renderDialog({ onQuickCreateRequested: vi.fn() });
    expect(screen.queryByTestId('product-search-empty-state')).not.toBeInTheDocument();
    expect(screen.getByText(/Enter a search term/i)).toBeInTheDocument();
  });

  it('shows the empty-state block with admin hint + CTA when query returns zero results and caller wired onQuickCreateRequested', async () => {
    const onQuickCreateRequested = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'ProductoTestXYZ');

    const block = await screen.findByTestId('product-search-empty-state');
    expect(block).toBeInTheDocument();
    expect(
      screen.getByText((content, el) =>
        el?.tagName === 'P' && content.includes('ProductoTestXYZ')
      )
    ).toBeInTheDocument();

    const cta = screen.getByTestId('product-search-quick-create-cta');
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveTextContent(/Create new product/i);
  });

  it('hides the CTA but keeps the empty-state hint when canCreateProducts is false (cashier role)', async () => {
    const onQuickCreateRequested = vi.fn();
    const user = userEvent.setup();
    renderDialog({
      onQuickCreateRequested,
      canCreateProducts: false,
    });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'X');

    const block = await screen.findByTestId('product-search-empty-state');
    expect(block).toBeInTheDocument();
    expect(
      screen.queryByTestId('product-search-quick-create-cta')
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a manager/i)).toBeInTheDocument();
  });

  it('keeps the legacy noResults copy when onQuickCreateRequested is not wired (backward compat)', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'NoMatchAnywhere');

    // findBy: the typed query settles through the 200ms search debounce.
    expect(await screen.findByText(/No products matched/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
  });

  it('fires onQuickCreateRequested with the trimmed query and closes the dialog when the CTA is clicked', async () => {
    const onQuickCreateRequested = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested, onClose });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'Acme Sample');

    const cta = await screen.findByTestId('product-search-quick-create-cta');
    await user.click(cta);

    expect(onQuickCreateRequested).toHaveBeenCalledTimes(1);
    expect(onQuickCreateRequested).toHaveBeenCalledWith('Acme Sample');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the ES copy after a locale flip', async () => {
    await i18n.changeLanguage('es');
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested: vi.fn() });

    const searchInput = screen.getByPlaceholderText(/Buscar por SKU/i);
    await user.type(searchInput, 'X');

    const cta = await screen.findByTestId('product-search-quick-create-cta');
    expect(cta).toHaveTextContent(/Crear nuevo producto/i);
    expect(screen.getByText(/Puedes registrarlo ahora/i)).toBeInTheDocument();
  });

  it('escapes special characters in the empty-state title (no XSS through {{query}})', async () => {
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested: vi.fn() });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, '<script>alert(1)</script>');

    const block = await screen.findByTestId('product-search-empty-state');
    // The literal raw text should appear (i18next escapes by default).
    expect(block.textContent).toContain('<script>alert(1)</script>');
    // No actual script element rendered.
    expect(block.querySelector('script')).toBeNull();
  });

  it('does not render the empty-state block while the query is still loading', async () => {
    trpcQueryState.isLoading = true;
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested: vi.fn() });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'X');

    // findBy: the typed query settles through the 200ms search debounce.
    expect(await screen.findByText(/Searching products/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
  });

  it('does not render the empty-state block when matches are present', async () => {
    trpcQueryState.data = {
      items: [
        {
          id: 'p-1',
          name: 'Arroz Diana 500g',
          sku: 'ABR-0001',
          stock: 21,
          baseUnitPrice: 3200,
          baseUnitAbbreviation: 'UND',
          categoryName: 'Abarrotes',
          providerName: null,
          unitAssignments: [
            {
              unitId: 'u-1',
              unitName: 'Unidad',
              unitAbbreviation: 'UND',
              equivalence: 1,
              price: 3200,
              isBase: true,
            },
          ],
        },
      ],
      total: 1,
    } as unknown as typeof trpcQueryState.data;
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested: vi.fn() });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'arroz');

    // findBy: the typed query settles through the 200ms search debounce.
    expect(await screen.findByText('Arroz Diana 500g')).toBeInTheDocument();
    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
  });

  it('keeps the CTA hidden when caller passes canCreateProducts=false even with onQuickCreateRequested wired', async () => {
    const onQuickCreateRequested = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested, canCreateProducts: false });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'X');

    await screen.findByTestId('product-search-empty-state');
    expect(
      screen.queryByTestId('product-search-quick-create-cta')
    ).not.toBeInTheDocument();
  });

  it('forwards the close call when the CTA fires (state cleanup happens via handleClose)', async () => {
    const onQuickCreateRequested = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onQuickCreateRequested, onClose });

    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'Q');

    const cta = await screen.findByTestId('product-search-quick-create-cta');
    await user.click(cta);

    // handleClose resets internal state and calls onClose(); we assert
    // onClose fired which is the visible side effect for the caller.
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * ENG-134e — Coverage for the roving tabindex + ArrowDown/Up/Home/End/Enter
 * keyboard navigation on product rows. Before this slice, rows had only
 * `onClick` — a cashier with keyboard alone could not select a product.
 * The slice adds:
 *
 * - `tabIndex={index === activeRowIndex ? 0 : -1}` on every row.
 * - `aria-selected` reflecting the selection state for screen readers.
 * - `onKeyDown` with switch on ArrowDown / ArrowUp / Home / End / Enter / Space.
 * - `onFocus` that syncs `activeRowIndex` when a row receives focus via
 *   mouse click or programmatic focus.
 * - Same-render reset that returns `activeRowIndex` to 0 when the
 *   product result identities change (new search query).
 *
 * The mouse-click path stays intact (existing `onClick` still fires).
 */

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-arroz',
    name: 'Arroz Diana 500g',
    sku: 'ABR-0001',
    stock: 21,
    baseUnitPrice: 3200,
    baseUnitAbbreviation: 'UND',
    categoryName: 'Abarrotes',
    providerName: null,
    unitAssignments: [
      {
        unitId: 'u-1',
        unitName: 'Unidad',
        unitAbbreviation: 'UND',
        equivalence: 1,
        price: 3200,
        isBase: true,
      },
    ],
    ...overrides,
  };
}

const THREE_PRODUCTS = [
  buildProduct({ id: 'p-1', name: 'Arroz Diana 500g', sku: 'ABR-0001' }),
  buildProduct({ id: 'p-2', name: 'Leche Entera 1L', sku: 'LAC-0001' }),
  buildProduct({ id: 'p-3', name: 'Pan Tajado', sku: 'PAN-0001' }),
];

async function fillSearchAndAwaitRows(rowsCount: number) {
  const user = userEvent.setup();
  const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
  await user.type(searchInput, 'arroz');
  // Rows appear once the deferred query commits and the mock returns
  // items; await the full set so timing stabilises before assertions.
  const rows = await screen.findAllByTestId(/product-search-row-/i);
  expect(rows).toHaveLength(rowsCount);
  return user;
}

describe('<ProductSearchDialog /> keyboard navigation (ENG-134e)', () => {
  beforeEach(() => {
    trpcQueryState.data = { items: THREE_PRODUCTS, total: THREE_PRODUCTS.length };
    trpcQueryState.isLoading = false;
    trpcQueryState.error = null;
  });

  it('marks the first row with tabIndex=0 and the rest with tabIndex=-1 on initial render', async () => {
    renderDialog({});
    await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
    expect(rows[2]).toHaveAttribute('tabindex', '-1');
  });

  it('reflects selection through aria-selected', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');

    await user.click(rows[1]!);

    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(rows[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('ArrowDown moves focus and tabIndex roving forward', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[0]!.focus();
    expect(rows[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');

    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute('tabindex', '0');
    expect(rows[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown on the last row is a no-op (no wrap-around)', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[2]!.focus();

    await user.keyboard('{ArrowDown}');

    expect(rows[2]).toHaveFocus();
    expect(rows[2]).toHaveAttribute('tabindex', '0');
  });

  it('ArrowUp on the first row is a no-op (no wrap-around)', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[0]!.focus();

    await user.keyboard('{ArrowUp}');

    expect(rows[0]).toHaveFocus();
    expect(rows[0]).toHaveAttribute('tabindex', '0');
  });

  it('Home jumps focus to the first row from any index', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[2]!.focus();

    await user.keyboard('{Home}');

    expect(rows[0]).toHaveFocus();
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[2]).toHaveAttribute('tabindex', '-1');
  });

  it('End jumps focus to the last row from any index', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[0]!.focus();

    await user.keyboard('{End}');

    expect(rows[2]).toHaveFocus();
    expect(rows[2]).toHaveAttribute('tabindex', '0');
    expect(rows[0]).toHaveAttribute('tabindex', '-1');
  });

  it('Enter on the active row selects the product (same effect as mouse click)', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[1]!.focus();

    await user.keyboard('{Enter}');

    // The selection panel renders a unit `<select>` only when a
    // product is selected — its presence is a deterministic proof
    // the selection state populated. Using the unit select id avoids
    // the false-positive from `getByText` matching both the row and
    // the selection panel rendering the same product name.
    await waitFor(() =>
      expect(document.getElementById('product-search-unit-select')).not.toBeNull()
    );
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Space behaves like Enter for selection', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[2]!.focus();

    await user.keyboard(' ');

    await waitFor(() =>
      expect(document.getElementById('product-search-unit-select')).not.toBeNull()
    );
    expect(rows[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('mouse click still updates selection (backward compat with the existing path)', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    await user.click(rows[1]!);

    await waitFor(() =>
      expect(document.getElementById('product-search-unit-select')).not.toBeNull()
    );
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a row also syncs activeRowIndex so subsequent ArrowDown starts from that row', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    await user.click(rows[1]!);
    // onFocus → setActiveRowIndex(1) is batched; await the re-render.
    await waitFor(() => expect(rows[1]).toHaveAttribute('tabindex', '0'));
    expect(rows[0]).toHaveAttribute('tabindex', '-1');

    // ArrowDown from row 1 should move focus to row 2.
    rows[1]!.focus();
    await user.keyboard('{ArrowDown}');

    expect(rows[2]).toHaveFocus();
  });

  it('resets activeRowIndex to the first row when items change to a same-length result set', async () => {
    renderDialog({});
    const user = await fillSearchAndAwaitRows(3);

    const rows = screen.getAllByTestId(/product-search-row-/i);
    rows[2]!.focus();
    // onFocus is async; await the roving tabindex reflecting row 2 as active.
    await waitFor(() => expect(rows[2]).toHaveAttribute('tabindex', '0'));

    // Simulate the next typed character returning a different list.
    trpcQueryState.data = {
      items: [
        buildProduct({ id: 'p-9', name: 'Mango Maduro', sku: 'FRU-0009' }),
        buildProduct({ id: 'p-10', name: 'Banano Bocadillo', sku: 'FRU-0010' }),
        buildProduct({ id: 'p-11', name: 'Manzana Roja', sku: 'FRU-0011' }),
      ],
      total: 3,
    } as unknown as typeof trpcQueryState.data;

    // Trigger a re-query by typing one more char so useDeferredValue
    // updates while the result length stays 3. The mock returns the
    // new identities on the next invocation of the hook.
    const searchInput = screen.getByPlaceholderText(/Search by SKU/i);
    await user.type(searchInput, 'm');

    const newRows = await screen.findAllByTestId(/product-search-row-/i);
    expect(newRows).toHaveLength(3);
    expect(newRows[0]).toHaveAttribute('tabindex', '0');
    expect(newRows[1]).toHaveAttribute('tabindex', '-1');
    expect(newRows[2]).toHaveAttribute('tabindex', '-1');
  });

  it('does not throw when the list is empty (no rows, no key nav targets)', () => {
    trpcQueryState.data = { items: [], total: 0 };
    renderDialog({});
    // Just rendering with an empty list should not throw — activeRowIndex
    // stays at 0 with no rows to focus.
    expect(screen.queryAllByTestId(/product-search-row-/i)).toHaveLength(0);
  });
});
