/**
 * pass 1 — ReceiptTemplateEditor component tests.
 *
 * Covers:
 * - Item #4: captions render above `itemsTable` + `totalsBlock` when
 * those blocks are selected in the block list.
 * - Item #5: `appFooter` block appears in the "add block" menu, and
 * its form exposes the `show` toggle with the expected default.
 * - Item #6: reordering a block via the `↑`/`↓` buttons triggers a
 * FLIP snapshot capture — asserted via spying on the FLIP helper
 * (jsdom cannot exercise the Web Animations API meaningfully so we
 * pin the invocation contract).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  act,
  fireEvent,
  render as renderWithoutProviders,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  Link,
  Route,
  Routes,
  UNSAFE_createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
} from 'react-router';
import i18next from '@/i18n';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createGuardedHistory } from '@/components/navigation/guardedHistory';
import { ReceiptTemplateEditor, type ReceiptTemplateEditorProps } from './ReceiptTemplateEditor';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      receiptTemplates: {
        list: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    receiptTemplates: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      renderPreview: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
      // pass 5 — variable availability hook called from
      // ReceiptTemplateEditor. Returns null while loading so the editor
      // does not paint false-negative dim styles before the real map
      // arrives.
      variableAvailability: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
    },
  },
}));

vi.mock('@/lib/flipAnimate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flipAnimate')>('@/lib/flipAnimate');
  return {
    ...actual,
    captureFlipSnapshot: vi.fn(actual.captureFlipSnapshot),
    playFlip: vi.fn(actual.playFlip),
  };
});

import { captureFlipSnapshot, playFlip } from '@/lib/flipAnimate';

describe('ReceiptTemplateEditor ( pass 1)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    vi.mocked(captureFlipSnapshot).mockClear();
    vi.mocked(playFlip).mockClear();
  });

  function renderEditor({
    openStructure = true,
    initial = null,
    onClose = () => {},
  }: {
    openStructure?: boolean;
    initial?: ReceiptTemplateEditorProps['initial'];
    onClose?: () => void;
  } = {}) {
    const controller = createNavigationGuardController();
    const history = createGuardedHistory(
      UNSAFE_createMemoryHistory({ initialEntries: ['/receipt-templates'], v5Compat: true }),
      controller
    );
    const result = renderWithoutProviders(
      <NavigationGuardProvider controller={controller}>
        <HistoryRouter history={history}>
          <Routes>
            <Route
              path="/receipt-templates"
              element={
                <ToastProvider>
                  <ReceiptTemplateEditor initial={initial} onClose={onClose} />
                </ToastProvider>
              }
            />
          </Routes>
        </HistoryRouter>
      </NavigationGuardProvider>
    );
    if (openStructure) {
      const disclosure = result.container.querySelector<HTMLButtonElement>(
        'button[aria-controls="receipt-structure-editor"]'
      );
      expect(disclosure).not.toBeNull();
      fireEvent.click(disclosure!);
    }
    return result;
  }

  it('leaves a clean editor immediately but confirms before discarding a changed draft', () => {
    const onCleanClose = vi.fn();
    const clean = renderEditor({ openStructure: false, onClose: onCleanClose });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCleanClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    clean.unmount();

    const onDirtyClose = vi.fn();
    renderEditor({ openStructure: false, onClose: onDirtyClose });
    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'Counter receipt' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onDirtyClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue('Counter receipt');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onDirtyClose).toHaveBeenCalledOnce();
  });

  it('clears the dirty state when the operator restores the original values', () => {
    const onClose = vi.fn();
    renderEditor({ openStructure: false, onClose });
    const name = screen.getByRole('textbox', { name: 'Template name' });

    fireEvent.change(name, { target: { value: 'Temporary name' } });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    fireEvent.change(name, { target: { value: '' } });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requests the browser unload safeguard only while changes are unsaved', () => {
    renderEditor({ openStructure: false });
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'Reload-protected receipt' },
    });
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('blocks in-app route navigation until the operator chooses what to do', async () => {
    const controller = createNavigationGuardController();
    const history = createGuardedHistory(
      UNSAFE_createMemoryHistory({ initialEntries: ['/receipt-templates'], v5Compat: true }),
      controller
    );
    renderWithoutProviders(
      <NavigationGuardProvider controller={controller}>
        <HistoryRouter history={history}>
          <Routes>
            <Route
              path="/receipt-templates"
              element={
                <ToastProvider>
                  <Link to="/products">Go to products</Link>
                  <ReceiptTemplateEditor initial={null} onClose={() => {}} />
                </ToastProvider>
              }
            />
            <Route path="/products" element={<h1>Products destination</h1>} />
          </Routes>
        </HistoryRouter>
      </NavigationGuardProvider>
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'Route-protected receipt' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Go to products' }));

    expect(history.location.pathname).toBe('/receipt-templates');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(history.location.pathname).toBe('/receipt-templates');
    expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue(
      'Route-protected receipt'
    );

    fireEvent.click(screen.getByRole('link', { name: 'Go to products' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(history.location.pathname).toBe('/products'));
    expect(screen.getByRole('heading', { name: 'Products destination' })).toBeInTheDocument();
  });

  it('restores browser history until the operator confirms leaving', async () => {
    const controller = createNavigationGuardController();
    const baseHistory = UNSAFE_createMemoryHistory({
      initialEntries: ['/products', '/receipt-templates'],
      initialIndex: 1,
      v5Compat: true,
    });
    const history = createGuardedHistory(baseHistory, controller);
    renderWithoutProviders(
      <NavigationGuardProvider controller={controller}>
        <HistoryRouter history={history}>
          <Routes>
            <Route
              path="/receipt-templates"
              element={
                <ToastProvider>
                  <ReceiptTemplateEditor initial={null} onClose={() => {}} />
                </ToastProvider>
              }
            />
            <Route path="/products" element={<h1>Products destination</h1>} />
          </Routes>
        </HistoryRouter>
      </NavigationGuardProvider>
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: 'History-protected receipt' },
    });
    act(() => baseHistory.go(-1));

    expect(history.location.pathname).toBe('/receipt-templates');
    expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(history.location.pathname).toBe('/receipt-templates');

    act(() => baseHistory.go(-1));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(history.location.pathname).toBe('/products'));
  });

  it('starts with a save-ready format and progressively discloses structure controls', () => {
    renderEditor({ openStructure: false });

    expect(screen.getByText('Start with a ready-made format')).toBeInTheDocument();
    expect(screen.getByText(/13 prepared sections/i)).toBeInTheDocument();
    expect(screen.queryByTestId('block-list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'App footer' })).not.toBeInTheDocument();

    const disclosure = screen.getByRole('button', { name: 'Customize sections' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);

    expect(screen.getByRole('button', { name: 'Hide controls' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByTestId('block-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'App footer' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-footer-show-toggle')).not.toBeInTheDocument();
  });

  it('describes an existing custom layout without claiming it is a default preset', () => {
    renderEditor({
      openStructure: false,
      initial: {
        id: 'template-1',
        name: 'Counter copy',
        kind: 'sale',
        layout: {
          paperWidth: '80mm',
          blocks: [{ type: 'text', value: 'Saved custom text' }],
        },
        isDefault: false,
        isActive: true,
      },
    });

    expect(screen.getByText('Main details')).toBeInTheDocument();
    expect(screen.getByText('Adjust the receipt essentials')).toBeInTheDocument();
    expect(screen.queryByText('Start with a ready-made format')).not.toBeInTheDocument();
    expect(screen.getByText('Current structure')).toBeInTheDocument();
    expect(screen.getByText('Review what this receipt prints')).toBeInTheDocument();
    expect(screen.getByText(/1 configured section/i)).toBeInTheDocument();
    expect(screen.queryByText('Default format')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Document type' })).toBeDisabled();
  });

  // ---------------------------------------------------------------------
  // Item #4 — bindings captions
  // ---------------------------------------------------------------------

  it('shows the itemsTable caption when the itemsTable block is selected', () => {
    renderEditor();
    // Default sale preset has an itemsTable at index 9 (after header + separator).
    // Find the row with the operator-facing purchased-items label and select it.
    const list = screen.getByTestId('block-list');
    const itemsTableRow = within(list)
      .getAllByText(/purchased items/i)
      .find(el => el.closest('[data-testid^="block-row-"]'));
    expect(itemsTableRow).toBeDefined();
    fireEvent.click(itemsTableRow!);
    expect(screen.getByTestId('items-table-caption')).toBeInTheDocument();
  });

  it('shows the totalsBlock collapsible caption when the totalsBlock is selected', () => {
    renderEditor();
    const list = screen.getByTestId('block-list');
    const totalsRow = within(list)
      .getAllByText(/totals/i)
      .find(el => el.closest('[data-testid^="block-row-"]'));
    expect(totalsRow).toBeDefined();
    fireEvent.click(totalsRow!);
    expect(screen.getByTestId('totals-block-caption')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Item #5 — appFooter block
  // ---------------------------------------------------------------------

  it('exposes an "appFooter" button in the add-block menu', () => {
    renderEditor();
    // The sale preset ships with an appFooter block, so the card
    // label ALSO reads "N. App footer". Scope the match to the
    // exact string "App footer" (leading index only appears on the
    // card rows — the add-block menu button has no prefix).
    const btn = screen.getByRole('button', { name: 'App footer' });
    expect(btn).toBeInTheDocument();
  });

  it('adds a visible appFooter block via the menu and renders the show toggle', () => {
    renderEditor();
    const addButton = screen.getByRole('button', { name: 'App footer' });
    fireEvent.click(addButton);

    // Multiple toggles render because the preset already has a footer
    // block AND we just appended a new one. Assert at least one exists
    // and the newly-added one (last in the list) is checked.
    const toggles = screen.getAllByTestId('app-footer-show-toggle');
    expect(toggles.length).toBeGreaterThan(0);
    const lastToggle = toggles[toggles.length - 1] as HTMLInputElement;
    expect(lastToggle.checked).toBe(true);
  });

  // ---------------------------------------------------------------------
  // wordmark + metaTable add-block menu entries
  // ---------------------------------------------------------------------

  it('exposes the brand wordmark + receipt details buttons in the add-block menu', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'Brand wordmark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receipt details' })).toBeInTheDocument();
  });

  it('adds a metaTable block with a single editable row from the menu', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Receipt details' }));

    // The freshly added block becomes the active block; its rows panel
    // must surface at least one row + the Add row CTA.
    const rowsPanel = screen.getByTestId('meta-table-rows');
    const labelInputs = within(rowsPanel).getAllByDisplayValue('Label');
    expect(labelInputs.length).toBeGreaterThan(0);
    expect(screen.getByTestId('meta-table-add-row')).toBeInTheDocument();
  });

  it('keeps focus while editing a metaTable row label', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Receipt details' }));

    const rowsPanel = screen.getByTestId('meta-table-rows');
    const labelInput = within(rowsPanel).getByDisplayValue('Label');
    labelInput.focus();
    fireEvent.change(labelInput, { target: { value: 'Invoice' } });

    expect(screen.getByDisplayValue('Invoice')).toHaveFocus();
  });

  // ---------------------------------------------------------------------
  // Item #6 — FLIP reorder capture
  // ---------------------------------------------------------------------

  it('captures a FLIP snapshot before moving a block down', () => {
    renderEditor();
    const moveDownButtons = screen.getAllByRole('button', { name: /move down/i });
    expect(moveDownButtons.length).toBeGreaterThan(0);
    fireEvent.click(moveDownButtons[0]!);
    expect(captureFlipSnapshot).toHaveBeenCalled();
    // playFlip runs inside a useLayoutEffect after the commit — with the
    // default prefers-reduced-motion=no-preference path it is invoked
    // once. The mock preserves the real implementation, so at minimum
    // the spy saw the call.
    expect(playFlip).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // pass 2 (item #1) — drag-and-drop reorder via dnd-kit
  // ---------------------------------------------------------------------

  it('renders a grip handle with the localized aria-label on every block row', () => {
    renderEditor();
    const grips = screen.getAllByTestId('block-grip');
    expect(grips.length).toBeGreaterThan(0);
    // Every grip carries the i18n-translated aria-label.
    for (const grip of grips) {
      expect(grip).toHaveAttribute('aria-label', 'Drag section to reorder');
    }
  });

  it('preserves the data-flip-key attribute on every block row after the dnd-kit wrapping', () => {
    // pass 2 (item #1) — regression gate. The pass-1 FLIP path
    // depends on every <li> exposing a `data-flip-key` so
    // captureFlipSnapshot/playFlip can correlate before/after rects
    // when the keyboard ↑/↓ buttons mutate the order. Wrapping each row
    // in <SortableBlockRow> must NOT strip that attribute.
    const { container } = renderEditor();
    const flipNodes = container.querySelectorAll('[data-flip-key]');
    expect(flipNodes.length).toBeGreaterThan(0);
    // Each flip-key value is unique (matches the blockKeys array contract).
    const keys = Array.from(flipNodes).map(n => n.getAttribute('data-flip-key'));
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('keeps the ↑/↓ buttons working alongside the new grip handle (regression gate)', () => {
    renderEditor();
    // The pass-1 FLIP test already exercises the move-down click path;
    // this test specifically asserts that BOTH the grip and the buttons
    // coexist on every row so dnd-kit did not accidentally replace the
    // a11y fallback.
    const grips = screen.getAllByTestId('block-grip');
    const moveUpButtons = screen.getAllByRole('button', { name: /move up/i });
    const moveDownButtons = screen.getAllByRole('button', {
      name: /move down/i,
    });
    expect(grips.length).toBeGreaterThan(0);
    expect(moveUpButtons.length).toBe(grips.length);
    expect(moveDownButtons.length).toBe(grips.length);
  });

  // ---------------------------------------------------------------------
  // pass 3 (item #3) — template functions cheat-sheet
  // ---------------------------------------------------------------------

  it('renders the template functions cheat-sheet for text blocks with every whitelisted function', () => {
    renderEditor();
    const list = screen.getByTestId('block-list');
    const textRow = within(list)
      .getAllByText(/text/i)
      .find(el => el.closest('[data-testid^="block-row-"]'));
    expect(textRow).toBeDefined();
    fireEvent.click(textRow!);

    const cheatsheet = screen.getByTestId('template-functions-cheatsheet');
    expect(cheatsheet).toBeInTheDocument();
    const text = cheatsheet.textContent ?? '';
    for (const name of [
      'currency',
      'date',
      'upper',
      'lower',
      'round',
      'limit',
      'concat',
      'default',
      'abs',
      'max',
      'min',
      'sum',
    ]) {
      expect(text, `cheat-sheet entry ${name}`).toContain(name + '(');
    }
  });

  it('does not render the cheat-sheet for non-text blocks', () => {
    renderEditor();
    const list = screen.getByTestId('block-list');
    const totalsRow = within(list)
      .getAllByText(/totals/i)
      .find(el => el.closest('[data-testid^="block-row-"]'));
    expect(totalsRow).toBeDefined();
    fireEvent.click(totalsRow!);
    expect(screen.queryByTestId('template-functions-cheatsheet')).not.toBeInTheDocument();
  });

  it('wires localized dnd-kit screen-reader instructions in English and Spanish', async () => {
    const { unmount } = renderEditor();
    await waitFor(() => {
      expect(screen.getByText(/To pick up a section, press space or enter/i)).toBeInTheDocument();
    });
    unmount();

    await i18next.changeLanguage('es');
    renderEditor();
    await waitFor(() => {
      expect(
        screen.getByText(/Para tomar una sección, presiona Espacio o Enter/i)
      ).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('block-grip')[0]).toHaveAttribute(
      'aria-label',
      'Arrastra la sección para reordenar'
    );
  });
});
