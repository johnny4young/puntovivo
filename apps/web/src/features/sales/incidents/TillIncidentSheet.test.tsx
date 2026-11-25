import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { render, screen, within } from '@/test/utils';
import TillIncidentSheet from './TillIncidentSheet';

const state = vi.hoisted(() => ({
  latest: null as unknown,
  stock: {
    siteId: 's-norte',
    siteName: 'Norte',
    onHand: 0,
    otherSites: [{ siteId: 's-sur', siteName: 'Sur', onHand: 14 }],
  },
  search: [] as unknown[],
  stockLoading: false,
}));
const report = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const invalidateLatest = vi.hoisted(() => vi.fn());
const ensureStock = vi.hoisted(() => vi.fn());

vi.mock('@/features/sales/useProductPaletteResults', () => ({
  useProductPaletteResults: (query: string) => (query.trim().length >= 2 ? state.search : []),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    registerIncidents: {
      latestToday: { useQuery: () => ({ data: state.latest }) },
      productStock: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => ({
          data: opts.enabled && !state.stockLoading ? state.stock : undefined,
        }),
      },
      report: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown, opts?: { onSuccess?: () => void }) => {
            report(input);
            options?.onSuccess?.();
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      registerIncidents: {
        latestToday: { invalidate: invalidateLatest },
        productStock: { ensureData: ensureStock },
      },
    }),
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({ useToast: () => toast }));

const product = { id: 'p-milk', name: 'Leche UHT', price: 4900 };

/** A tile letter acts after the scanner gap, so a hand press waits it out. */
/** Enter after a pause, as a hand presses it; a burst Enter reads as the scanner's. */
async function pressEnterAfterTyping(user: ReturnType<typeof userEvent.setup>) {
  await act(() => new Promise(resolve => setTimeout(resolve, 40)));
  await user.keyboard('{Enter}');
}

async function pressTile(user: ReturnType<typeof userEvent.setup>, letter: string) {
  await user.keyboard(letter);
  await act(() => new Promise(resolve => setTimeout(resolve, 80)));
}

function renderSheet(overrides: Partial<Parameters<typeof TillIncidentSheet>[0]> = {}) {
  const props = {
    onClose: vi.fn(),
    ticketTotal: 30500,
    product,
    actions: {
      returns: vi.fn(),
      voidSale: vi.fn(),
      cashMovement: vi.fn(),
      reprint: vi.fn(),
    },
    ...overrides,
  };
  render(<TillIncidentSheet {...props} />);
  return props;
}

