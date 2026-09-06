import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import {
  RestaurantModifierCatalogPage,
  type RestaurantCatalogEntry,
} from '../RestaurantModifierCatalogPage';
import { RestaurantModifierPicker } from '../RestaurantModifierPicker';

const h = vi.hoisted(() => ({
  save: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  query: vi.fn(),
  site: { id: 'site-a', name: 'North' },
}));
vi.mock('@/features/tenant/TenantProvider', () => ({ useTenant: () => ({ currentSite: h.site }) }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ restaurantModifiers: { invalidate: h.invalidate } }),
    restaurantModifiers: { list: { useQuery: h.query } },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: h.save, isPending: false }),
}));
const row: RestaurantCatalogEntry = {
  id: 'cheese',
  siteId: 'site-a',
  name: 'Cheese',
  unitPriceDelta: 2.5,
  maxQuantity: 2,
  requiresManager: false,
  isActive: true,
  version: 3,
};

describe('manager catalog and bounded picker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    h.site = { id: 'site-a', name: 'North' };
    h.query.mockReturnValue({
      data: { items: [row], nextOffset: null },
      isFetching: false,
      refetch: h.refetch,
    });
    h.save.mockResolvedValue({ ...row, version: 4 });
  });
  it('creates from labeled fields and submits a versioned archive without changing a historical price', async () => {
    render(<RestaurantModifierCatalogPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create add-on' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Add-on name'), { target: { value: 'Bacon' } });
    fireEvent.change(within(dialog).getByLabelText('Price per add-on'), {
      target: { value: '3.5' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        siteId: 'site-a',
        expectedVersion: 0,
        name: 'Bacon',
        unitPriceDelta: 3.5,
        maxQuantity: 1,
        requiresManager: false,
        isActive: true,
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Cheese' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Available for new orders'));
    expect(within(dialog).getByText(/Already accepted orders remain unchanged/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.save).toHaveBeenLastCalledWith({
        siteId: 'site-a',
        id: row.id,
        expectedVersion: 3,
        name: 'Cheese',
        unitPriceDelta: 2.5,
        maxQuantity: 2,
        requiresManager: false,
        isActive: false,
      })
    );
  });
  it('retains the entered price on conflict and makes return-to-list refresh explicit', async () => {
    h.save.mockRejectedValue({ data: { errorCode: 'RESTAURANT_MODIFIER_CHANGED' } });
    render(<RestaurantModifierCatalogPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Cheese' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Price per add-on'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('This add-on changed')
    );
    expect(within(dialog).getByLabelText('Price per add-on')).toHaveValue(5);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Return to list and review the current version' })
    );
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('clears an open editor on site change and translates actual EN/ES form labels', async () => {
    const view = render(<RestaurantModifierCatalogPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Cheese' }));
    h.site = { id: 'site-b', name: 'South' };
    view.rerender(<RestaurantModifierCatalogPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: 'site-b', offset: 0 }),
      expect.anything()
    );
    await act(() => i18n.changeLanguage('es'));
    fireEvent.click(screen.getByRole('button', { name: 'Crear adicional' }));
    expect(screen.getByLabelText('Nombre del adicional')).toBeVisible();
    expect(screen.getByLabelText('Precio por adicional')).toBeVisible();
  });
  it('renders only one page, disables restricted and selected choices, and sends the selected version unchanged', () => {
    h.query.mockReturnValue({
      data: {
        items: [row, { ...row, id: 'restricted', name: 'Wine', requiresManager: true }],
        nextOffset: 25,
      },
      isFetching: false,
    });
    const onSelect = vi.fn();
    render(
      <RestaurantModifierPicker
        siteId="site-a"
        canManage={false}
        selectedNames={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Wine/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Cheese/ }));
    expect(onSelect).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(h.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 25 }),
      expect.anything()
    );
  });
});
