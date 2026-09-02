import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { InventoryTransformationsPanel } from './InventoryTransformationsPanel';

const createRecipeMutate = vi.fn(async () => undefined);
const updateRecipeMutate = vi.fn(async () => undefined);
const executeMutate = vi.fn(async () => undefined);
let recipeItems: Array<Record<string, unknown>> = [];
let historyItems: Array<Record<string, unknown>> = [];
let transformationDetails: Record<string, unknown> | undefined;
let historyError: unknown = null;
let detailsError: unknown = null;
let lotListError: unknown = null;
let recipeHasMore = false;
let recipeListError: unknown = null;
let recipeListInputs: Array<Record<string, unknown>> = [];
let historyListInputs: Array<Record<string, unknown>> = [];
let historyTotalItems: number | undefined;
let historyTotalPages: number | undefined;

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync:
      path === 'inventoryTransformations.createRecipe'
        ? createRecipeMutate
        : path === 'inventoryTransformations.updateRecipe'
          ? updateRecipeMutate
          : path === 'inventoryTransformations.execute'
            ? executeMutate
            : vi.fn(),
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

const invalidate = vi.fn(async () => undefined);

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventoryTransformations: {
        listRecipes: { invalidate },
        getRecipe: { invalidate },
        list: { invalidate },
        getById: { invalidate },
      },
      inventory: {
        listMovements: { invalidate },
        listBalancesBySite: { invalidate },
        listStock: { invalidate },
      },
      inventoryLots: { list: { invalidate } },
      products: { list: { invalidate }, search: { invalidate } },
    }),
    products: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'raw-product',
                name: 'Raw material',
                sku: 'RAW-1',
                tracksStock: true,
                tracksLots: false,
                tracksSerials: false,
                catalogType: 'standard',
                isActive: true,
              },
              {
                id: 'finished-product',
                name: 'Finished unit',
                sku: 'FIN-1',
                tracksStock: true,
                tracksLots: false,
                tracksSerials: false,
                catalogType: 'standard',
                isActive: true,
              },
            ],
          },
          isLoading: false,
          error: null,
        }),
      },
      search: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled
            ? {
                items: [
                  {
                    id: 'searched-product',
                    name: 'Catalog result',
                    sku: 'CAT-50000',
                    tracksStock: true,
                    tracksLots: false,
                    tracksSerials: false,
                    catalogType: 'standard',
                    isActive: true,
                  },
                  {
                    id: 'serialized-result',
                    name: 'Serialized result',
                    sku: 'SER-1',
                    tracksStock: true,
                    tracksLots: false,
                    tracksSerials: true,
                    catalogType: 'standard',
                    isActive: true,
                  },
                ],
              }
            : undefined,
          isLoading: false,
          error: null,
        }),
      },
    },
    inventoryTransformations: {
      listRecipes: {
        useQuery: (input: Record<string, unknown>) => {
          recipeListInputs.push(input);
          return {
            data: recipeListError ? undefined : { items: recipeItems, hasMore: recipeHasMore },
            isLoading: false,
            error: recipeListError,
          };
        },
      },
      list: {
        useQuery: (input: Record<string, unknown>) => {
          historyListInputs.push(input);
          return {
            data: historyError
              ? undefined
              : {
                  items: historyItems,
                  page: input.page,
                  perPage: input.perPage,
                  totalItems: historyTotalItems ?? historyItems.length,
                  totalPages: historyTotalPages ?? (historyItems.length === 0 ? 0 : 1),
                },
            isLoading: false,
            error: historyError,
          };
        },
      },
      getById: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled && !detailsError ? transformationDetails : undefined,
          isLoading: false,
          error: options.enabled ? detailsError : null,
        }),
      },
    },
    inventoryLots: {
      list: {
        useQuery: (input: { productId: string }) => ({
          data: lotListError
            ? undefined
            : {
                items:
                  input.productId === 'tracked-raw'
                    ? [
                        {
                          id: 'lot-a',
                          lotNumber: 'RAW-A',
                          expiresAt: null,
                          status: 'active',
                          onHand: 5,
                        },
                        {
                          id: 'lot-b',
                          lotNumber: 'RAW-B',
                          expiresAt: null,
                          status: 'active',
                          onHand: 5,
                        },
                        {
                          id: 'lot-invalid-expiry',
                          lotNumber: 'RAW-INVALID',
                          expiresAt: '2027-02-30',
                          status: 'active',
                          onHand: 5,
                        },
                      ]
                    : [],
              },
          isLoading: false,
          error: lotListError,
        }),
      },
    },
  },
}));