describe('TillIncidentSheet', () => {
  beforeEach(() => {
    report.mockReset();
    toast.success.mockReset();
    state.latest = null;
    state.search = [];
    state.stockLoading = false;
  });

  it('names the transfer even when Enter beats the stock read', async () => {
    const user = userEvent.setup();
    state.stockLoading = true;
    ensureStock.mockResolvedValue(state.stock);
    renderSheet();
    await pressTile(user, 'g');
    await user.keyboard('{Enter}');
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith({
        title: 'It is on Today, under «Before closing», with the transfer ready.',
      })
    );
    expect(ensureStock).toHaveBeenCalledWith({ productId: 'p-milk' });
  });

  it('leaves the keyboard to a dialog opened over the sheet', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    await pressTile(user, 'l');
    dialog.remove();
    expect(report).not.toHaveBeenCalled();
  });

  it('ignores a barcode scanned over the tiles, its letters and its closing Enter', async () => {
    const user = userEvent.setup({ delay: null });
    const props = renderSheet();
    await user.keyboard('L7702049000031{Enter}');
    await act(() => new Promise(resolve => setTimeout(resolve, 80)));
    expect(report).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.actions.returns).not.toHaveBeenCalled();
  });

  it('lists the nine incidents in three groups, each with its letter', () => {
    renderSheet();
    const sheet = screen.getByTestId('till-incident-sheet');
    expect(within(sheet).getByText('With the customer')).toBeInTheDocument();
    expect(within(sheet).getByText('With the product')).toBeInTheDocument();
    expect(within(sheet).getByText('With the register')).toBeInTheDocument();
    const letters = within(sheet)
      .getAllByRole('button')
      .filter(button => button.dataset.testid?.startsWith('till-incident-tile-'))
      .map(button => button.getAttribute('aria-keyshortcuts'));
    expect(letters).toEqual(['D', 'A', 'P', 'G', 'S', 'C', 'M', 'R', 'L']);
    expect(screen.getByTestId('till-incident-ticket')).toHaveTextContent(
      'The $30,500.00 sale stays intact on the left.'
    );
  });

  it('hands the register flows over and closes, from a tap or a letter', async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    await user.click(screen.getByTestId('till-incident-tile-returns'));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.actions.returns).toHaveBeenCalledOnce();

    await pressTile(user, 'm');
    expect(props.actions.cashMovement).toHaveBeenCalledOnce();
    await pressTile(user, 'r');
    expect(props.actions.reprint).toHaveBeenCalledOnce();
    await pressTile(user, 'a');
    expect(props.actions.voidSale).toHaveBeenCalledOnce();
  });

  it('leaves a flow unavailable when the register cannot run it', async () => {
    const user = userEvent.setup();
    const props = renderSheet({ actions: { returns: vi.fn() } });
    const tile = screen.getByTestId('till-incident-tile-cashMovement');
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    expect(tile).toHaveTextContent('Not available right now');
    await pressTile(user, 'm');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('closes on F9 so the key that opens the sheet also dismisses it', async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    await user.keyboard('{F9}');
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('reports a stockout of the last product in two keys and says where it lands', async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    await pressTile(user, 'g');
    expect(screen.getByTestId('till-incident-product')).toHaveTextContent(
      'Leche UHT0 at Norte · Sur has 14'
    );
    expect(screen.getByTestId('till-incident-reason-not_on_shelf')).toBeChecked();
    expect(screen.getByTestId('till-incident-submit')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(report).toHaveBeenCalledWith({
      kind: 'stockout',
      productId: 'p-milk',
      reason: 'not_on_shelf',
    });
    expect(toast.success).toHaveBeenCalledWith({
      title: 'It is on Today, under «Before closing», with the transfer ready.',
    });
    expect(invalidateLatest).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('sends from a reason chip with Enter', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pressTile(user, 'g');
    await user.click(screen.getByTestId('till-incident-reason-expired'));
    await user.keyboard('{Enter}');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ reason: 'expired' }));
  });

  it('asks the shelf price for a price mismatch and shows the till price', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pressTile(user, 'c');
    expect(screen.getByTestId('till-incident-product')).toHaveTextContent('Till price $4,900.00');
    expect(screen.getByTestId('till-incident-submit')).toBeDisabled();
    await user.type(screen.getByTestId('till-incident-shelf-price'), '4500');
    await pressEnterAfterTyping(user);
    expect(report).toHaveBeenCalledWith({
      kind: 'price_mismatch',
      productId: 'p-milk',
      shelfPrice: 4500,
    });
    expect(toast.success).toHaveBeenCalledWith({
      title: 'It is on Today, under «Before closing».',
    });
  });

  it('describes an item without barcode and sends no product unless one is linked', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pressTile(user, 's');
    expect(screen.getByTestId('till-incident-submit')).toBeDisabled();
    await user.type(screen.getByTestId('till-incident-note'), '  Hielo 2 kg ');
    await pressEnterAfterTyping(user);
    expect(report).toHaveBeenCalledWith({ kind: 'no_barcode', note: 'Hielo 2 kg' });
  });

  it('asks which catalog product an unlabeled item is instead of assuming the last line', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pressTile(user, 's');
    await user.click(screen.getByTestId('till-incident-link-product'));
    expect(screen.queryByTestId('till-incident-product')).not.toBeInTheDocument();
    expect(screen.getByTestId('till-incident-product-search-input')).toHaveFocus();
  });

  it('picks another product from the search when the last one is not the subject', async () => {
    const user = userEvent.setup();
    state.search = [{ id: 'p-bread', name: 'Pan tajado', price: 5400, sku: 'PAN-1' }];
    renderSheet({ product: null });
    await pressTile(user, 'g');
    await user.type(screen.getByTestId('till-incident-product-search-input'), 'pan');
    await user.click(screen.getByRole('button', { name: /Pan tajado/ }));
    expect(screen.getByTestId('till-incident-product')).toHaveTextContent('Pan tajado');
    await user.click(screen.getByTestId('till-incident-submit'));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p-bread' }));
  });

  it('checks a price without adding anything to the sale', async () => {
    const user = userEvent.setup();
    state.search = [
      { id: 'p-bread', name: 'Pan tajado', price: 5400, sku: 'PAN-1', siteStock: 6, stock: 9 },
    ];
    renderSheet();
    await pressTile(user, 'p');
    await user.type(screen.getByTestId('till-incident-price-input'), 'pan');
    const result = screen.getByTestId('till-incident-price-result');
    expect(result).toHaveTextContent('Pan tajado');
    expect(result).toHaveTextContent('PAN-1 · 6 in stock');
    expect(result).toHaveTextContent('$5,400.00');
    expect(within(result).queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls the manager in one key and goes back to selling', async () => {
    const user = userEvent.setup();
    const props = renderSheet();
    await pressTile(user, 'l');
    expect(report).toHaveBeenCalledWith({ kind: 'call_manager' });
    expect(toast.success).toHaveBeenCalledWith({ title: 'The manager sees your call on Pending.' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('goes back to the tiles from a step', async () => {
    const user = userEvent.setup();
    renderSheet();
    await pressTile(user, 'g');
    await user.click(screen.getByTestId('till-incident-back'));
    expect(screen.getByTestId('till-incident-tile-stockout')).toBeInTheDocument();
  });

  it("names today's last incident with its register", () => {
    state.latest = {
      id: 'i-1',
      kind: 'stockout',
      productName: 'Leche UHT',
      note: null,
      createdAt: '2026-11-20T15:37:00.000Z',
      registerName: 'Caja 1',
    };
    renderSheet();
    expect(screen.getByTestId('till-incident-latest')).toHaveTextContent(
      /^Today's last incident: Out of stock · Leche UHT · .+ · Caja 1$/
    );
  });
});
