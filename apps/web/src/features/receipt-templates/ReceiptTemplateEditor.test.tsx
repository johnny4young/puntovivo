/**
 * ENG-016 pass 1 — ReceiptTemplateEditor component tests.
 *
 * Covers:
 *  - Item #4: captions render above `itemsTable` + `totalsBlock` when
 *    those blocks are selected in the block list.
 *  - Item #5: `appFooter` block appears in the "add block" menu, and
 *    its form exposes the `show` toggle with the expected default.
 *  - Item #6: reordering a block via the `↑`/`↓` buttons triggers a
 *    FLIP snapshot capture — asserted via spying on the FLIP helper
 *    (jsdom cannot exercise the Web Animations API meaningfully so we
 *    pin the invocation contract).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import i18next from '@/i18n';
import { render } from '@/test/utils';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { ReceiptTemplateEditor } from './ReceiptTemplateEditor';

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
    },
  },
}));

vi.mock('@/lib/flipAnimate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flipAnimate')>(
    '@/lib/flipAnimate'
  );
  return {
    ...actual,
    captureFlipSnapshot: vi.fn(actual.captureFlipSnapshot),
    playFlip: vi.fn(actual.playFlip),
  };
});

import { captureFlipSnapshot, playFlip } from '@/lib/flipAnimate';

describe('ReceiptTemplateEditor (ENG-016 pass 1)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    vi.mocked(captureFlipSnapshot).mockClear();
    vi.mocked(playFlip).mockClear();
  });

  function renderEditor() {
    return render(
      <ToastProvider>
        <ReceiptTemplateEditor initial={null} onClose={() => {}} />
      </ToastProvider>
    );
  }

  // ---------------------------------------------------------------------
  // Item #4 — bindings captions
  // ---------------------------------------------------------------------

  it('shows the itemsTable caption when the itemsTable block is selected', () => {
    renderEditor();
    // Default sale preset has an itemsTable at index 9 (after header + separator).
    // Find the row with text "Items table" and click it to select.
    const list = screen.getByTestId('block-list');
    const itemsTableRow = within(list)
      .getAllByText(/items table/i)
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
});
