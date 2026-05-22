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
import { screen } from '@testing-library/react';
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

    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No products matched/i)).toBeInTheDocument();
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

    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Searching products/i)).toBeInTheDocument();
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

    expect(
      screen.queryByTestId('product-search-empty-state')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Arroz Diana 500g')).toBeInTheDocument();
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
