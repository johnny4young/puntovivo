import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const tableStateMock = vi.fn();
const regroupMutate = vi.fn();
const splitEqualMutate = vi.fn();
const splitSharedMutate = vi.fn();
const invalidateTableState = vi.fn();
type MutationOpts = {
  onSuccess?: (data: unknown, variables: unknown) => Promise<void> | void;
};
let regroupOptions: MutationOpts = {};
let splitEqualOptions: MutationOpts = {};
let splitSharedOptions: MutationOpts = {};

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string, options: MutationOpts) => {
    if (path === 'restaurantServices.splitEqual') {
      splitEqualOptions = options;
      return { mutate: splitEqualMutate, isPending: false };
    }
    if (path === 'restaurantServices.splitSharedLine') {
      splitSharedOptions = options;
      return { mutate: splitSharedMutate, isPending: false };
    }
    regroupOptions = options;
    return { mutate: regroupMutate, isPending: false };
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    restaurantServices: { getTableState: { useQuery: () => tableStateMock() } },
    useUtils: () => ({
      sales: { listDrafts: { invalidate: vi.fn() } },
      restaurantTables: {
        listWithDraftStatus: { invalidate: vi.fn() },
        listSummary: { invalidate: vi.fn() },
      },
      restaurantServices: { getTableState: { invalidate: invalidateTableState } },
    }),
  },
}));

import { RestaurantSplitSheet } from '../RestaurantSplitSheet';

function line(saleItemId: string, dinerId: string | null, total: number, quantity = 1) {
  return {
    id: `line-${saleItemId}`,
    saleItemId,
    dinerId,
    productName: `Plato ${saleItemId}`,
    quantity,
    total,
  };
}

function check(id: string, lines: ReturnType<typeof line>[], suspendedAt: string | null = 'x') {
  return {
    id,
    version: 1,
    saleId: `sale-${id}`,
    saleNumber: `VTA-${id}`,
    label: 'Mesa 7',
    suspendedAt,
    total: lines.reduce((sum, row) => sum + row.total, 0),
    lines,
  };
}

function mockTable(checks: ReturnType<typeof check>[]) {
  tableStateMock.mockReturnValue({
    data: {
      service: { id: 'service-1' },
      diners: [1, 2, 3, 4].map(seat => ({ id: `d-${seat}`, seatNumber: seat })),
      checks,
    },
    isLoading: false,
    isError: false,
  });
}

