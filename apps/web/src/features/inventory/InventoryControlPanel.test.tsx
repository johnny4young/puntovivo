import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { InventoryControlPanel } from './InventoryControlPanel';

const {
  invalidate,
  mutationCalls,
  mutationStates,
  pagination,
  queryErrors,
  queryInputs,
  useCriticalMutationMock,
} = vi.hoisted(() => ({
  invalidate: vi.fn().mockResolvedValue(undefined),
  mutationCalls: {} as Record<string, unknown[]>,
  pagination: {
    countTotalItems: 0,
    countTotalPages: 1,
    suggestionTotalItems: 2,
    suggestionTotalPages: 1,
  },
  queryErrors: {
    balances: null as unknown,
    sessions: null as unknown,
    suggestions: null as unknown,
    providers: null as unknown,
  },
  queryInputs: {
    balances: [] as Array<{ input: unknown; options: unknown }>,
    sessions: [] as unknown[],
    suggestions: [] as unknown[],
  },
  mutationStates: {} as Record<
    string,
    {
      options: { onSuccess?: (data: unknown) => void | Promise<void> } | undefined;
      result: {
        isPending: boolean;
        mutateAsync: (input: unknown) => Promise<unknown>;
        mutate: (input: unknown) => void;
      };
    }
  >,
  useCriticalMutationMock: vi.fn(),
}));

const now = '2026-08-31T10:00:00.000Z';
const countingSession = {
  id: 'count-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  siteName: 'Main Store',
  status: 'counting' as const,
  isBlind: true,
  notes: null,
  rejectionReason: null,
  createdBy: 'user-1',
  submittedBy: null,
  approvedBy: null,
  rejectedBy: null,
  submittedAt: null,
  approvedAt: null,
  rejectedAt: null,
  version: 0,
  syncStatus: 'pending' as const,
  syncVersion: 1,
  createdAt: now,
  updatedAt: now,
  lineCount: 2,
  countedLineCount: 0,
  discrepancyLineCount: null,
  lines: [
    {
      id: 'line-standard',
      tenantId: 'tenant-1',
      sessionId: 'count-1',
      productId: 'product-standard',
      productName: 'Rice',
      productSku: 'RICE-1',
      unitId: 'unit-1',
      unitName: 'Unit',
      unitAbbreviation: 'UND',
      expectedQuantity: null,
      countedQuantity: null,
      discrepancy: null,
      unitCostSnapshot: null,
      countedBy: null,
      countedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'line-variant',
      tenantId: 'tenant-1',
      sessionId: 'count-1',
      productId: 'product-variant',
      productName: 'Blue shirt M',
      productSku: 'SHIRT-BLUE-M',
      unitId: 'unit-1',
      unitName: 'Unit',
      unitAbbreviation: 'UND',
      expectedQuantity: null,
      countedQuantity: null,
      discrepancy: null,
      unitCostSnapshot: null,
      countedBy: null,
      countedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    },
  ],
};

const savedSession = {
  ...countingSession,
  version: 1,
  countedLineCount: 2,
  lines: countingSession.lines.map(line => ({ ...line, countedQuantity: 8, version: 1 })),
};

const balances = [
  {
    productId: 'product-standard',
    productName: 'Rice',
    productSku: 'RICE-1',
    onHand: 3,
    reserved: 0,
    available: 3,
    tracksLots: false,
    tracksSerials: false,
    catalogType: 'standard',
  },
  {
    productId: 'product-lot',
    productName: 'Lot medicine',
    productSku: 'LOT-1',
    onHand: 1,
    reserved: 0,
    available: 1,
    tracksLots: true,
    tracksSerials: false,
    catalogType: 'standard',
  },
  {
    productId: 'product-serial',
    productName: 'Serialized tablet',
    productSku: 'SERIAL-1',
    onHand: 1,
    reserved: 0,
    available: 1,
    tracksLots: false,
    tracksSerials: true,
    catalogType: 'standard',
  },
  {
    productId: 'product-variant',
    productName: 'Blue shirt M',
    productSku: 'SHIRT-BLUE-M',
    onHand: 2,
    reserved: 0,
    available: 2,
    tracksLots: false,
    tracksSerials: false,
    catalogType: 'variant',
  },
];
let balanceItems = balances;

