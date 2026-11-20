import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { render, screen, within } from '@/test/utils';
import { SiteQuickKeysEditor } from './SiteQuickKeysEditor';

type KeyRow = inferRouterOutputs<AppRouter>['quickKeys']['list'][number];

function keyRow(overrides: Partial<KeyRow> & Pick<KeyRow, 'id' | 'productId'>): KeyRow {
  return {
    position: 0,
    kind: 'product',
    productName: 'House Coffee',
    productSku: 'COFFEE-1',
    categoryId: null,
    sellable: true,
    unitId: null,
    unitAbbreviation: null,
    label: null,
    colour: 'orange',
    catalogPrice: 5,
    ...overrides,
  };
}

const state = vi.hoisted(() => ({
  keys: [] as unknown[],
  searches: [] as unknown[],
  savePending: false,
}));
const mutations = vi.hoisted(() => ({
  set: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  setData: vi.fn(),
}));

vi.mock('@/hooks', () => ({ useDebouncedValue: (value: string) => value }));

vi.mock('@/lib/trpc', () => {
  const mutation = (fn: (input: unknown) => unknown) => () => ({
    mutate: fn,
    isPending: fn === mutations.set && state.savePending,
  });
  return {
    trpc: {
      quickKeys: {
        list: { useQuery: () => ({ data: state.keys }) },
        set: { useMutation: mutation(mutations.set) },
        remove: { useMutation: mutation(mutations.remove) },
        reorder: { useMutation: mutation(mutations.reorder) },
      },
      products: {
        list: {
          useQuery: (input: { search?: string }) => {
            state.searches.push(input.search);
            return {
              isSuccess: true,
              data: {
                items: [{ id: 'p-bread', name: 'Fresh Bread', sku: 'BREAD-1', price: 3 }],
              },
            };
          },
        },
      },
      useUtils: () => ({ quickKeys: { list: { setData: mutations.setData } } }),
    },
  };
});

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const props = { siteId: 'site-1', onClose: vi.fn() };

describe('SiteQuickKeysEditor', () => {
  beforeEach(() => {
    Object.values(mutations).forEach(mock => mock.mockReset());
    state.searches = [];
    state.savePending = false;
    state.keys = [
      keyRow({ id: 'k-coffee', productId: 'p-coffee' }),
      keyRow({
        id: 'k-beef',
        kind: 'open_value',
        productId: 'p-beef',
        productName: 'Ground beef',
        productSku: 'BEEF-1',
        colour: null,
        position: 1,
      }),
      keyRow({
        id: 'k-retired',
        productId: 'p-retired',
        productName: 'Retired',
        productSku: 'OLD-1',
        sellable: false,
        position: 2,
      }),
    ];
  });

  it('names, colours, orders and removes the site keys', async () => {
    const user = userEvent.setup();
    render(<SiteQuickKeysEditor {...props} />);

    expect(screen.getByTestId('sales-quick-keys-count')).toHaveTextContent('3 of 8');
    const label = screen.getByRole('textbox', { name: 'Name on the key for House Coffee' });
    await user.type(label, 'Tinto{Enter}');
    expect(mutations.set).toHaveBeenLastCalledWith({
      siteId: 'site-1',
      id: 'k-coffee',
      kind: 'product',
      productId: 'p-coffee',
      unitId: null,
      label: 'Tinto',
    });

    const colours = screen.getByRole('group', { name: 'Colour of Ground beef' });
    expect(within(colours).getByRole('radio', { name: 'No colour' })).toBeChecked();
    await user.click(within(colours).getByRole('radio', { name: 'Violet' }));
    // Enter leaves the field, so the blur the colour click causes does not save the label again.
    expect(mutations.set.mock.calls.filter(([input]) => 'label' in input)).toHaveLength(1);
    expect(mutations.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'k-beef', kind: 'open_value', colour: 'violet' })
    );

    expect(screen.getByRole('button', { name: 'Move House Coffee earlier' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move House Coffee later' }));
    expect(mutations.reorder).toHaveBeenCalledWith({
      siteId: 'site-1',
      ids: ['k-beef', 'k-coffee', 'k-retired'],
    });

    await user.click(screen.getByRole('button', { name: 'Remove Ground beef' }));
    expect(mutations.remove).toHaveBeenCalledWith({ siteId: 'site-1', id: 'k-beef' });
  });

  it('steps over retired keys when moving and keeps rows usable while a label saves', async () => {
    state.keys = [
      keyRow({ id: 'k-a', productId: 'p-a', productName: 'Alpha', productSku: 'A-1' }),
      keyRow({
        id: 'k-old',
        productId: 'p-old',
        productName: 'Old',
        productSku: 'OLD-1',
        sellable: false,
      }),
      keyRow({ id: 'k-c', productId: 'p-c', productName: 'Gamma', productSku: 'C-1' }),
    ];
    state.savePending = true;
    const user = userEvent.setup();
    render(<SiteQuickKeysEditor {...props} />);

    const later = screen.getByRole('button', { name: 'Move Alpha later' });
    expect(later).toBeEnabled();
    await user.click(later);
    expect(mutations.reorder).toHaveBeenCalledWith({
      siteId: 'site-1',
      ids: ['k-old', 'k-c', 'k-a'],
    });
  });

  it('leaves a key whose product can no longer be sold removable only', () => {
    render(<SiteQuickKeysEditor {...props} />);
    const row = screen.getByTestId('sales-quick-keys-row-OLD-1-product');
    expect(row).toHaveTextContent('Not for sale');
    expect(within(row).getByRole('textbox')).toBeDisabled();
    expect(within(row).getByRole('radio', { name: 'Orange' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Remove Retired' })).toBeEnabled();
  });

  it('adds a product key or a key sold by amount from the catalog search', async () => {
    const user = userEvent.setup();
    render(<SiteQuickKeysEditor {...props} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'bread');
    expect(state.searches.at(-1)).toBe('bread');
    await user.click(screen.getByRole('button', { name: 'Add Fresh Bread as a key' }));
    expect(mutations.set).toHaveBeenCalledWith({ siteId: 'site-1', productId: 'p-bread' });
    await user.click(
      screen.getByRole('button', { name: 'Add Fresh Bread as a key sold by amount' })
    );
    expect(mutations.set).toHaveBeenCalledWith({
      siteId: 'site-1',
      productId: 'p-bread',
      kind: 'open_value',
    });
  });

  it('stops adding at eight keys and says why', () => {
    state.keys = Array.from({ length: 8 }, (_, index) =>
      keyRow({ id: `k${index}`, productId: `p-${index}`, productSku: `SKU-${index}` })
    );
    render(<SiteQuickKeysEditor {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('This site already has eight quick keys.');
    expect(screen.getByRole('button', { name: 'Add Fresh Bread as a key' })).toBeDisabled();
  });

  it('closes from Done', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SiteQuickKeysEditor {...props} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