describe('InventoryTransformationsPanel', () => {
  beforeAll(async () => i18next.changeLanguage('en'));
  beforeEach(() => {
    recipeItems = [];
    historyItems = [];
    transformationDetails = undefined;
    historyError = null;
    detailsError = null;
    lotListError = null;
    recipeHasMore = false;
    recipeListError = null;
    recipeListInputs = [];
    historyListInputs = [];
    historyTotalItems = undefined;
    historyTotalPages = undefined;
    createRecipeMutate.mockClear();
    updateRecipeMutate.mockClear();
    executeMutate.mockClear();
  });

  it('creates a site-scoped recipe from the inventory UI', async () => {
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    expect(screen.getByText('No transformation recipes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    await user.type(screen.getByLabelText('Recipe name'), 'Assemble finished unit');
    await user.type(screen.getByLabelText('Find more catalog products'), 'CAT-50000');
    expect(
      await screen.findAllByRole('option', { name: 'Catalog result · CAT-50000' })
    ).toHaveLength(2);
    expect(
      screen.queryByRole('option', { name: 'Serialized result · SER-1' })
    ).not.toBeInTheDocument();
    const productSelects = screen.getAllByLabelText('Stock product');
    await user.selectOptions(productSelects[0]!, 'raw-product');
    await user.selectOptions(productSelects[1]!, 'searched-product');
    await user.click(screen.getByRole('button', { name: 'Save recipe' }));

    expect(createRecipeMutate).toHaveBeenCalledWith({
      siteId: 'site-1',
      name: 'Assemble finished unit',
      kind: 'assembly',
      notes: null,
      isActive: true,
      inputs: [{ productId: 'raw-product', baseQuantity: 1 }],
      outputs: [
        {
          productId: 'searched-product',
          expectedBaseQuantity: 1,
          allocationWeight: 1,
          role: 'primary',
        },
      ],
    });
  });

  it('shows recipe read failures instead of a false empty state', () => {
    recipeListError = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    render(<InventoryTransformationsPanel siteId="site-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The saved transformation recipes could not be loaded.'
    );
    expect(screen.queryByText('No transformation recipes')).not.toBeInTheDocument();
  });

  it('searches the bounded recipe list instead of silently hiding later recipes', async () => {
    recipeHasMore = true;
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    expect(screen.getByRole('status')).toHaveTextContent(/first 50 matching recipes/i);
    await user.type(screen.getByRole('searchbox', { name: 'Search saved recipes' }), 'Cable cut');
    await waitFor(() => {
      expect(recipeListInputs).toContainEqual(
        expect.objectContaining({ siteId: 'site-1', limit: 50, q: 'Cable cut' })
      );
    });
  });

  it('pages through the complete transformation history instead of hiding older executions', async () => {
    historyItems = [
      {
        id: 'transformation-50',
        recipeNameSnapshot: 'Current page transformation',
        status: 'completed',
        totalInputCost: 20,
        executedByName: 'Manager User',
        voidedAt: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        inputCount: 1,
        outputCount: 1,
      },
    ];
    historyTotalItems = 51;
    historyTotalPages = 2;
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    expect(screen.getByText('Showing 1-1 of 51')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(historyListInputs).toContainEqual({ page: 2, perPage: 50, siteId: 'site-1' });
    });
  });

  it('executes exact inputs and records waste against multiple consumed lots', async () => {
    recipeItems = [
      {
        id: 'tracked-recipe',
        siteId: null,
        name: 'Tracked preparation',
        kind: 'recipe',
        notes: null,
        isActive: true,
        version: 0,
        inputs: [
          {
            id: 'recipe-input',
            productId: 'tracked-raw',
            productName: 'Tracked raw',
            productSku: 'RAW-TRACKED',
            tracksLots: true,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            baseQuantity: 4,
          },
        ],
        outputs: [
          {
            id: 'recipe-output',
            productId: 'tracked-output',
            productName: 'Tracked output',
            productSku: 'OUT-TRACKED',
            tracksLots: true,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            expectedBaseQuantity: 3,
            allocationWeight: 1,
            role: 'primary',
          },
        ],
      },
    ];
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    await user.click(screen.getByRole('button', { name: 'Execute' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Execution notes')).toHaveAttribute('maxLength', '1000');
    expect(dialog.queryByLabelText('Quantity from lot RAW-INVALID')).not.toBeInTheDocument();

    await user.type(dialog.getByLabelText('Quantity from lot RAW-A'), '2');
    await user.type(dialog.getByLabelText('Quantity from lot RAW-B'), '2');

    const lotAInputs = dialog.getAllByLabelText('Quantity from lot RAW-A');
    const lotBInputs = dialog.getAllByLabelText('Quantity from lot RAW-B');
    expect(lotAInputs).toHaveLength(2);
    expect(lotBInputs).toHaveLength(2);
    await user.type(lotAInputs[1]!, '0.5');
    await user.type(lotBInputs[1]!, '0.25');
    await user.type(dialog.getByLabelText('Waste reason'), 'Preparation trim');
    await user.type(dialog.getByLabelText('New output lot'), 'OUT-NEW');
    await user.click(dialog.getByRole('button', { name: 'Execute' }));

    expect(executeMutate).toHaveBeenCalledWith({
      recipeId: 'tracked-recipe',
      siteId: 'site-1',
      inputs: [
        {
          recipeInputId: 'recipe-input',
          baseQuantity: 4,
          lotAllocations: [
            { lotId: 'lot-a', baseQuantity: 2 },
            { lotId: 'lot-b', baseQuantity: 2 },
          ],
        },
      ],
      outputs: [
        {
          recipeOutputId: 'recipe-output',
          baseQuantity: 3,
          allocationWeight: 1,
          lot: { lotNumber: 'OUT-NEW' },
        },
      ],
      waste: [
        {
          recipeInputId: 'recipe-input',
          lotId: 'lot-a',
          baseQuantity: 0.5,
          reason: 'Preparation trim',
        },
        {
          recipeInputId: 'recipe-input',
          lotId: 'lot-b',
          baseQuantity: 0.25,
          reason: 'Preparation trim',
        },
      ],
    });
  });

  it('shows lot read failures instead of a false no-lots state', async () => {
    lotListError = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    recipeItems = [
      {
        id: 'tracked-recipe-error',
        siteId: null,
        name: 'Tracked preparation error',
        kind: 'recipe',
        notes: null,
        isActive: true,
        version: 0,
        inputs: [
          {
            id: 'recipe-input-error',
            productId: 'tracked-raw',
            productName: 'Tracked raw',
            productSku: 'RAW-TRACKED',
            tracksLots: true,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            baseQuantity: 4,
          },
        ],
        outputs: [
          {
            id: 'recipe-output-error',
            productId: 'finished-product',
            productName: 'Finished unit',
            productSku: 'FIN-1',
            tracksLots: false,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            expectedBaseQuantity: 3,
            allocationWeight: 1,
            role: 'primary',
          },
        ],
      },
    ];
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    await user.click(screen.getByRole('button', { name: 'Execute' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('alert')).toHaveTextContent(
      'The available lots could not be loaded. Close this dialog and try again.'
    );
    expect(dialog.queryByText('No sellable lots are available.')).not.toBeInTheDocument();
    expect(
      dialog.queryByText('Allocate the consumed lots before recording lot-specific waste.')
    ).not.toBeInTheDocument();
  });

  it('preserves an all-sites recipe when editing it from a specific site', async () => {
    recipeItems = [
      {
        id: 'global-recipe',
        siteId: null,
        name: 'Global assembly',
        kind: 'assembly',
        notes: null,
        isActive: true,
        version: 3,
        inputs: [
          {
            id: 'global-input',
            productId: 'raw-product',
            productName: 'Raw material',
            productSku: 'RAW-1',
            tracksLots: false,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            baseQuantity: 1,
          },
        ],
        outputs: [
          {
            id: 'global-output',
            productId: 'finished-product',
            productName: 'Finished unit',
            productSku: 'FIN-1',
            tracksLots: false,
            tracksSerials: false,
            tracksStock: true,
            catalogType: 'standard',
            expectedBaseQuantity: 1,
            allocationWeight: 1,
            role: 'primary',
          },
        ],
      },
    ];
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Recipe is available at every site')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save recipe' }));

    expect(updateRecipeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'global-recipe', version: 3, siteId: null })
    );
  });

  it('opens the immutable execution detail with exact lot, cost, output and waste evidence', async () => {
    historyItems = [
      {
        id: 'transformation-1',
        siteId: 'site-1',
        siteName: 'Main Store',
        recipeId: 'recipe-1',
        recipeNameSnapshot: 'Cut tracked roll',
        kindSnapshot: 'cut',
        status: 'completed',
        totalInputCost: 20,
        totalOutputCost: 20,
        executedBy: 'user-1',
        executedByName: 'Manager User',
        voidedAt: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        inputCount: 1,
        outputCount: 1,
      },
    ];
    transformationDetails = {
      ...historyItems[0],
      tenantId: 'tenant-1',
      notes: 'Customer cut',
      voidedBy: null,
      voidReason: null,
      updatedAt: '2026-09-01T12:00:00.000Z',
      inputs: [
        {
          id: 'input-1',
          recipeInputId: 'recipe-input-1',
          productId: 'roll-1',
          productName: 'Steel cable roll',
          productSku: 'CABLE-ROLL',
          lotId: 'lot-1',
          lotNumber: 'ROLL-2026-A',
          expiresAt: '2030-01-01',
          sourceStatus: 'active',
          baseQuantity: 4,
          unitCost: 5,
          totalCost: 20,
        },
      ],
      outputs: [
        {
          id: 'output-1',
          recipeOutputId: 'recipe-output-1',
          productId: 'cut-1',
          productName: 'Cut cable',
          productSku: 'CABLE-CUT',
          lotId: 'lot-2',
          lotNumber: 'CUT-2026-A',
          expiresAt: null,
          role: 'primary',
          baseQuantity: 3,
          allocationWeight: 1,
          allocatedCost: 20,
          unitCost: 6.67,
          previousProductCost: 0,
          resultingProductCost: 6.67,
          resultingBalanceVersion: 1,
        },
      ],
      waste: [
        {
          id: 'waste-1',
          transformationInputId: 'input-1',
          baseQuantity: 1,
          reason: 'Saw trim',
        },
      ],
    };
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    await user.click(screen.getByRole('button', { name: 'Details' }));
    const details = screen.getByTestId('inventory-transformation-details');
    expect(within(details).getAllByText('ROLL-2026-A')).toHaveLength(2);
    expect(within(details).getByText(/active · expires/i)).toBeVisible();
    expect(within(details).getByText('CUT-2026-A')).toBeVisible();
    expect(within(details).getByText('Saw trim')).toBeVisible();
    expect(within(details).getByText('Customer cut')).toBeVisible();
    expect(within(details).getAllByText('$20.00')).toHaveLength(4);
  });

  it('clears a cancelled void reason before targeting another transformation', async () => {
    historyItems = [
      {
        id: 'transformation-1',
        recipeNameSnapshot: 'First transformation',
        status: 'completed',
        totalInputCost: 10,
        executedByName: 'Manager User',
        voidedAt: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        inputCount: 1,
        outputCount: 1,
      },
      {
        id: 'transformation-2',
        recipeNameSnapshot: 'Second transformation',
        status: 'completed',
        totalInputCost: 12,
        executedByName: 'Manager User',
        voidedAt: null,
        createdAt: '2026-09-01T13:00:00.000Z',
        inputCount: 1,
        outputCount: 1,
      },
    ];
    const user = userEvent.setup();
    render(<InventoryTransformationsPanel siteId="site-1" />);

    const first = screen.getByText('First transformation').closest('article');
    expect(first).not.toBeNull();
    await user.click(within(first!).getByRole('button', { name: 'Void' }));
    await user.type(screen.getByLabelText('Reason for voiding'), 'Wrong yield');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const second = screen.getByText('Second transformation').closest('article');
    expect(second).not.toBeNull();
    await user.click(within(second!).getByRole('button', { name: 'Void' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Reason for voiding')).toHaveValue('');
    expect(dialog.getByRole('button', { name: 'Void' })).toBeDisabled();
  });

  it('shows history read failures instead of a false empty state', () => {
    historyError = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    render(<InventoryTransformationsPanel siteId="site-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The transformation history could not be loaded.'
    );
    expect(
      screen.queryByText('No transformations have been executed at this site.')
    ).not.toBeInTheDocument();
  });
});