const suggestions = [
  {
    productId: 'product-standard',
    productName: 'Rice',
    productSku: 'RICE-1',
    tracksLots: false,
    tracksSerials: false,
    catalogType: 'standard',
    minStock: 10,
    unitId: 'unit-1',
    unitName: 'Unit',
    unitAbbreviation: 'UND',
    initialCost: 4,
    onHand: 3,
    reserved: 0,
    available: 3,
    onOrder: 0,
    projectedAvailable: 3,
    suggestedQuantity: 7,
    canDraft: true,
    blockedReason: null,
  },
  {
    productId: 'product-lot',
    productName: 'Lot medicine',
    productSku: 'LOT-1',
    tracksLots: true,
    tracksSerials: false,
    catalogType: 'standard',
    minStock: 5,
    unitId: 'unit-1',
    unitName: 'Unit',
    unitAbbreviation: 'UND',
    initialCost: 2,
    onHand: 1,
    reserved: 0,
    available: 1,
    onOrder: 0,
    projectedAvailable: 1,
    suggestedQuantity: 4,
    canDraft: true,
    blockedReason: null,
  },
];

function mutationResult(key: string, input: unknown) {
  if (key === 'inventory.createCountSession') return countingSession;
  if (key === 'inventory.saveCountSession') return savedSession;
  if (key === 'inventory.submitCountSession') {
    return { ...savedSession, status: 'submitted', version: 2 };
  }
  if (key === 'orders.create') {
    return { id: 'order-draft-1', orderNumber: 'PED-000010', status: 'draft' };
  }
  return input;
}

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: useCriticalMutationMock,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventory: {
        getCountSession: { invalidate },
        listCountSessions: { invalidate },
        listMovements: { invalidate },
        listEntries: { invalidate },
        listStock: { invalidate },
        listBalancesBySite: { invalidate },
        listReplenishmentSuggestions: { invalidate },
      },
      products: { list: { invalidate }, search: { invalidate } },
      orders: { list: { invalidate }, getById: { invalidate } },
    }),
    inventory: {
      listBalancesBySite: {
        useQuery: (input: unknown, options: unknown) => {
          queryInputs.balances.push({ input, options });
          return {
            data: queryErrors.balances ? undefined : { items: balanceItems },
            isLoading: false,
            error: queryErrors.balances,
          };
        },
      },
      listCountSessions: {
        useQuery: (input: unknown) => {
          queryInputs.sessions.push(input);
          return {
            data: queryErrors.sessions
              ? undefined
              : {
                  items: [],
                  totalItems: pagination.countTotalItems,
                  totalPages: pagination.countTotalPages,
                },
            isLoading: false,
            error: queryErrors.sessions,
          };
        },
      },
      listReplenishmentSuggestions: {
        useQuery: (input: unknown) => {
          queryInputs.suggestions.push(input);
          return {
            data: queryErrors.suggestions
              ? undefined
              : {
                  items: suggestions,
                  totalItems: pagination.suggestionTotalItems,
                  totalPages: pagination.suggestionTotalPages,
                },
            isLoading: false,
            isFetching: false,
            error: queryErrors.suggestions,
            refetch: vi.fn(),
          };
        },
      },
      getCountSession: {
        useQuery: () => ({
          data: countingSession,
          isLoading: false,
          error: null,
        }),
      },
    },
    providers: {
      list: {
        useQuery: () => ({
          data: queryErrors.providers
            ? undefined
            : { items: [{ id: 'provider-1', name: 'Supplier', isActive: true }] },
          isLoading: false,
          error: queryErrors.providers,
        }),
      },
    },
  },
}));