describe('RestaurantSplitSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('es');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTable([
      check('c-1', [line('a', 'd-1', 32_000), line('b', 'd-2', 18_000, 2)]),
      check('c-2', [line('c', 'd-3', 46_000), line('d', null, 12_000)]),
    ]);
  });

  it('shows each account with its diners, total and charge button', () => {
    const onCharge = vi.fn();
    render(
      <RestaurantSplitSheet
        tableId="t-7"
        tableName="Mesa 7"
        onClose={vi.fn()}
        onCharge={onCharge}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Mesa 7 · dividir cuenta' })).toBeInTheDocument();
    const [first, second] = screen.getAllByTestId('split-sheet-account');
    expect(first).toHaveAccessibleName('Cuenta 1 · C1 y C2');
    expect(second).toHaveAccessibleName('Cuenta 2 · C3 y mesa');
    expect(within(first!).getByText('2 Plato b')).toBeInTheDocument();

    fireEvent.click(within(second!).getByRole('button', { name: 'Cobrar cuenta 2' }));
    expect(onCharge).toHaveBeenCalledWith({
      id: 'sale-c-2',
      tableId: 't-7',
      label: 'Mesa 7',
      suspendedAt: 'x',
      resumedDeviceId: null,
    });
  });

  it('moves a plate to the other account with every line in the plan', () => {
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pasar Plato a a la cuenta 2' }));
    expect(regroupMutate).toHaveBeenCalledWith({
      tableId: 't-7',
      checks: [
        { checkId: 'c-1', version: 1 },
        { checkId: 'c-2', version: 1 },
      ],
      plan: {
        kind: 'accounts',
        accounts: [
          { checkId: 'c-1', saleItemIds: ['b'] },
          { checkId: 'c-2', saleItemIds: ['c', 'd', 'a'] },
        ],
      },
    });
    expect(screen.queryByTestId('split-sheet-charge')).not.toBeInTheDocument();
  });

  it('lets a middle account send a plate either way and hides arrows with one account', () => {
    mockTable([
      check('c-1', [line('a', 'd-1', 1_000)]),
      check('c-2', [line('b', 'd-2', 1_000)]),
      check('c-3', [line('c', 'd-3', 1_000)]),
    ]);
    const view = render(
      <RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />
    );
    const middle = screen.getAllByTestId('split-sheet-account')[1]!;
    expect(
      within(middle).getByRole('button', { name: 'Pasar Plato b a la cuenta 1' })
    ).toBeInTheDocument();
    fireEvent.click(within(middle).getByRole('button', { name: 'Pasar Plato b a la cuenta 3' }));
    expect(regroupMutate.mock.calls[0]![0].plan.accounts).toEqual([
      { checkId: 'c-1', saleItemIds: ['a'] },
      { checkId: 'c-2', saleItemIds: [] },
      { checkId: 'c-3', saleItemIds: ['c', 'b'] },
    ]);
    view.unmount();

    mockTable([check('c-1', [line('a', 'd-1', 1_000), line('b', 'd-2', 1_000)])]);
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);
    expect(screen.queryByTestId('split-sheet-move')).not.toBeInTheDocument();
  });

  it('regroups by diner in one tap', () => {
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('split-sheet-by-diner'));
    expect(regroupMutate).toHaveBeenCalledWith({
      tableId: 't-7',
      checks: [
        { checkId: 'c-1', version: 1 },
        { checkId: 'c-2', version: 1 },
      ],
      plan: { kind: 'byDiner' },
    });
  });

  it('opens another account that becomes real with its first plate', async () => {
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('split-sheet-add-account'));
    const accounts = screen.getAllByTestId('split-sheet-account');
    expect(accounts).toHaveLength(3);
    expect(accounts[2]).toHaveAccessibleName('Cuenta 3');

    fireEvent.click(
      within(accounts[1]!).getByRole('button', { name: 'Pasar Plato d a la cuenta 3' })
    );
    const variables = regroupMutate.mock.calls[0]![0];
    expect(variables.plan.accounts.at(-1)).toEqual({ checkId: null, saleItemIds: ['d'] });

    await act(async () => {
      await regroupOptions.onSuccess?.({ checks: [], cancelledCheckIds: [] }, variables);
    });
    await waitFor(() => expect(screen.getAllByTestId('split-sheet-account')).toHaveLength(2));
  });

  it('locks every regroup while a register holds one of the checks', () => {
    mockTable([
      check('c-1', [line('a', 'd-1', 1_000), line('b', 'd-2', 1_000)]),
      check('c-2', [line('c', 'd-3', 1_000)], null),
    ]);
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);
    expect(screen.getByTestId('split-sheet-in-use')).toHaveTextContent(
      'Una de las cuentas está abierta en una caja'
    );
    for (const button of screen.getAllByTestId('split-sheet-move')) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByTestId('split-sheet-by-diner')).toBeDisabled();
    expect(screen.getByTestId('split-sheet-add-account')).toBeDisabled();
  });

  it('splits a single check equally into N parts (Total / N)', async () => {
    mockTable([check('c-1', [line('a', 'd-1', 30_000), line('b', 'd-2', 15_000)])]);
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);

    const partsInput = screen.getByTestId('split-sheet-equal-parts');
    fireEvent.change(partsInput, { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('split-sheet-equal-apply'));

    expect(splitEqualMutate).toHaveBeenCalledWith({
      tableId: 't-7',
      checkId: 'c-1',
      expectedCheckVersion: 1,
      parts: 3,
    });

    await act(async () => {
      await splitEqualOptions.onSuccess?.({ checks: [] }, { parts: 3 });
    });
    expect(invalidateTableState).toHaveBeenCalled();
  });

  it('shares a dish equally across selected open accounts', async () => {
    render(<RestaurantSplitSheet tableId="t-7" tableName="Mesa 7" onClose={vi.fn()} />);

    const shareButtons = screen.getAllByTestId('split-sheet-share-dish');
    fireEvent.click(shareButtons[0]!);
    expect(screen.getByTestId('split-sheet-share-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('split-sheet-share-confirm'));
    expect(splitSharedMutate).toHaveBeenCalledWith({
      tableId: 't-7',
      saleItemId: 'a',
      targetCheckIds: ['c-1', 'c-2'],
      checks: [
        { checkId: 'c-1', version: 1 },
        { checkId: 'c-2', version: 1 },
      ],
    });

    await act(async () => {
      await splitSharedOptions.onSuccess?.({ checks: [] }, { targetCheckIds: ['c-1', 'c-2'] });
    });
    expect(screen.queryByTestId('split-sheet-share-bar')).not.toBeInTheDocument();
  });
});
