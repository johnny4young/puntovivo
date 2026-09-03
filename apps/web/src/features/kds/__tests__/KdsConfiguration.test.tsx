/** User-visible explicit routing and config edits carry their observed scope and generation. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { KitchenOutputs } from '../types';
import { KdsConfiguration } from '../KdsConfiguration';
const h = vi.hoisted(() => ({
  stations: [] as KitchenOutputs['stations'],
  targets: [] as KitchenOutputs['routingTargets']['items'],
  nextCursor: null as string | null,
  query: vi.fn(),
  saveStation: vi.fn(),
  saveRoute: vi.fn(),
  removeRoute: vi.fn(),
  error: false,
  debouncePending: false,
  invalidate: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: h.toast, error: h.toast }),
}));
vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: unknown) => (h.debouncePending ? '' : value),
}));
vi.mock('@/lib/trpc', () => {
  const mutation = (spy: (input: unknown) => void) => ({
    useMutation: (opts: { onSuccess?: () => void; onSettled: () => Promise<void> }) => ({
      isPending: false,
      mutate: (input: unknown) => {
        spy(input);
        opts.onSuccess?.();
        void opts.onSettled();
      },
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        kds: {
          stations: { invalidate: h.invalidate },
          routingTargets: { invalidate: h.invalidate },
        },
      }),
      kds: {
        stations: { useQuery: () => ({ data: h.stations, isError: h.error, isLoading: false }) },
        routingTargets: {
          useQuery: (input: unknown) => {
            h.query(input);
            return {
              data: { items: h.targets, nextCursor: h.nextCursor },
              isError: h.error,
              isLoading: false,
              isFetching: false,
            };
          },
        },
        saveStation: mutation(h.saveStation),
        saveRoutingRule: mutation(h.saveRoute),
        removeRoutingRule: mutation(h.removeRoute),
      },
    },
  };
});
beforeEach(async () => {
  vi.clearAllMocks();
  h.error = false;
  h.debouncePending = false;
  h.nextCursor = null;
  h.stations = [
    {
      id: 'station-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      code: 'hot',
      name: 'Grill',
      isActive: true,
      position: 2,
      version: 8,
      createdAt: '',
      updatedAt: '',
    },
  ];
  h.targets = [{ id: 'product-1', name: 'Soup', rule: null }];
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('kds');
});
describe('KdsConfiguration', () => {
  it('edits station names with immutable code and observed version', async () => {
    render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Grill' }));
    expect(screen.getByLabelText(/Code \(/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Station name'), { target: { value: 'Hot grill' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save station' }));
    });
    expect(h.saveStation).toHaveBeenCalledWith({
      siteId: 'site-1',
      code: 'hot',
      name: 'Hot grill',
      isActive: true,
      position: 2,
      expectedVersion: 8,
    });
    expect(h.invalidate).toHaveBeenCalled();
  });
  it('applies no route until explicit save, then sends the tenant-site catalog target', async () => {
    render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Soup'), { target: { value: 'station-1' } });
    expect(h.saveRoute).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save routing' }));
    });
    expect(h.saveRoute).toHaveBeenCalledWith({
      siteId: 'site-1',
      targetKind: 'product',
      targetId: 'product-1',
      expectedVersion: 0,
      expectedRuleId: null,
      route: 'station',
      stationId: 'station-1',
    });
  });
  it('removes an observed explicit exclusion to restore inheritance', async () => {
    h.targets = [
      {
        id: 'product-1',
        name: 'Soup',
        rule: { id: 'rule-1', version: 5, route: 'exclude', stationId: null },
      },
    ];
    render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Soup'), { target: { value: 'inherit' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save routing' }));
    });
    expect(h.removeRoute).toHaveBeenCalledWith({
      siteId: 'site-1',
      targetKind: 'product',
      targetId: 'product-1',
      expectedVersion: 5,
      expectedRuleId: 'rule-1',
    });
  });
  it('pages the bounded catalog and resets the cursor when search changes', () => {
    h.nextCursor = 'cursor-1';
    render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(h.query).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' }));
    fireEvent.change(screen.getByLabelText('Search by name or SKU'), {
      target: { value: 'new search' },
    });
    expect(h.query).toHaveBeenLastCalledWith({
      siteId: 'site-1',
      targetKind: 'product',
      search: 'new search',
      configuredOnly: false,
    });
  });
  it('blocks writes offline and on unreadable station data', () => {
    const view = render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
    expect(screen.getByRole('button', { name: 'Save station' })).toBeDisabled();
    h.error = true;
    view.rerender(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
  it('renders neutral Spanish copy and the mandatory default kitchen action', async () => {
    h.stations = [];
    await i18n.changeLanguage('es');
    render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Configuración de cocina');
    fireEvent.click(screen.getByRole('button', { name: 'Configurar cocina predeterminada' }));
    expect(screen.getByLabelText('Nombre de la estación')).toHaveValue('Cocina');
    expect(screen.getByLabelText('Activa')).toBeDisabled();
  });
});

it('uses an HTML unicode-sets pattern compatible with current Chromium', () => {
  render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
  const code = screen.getByLabelText(/Code \(/) as HTMLInputElement;
  const pattern = new RegExp(`^(?:${code.pattern})$`, 'v');
  expect(pattern.test('e2e-grill_1')).toBe(true);
  expect(pattern.test('Bad code')).toBe(false);
});

it('blocks editing the previous search results until the new search settles', () => {
  h.debouncePending = true;
  const view = render(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Search by name or SKU'), { target: { value: 'Soup' } });
  expect(screen.getByRole('combobox', { name: 'Soup' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save routing' })).toBeDisabled();
  h.debouncePending = false;
  view.rerender(<KdsConfiguration siteId="site-1" onClose={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: 'Soup' })).toBeEnabled();
});