describe('InventoryControlPanel', () => {
  beforeEach(() => {
    for (const key of Object.keys(mutationCalls)) delete mutationCalls[key];
    for (const key of Object.keys(mutationStates)) delete mutationStates[key];
    queryErrors.balances = null;
    queryErrors.sessions = null;
    queryErrors.suggestions = null;
    queryErrors.providers = null;
    balanceItems = balances;
    queryInputs.balances.length = 0;
    queryInputs.sessions.length = 0;
    queryInputs.suggestions.length = 0;
    pagination.countTotalItems = 0;
    pagination.countTotalPages = 1;
    pagination.suggestionTotalItems = suggestions.length;
    pagination.suggestionTotalPages = 1;
    invalidate.mockClear();
    useCriticalMutationMock.mockImplementation(
      (key: string, options?: { onSuccess?: (data: unknown) => void | Promise<void> }) => {
        const existing = mutationStates[key];
        if (existing) {
          existing.options = options;
          return existing.result;
        }
        mutationCalls[key] = [];
        const state: (typeof mutationStates)[string] = {
          options,
          result: {
            isPending: false,
            mutateAsync: async input => input,
            mutate: () => undefined,
          },
        };
        const mutateAsync = vi.fn(async (input: unknown) => {
          mutationCalls[key]!.push(input);
          const data = mutationResult(key, input);
          await state.options?.onSuccess?.(data);
          return data;
        });
        state.result = {
          isPending: false,
          mutateAsync,
          mutate: (input: unknown) => {
            void mutateAsync(input);
          },
        };
        mutationStates[key] = state;
        return state.result;
      }
    );
  });

  it('keeps blind quantities hidden and excludes only identity-unsafe rows', async () => {
    const user = userEvent.setup();
    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    await user.click(screen.getByRole('button', { name: 'New count' }));
    expect(screen.getByText('Expected stock stays hidden')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Lot medicine' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select Serialized tablet' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select Blue shirt M' })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select Rice' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Blue shirt M' }));
    await user.click(screen.getByRole('button', { name: 'Start count' }));
    await waitFor(() =>
      expect(mutationCalls['inventory.createCountSession']).toEqual([
        {
          siteId: 'site-1',
          productIds: ['product-standard', 'product-variant'],
          notes: undefined,
        },
      ])
    );

    expect(await screen.findByText('Blind mode is active')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Expected' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save progress' })).toBeDisabled();
    await user.type(screen.getByLabelText('Counted quantity for Rice'), '8');
    expect(screen.getByRole('button', { name: 'Save progress' })).toBeEnabled();
    await user.type(screen.getByLabelText('Counted quantity for Blue shirt M'), '6');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() =>
      expect(mutationCalls['inventory.saveCountSession']).toEqual([
        {
          id: 'count-1',
          version: 0,
          lines: [
            { lineId: 'line-standard', countedQuantity: 8, version: 0 },
            { lineId: 'line-variant', countedQuantity: 6, version: 0 },
          ],
        },
      ])
    );
    expect(mutationCalls['inventory.submitCountSession']).toEqual([{ id: 'count-1', version: 1 }]);
  });

  it('bounds the count selector DOM and lets search reach products beyond the first page', async () => {
    balanceItems = Array.from({ length: 101 }, (_, index) => ({
      ...balances[0]!,
      productId: `product-${index}`,
      productName: `Product ${index}`,
      productSku: `SKU-${index}`,
    }));
    const user = userEvent.setup();
    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    expect(queryInputs.balances.at(-1)).toEqual({
      input: { siteId: 'site-1' },
      options: { enabled: false },
    });
    await user.click(screen.getByRole('button', { name: 'New count' }));
    await waitFor(() =>
      expect(queryInputs.balances.at(-1)).toEqual({
        input: { siteId: 'site-1' },
        options: { enabled: true },
      })
    );
    const dialog = screen.getByRole('dialog', { name: 'Start blind count' });
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(100);
    expect(
      within(dialog).getByText(
        'Showing the first 100 products. Refine the search to find the rest.'
      )
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Products'), 'SKU-100');
    expect(within(dialog).getByRole('checkbox', { name: 'Select Product 100' })).toBeVisible();
    expect(
      within(dialog).queryByText(
        'Showing the first 100 products. Refine the search to find the rest.'
      )
    ).not.toBeInTheDocument();
  });

  it('creates only an explicit purchase-order draft from a suggestion', async () => {
    const user = userEvent.setup();
    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    expect(screen.getByText(/Nothing is ordered automatically/)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Lot medicine for a draft order' })
    ).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select Rice for a draft order' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Select Lot medicine for a draft order' })
    );
    expect(
      screen.getByText(/cannot be received until a manager explicitly submits it/)
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Provider'), 'provider-1');
    await user.click(screen.getByRole('button', { name: 'Create order draft' }));

    await waitFor(() =>
      expect(mutationCalls['orders.create']).toEqual([
        {
          providerId: 'provider-1',
          status: 'draft',
          items: [
            {
              productId: 'product-standard',
              unitId: 'unit-1',
              quantity: 7,
              costPerUnit: 4,
            },
            {
              productId: 'product-lot',
              unitId: 'unit-1',
              quantity: 4,
              costPerUnit: 2,
            },
          ],
          notes: 'Replenishment draft for Main Store',
        },
      ])
    );
  });

  it('pages count history and clears draft state before paging replenishment', async () => {
    pagination.countTotalItems = 26;
    pagination.countTotalPages = 2;
    pagination.suggestionTotalItems = 101;
    pagination.suggestionTotalPages = 2;
    const user = userEvent.setup();
    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select Rice for a draft order' }));
    await user.selectOptions(screen.getByLabelText('Provider'), 'provider-1');
    expect(screen.getByRole('button', { name: 'Create order draft' })).toBeEnabled();

    const nextButtons = screen.getAllByRole('button', { name: 'Next page' });
    expect(nextButtons).toHaveLength(2);
    await user.click(nextButtons[0]!);
    await waitFor(() =>
      expect(queryInputs.sessions).toContainEqual({ page: 2, perPage: 25, siteId: 'site-1' })
    );

    await user.click(screen.getAllByRole('button', { name: 'Next page' })[1]!);
    await waitFor(() =>
      expect(queryInputs.suggestions).toContainEqual({ page: 2, perPage: 100, siteId: 'site-1' })
    );
    expect(
      screen.getByRole('checkbox', { name: 'Select Rice for a draft order' })
    ).not.toBeChecked();
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
  });

  it('clears count and replenishment work when the active site changes', async () => {
    const user = userEvent.setup();
    const view = render(
      <InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Rice for a draft order' }));
    await user.selectOptions(screen.getByLabelText('Provider'), 'provider-1');
    await user.click(screen.getByRole('button', { name: 'New count' }));
    expect(screen.getByRole('dialog', { name: 'Start blind count' })).toBeVisible();

    view.rerender(<InventoryControlPanel currentSite={{ id: 'site-2', name: 'Second Store' }} />);

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Select Rice for a draft order' })
      ).not.toBeChecked()
    );
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Start blind count' })).not.toBeInTheDocument();
  });

  it('saves only quantities the counter actually entered', async () => {
    const user = userEvent.setup();
    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    await user.click(screen.getByRole('button', { name: 'New count' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Rice' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Blue shirt M' }));
    await user.click(screen.getByRole('button', { name: 'Start count' }));
    await user.type(await screen.findByLabelText('Counted quantity for Rice'), '4');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));

    await waitFor(() =>
      expect(mutationCalls['inventory.saveCountSession']).toEqual([
        {
          id: 'count-1',
          version: 0,
          lines: [{ lineId: 'line-standard', countedQuantity: 4, version: 0 }],
        },
      ])
    );
  });

  it('shows read failures instead of false empty or covered states', async () => {
    queryErrors.balances = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    queryErrors.sessions = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    queryErrors.suggestions = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    queryErrors.providers = { data: { code: 'INTERNAL_SERVER_ERROR' } };
    const user = userEvent.setup();

    render(<InventoryControlPanel currentSite={{ id: 'site-1', name: 'Main Store' }} />);

    expect(screen.getByText('Unable to load inventory counts.')).toBeInTheDocument();
    expect(screen.getByText('Unable to calculate replenishment suggestions.')).toBeInTheDocument();
    expect(
      screen.queryByText('No counts have been started for this site.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Every product with a configured minimum is covered at this site.')
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New count' }));
    expect(
      screen.getByText('Unable to load stock-tracked products for this site.')
    ).toBeInTheDocument();
  });
});
