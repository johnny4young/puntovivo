import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import {
  RestaurantModifierGroupsPanel,
  type RestaurantModifierGroup,
} from '../RestaurantModifierGroupsPanel';
import { RestaurantModifierCatalogPage } from '../RestaurantModifierCatalogPage';

const h = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  groups: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-a', name: 'North' } }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      restaurantModifiers: { invalidate: h.invalidate, groups: { invalidate: h.invalidate } },
    }),
    restaurantModifiers: { list: { useQuery: h.list }, groups: { useQuery: h.groups } },
    products: { search: { useQuery: h.search } },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: h.save, isPending: false }),
}));

const option = (id: string, name: string, unitPriceDelta = 0) => ({
  id,
  siteId: 'site-a',
  name,
  unitPriceDelta,
  maxQuantity: 1,
  requiresManager: false,
  isActive: true,
  version: 1,
});
const extras: RestaurantModifierGroup = {
  id: 'extras',
  siteId: 'site-a',
  name: 'Adicionales',
  kind: 'extra',
  selection: 'multiple',
  minSelections: 0,
  maxSelections: 2,
  isActive: true,
  version: 4,
  options: [
    {
      groupId: 'extras',
      position: 0,
      catalogId: 'avocado',
      name: 'Aguacate',
      unitPriceDelta: 4000,
      maxQuantity: 1,
      requiresManager: false,
      isActive: true,
      version: 1,
    },
  ],
  products: [{ id: 'bandeja', name: 'Bandeja paisa' }],
};

describe('modifier groups editor', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    h.groups.mockReturnValue({ data: [extras], isFetching: false, refetch: vi.fn() });
    h.list.mockReturnValue({
      data: {
        items: [
          option('medio', 'Medium'),
          option('tres', 'Medium well'),
          option('avocado', 'Aguacate', 4000),
        ],
        nextOffset: null,
      },
      isFetching: false,
      refetch: vi.fn(),
    });
    h.search.mockReturnValue({ data: { items: [{ id: 'churrasco', name: 'Churrasco' }] } });
    h.save.mockResolvedValue({ id: 'new' });
  });

  it('shows each group as name and rule, its option chips and its dishes', () => {
    render(<RestaurantModifierGroupsPanel siteId="site-a" />);
    const card = screen.getByTestId('modifier-group-card');
    expect(within(card).getByRole('heading')).toHaveTextContent('Adicionales · Up to 2');
    expect(within(card).getByText('Aguacate').closest('li')).toHaveClass('modifier-option');
    expect(card).toHaveTextContent('Extras · Bandeja paisa');
  });

  it('creates a required single choice with ordered options and dishes', async () => {
    render(<RestaurantModifierGroupsPanel siteId="site-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Group name'), {
      target: { value: 'Doneness' },
    });
    expect(within(dialog).getByRole('button', { name: 'Preparation' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(dialog).getByLabelText('Required')).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Medium$/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Medium well/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Medium well up' }));
    fireEvent.change(within(dialog).getByLabelText('Search dishes to add'), {
      target: { value: 'chu' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Churrasco/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        siteId: 'site-a',
        expectedVersion: 0,
        name: 'Doneness',
        kind: 'choice',
        selection: 'single',
        minSelections: 1,
        maxSelections: 1,
        isActive: true,
        catalogIds: ['tres', 'medio'],
        productIds: ['churrasco'],
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Group saved');
  });

  it('edits a versioned group and keeps the maximum within its options', async () => {
    render(<RestaurantModifierGroupsPanel siteId="site-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Adicionales' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Several' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Bandeja paisa' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'extras',
          expectedVersion: 4,
          minSelections: 0,
          maxSelections: 1,
          catalogIds: ['avocado'],
          productIds: [],
        })
      )
    );
  });

  it('keeps a typed minimum within the maximum so the form still submits', async () => {
    render(<RestaurantModifierGroupsPanel siteId="site-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Adicionales' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Required'));
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith(
        expect.objectContaining({ minSelections: 1, maxSelections: 1 })
      )
    );
  });

  it('switches the catalog page between options and groups', async () => {
    render(<RestaurantModifierCatalogPage />);
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Create add-on' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    expect(await screen.findByTestId('modifier-groups-panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Groups' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Create add-on' })).not.toBeInTheDocument();
  });
});
