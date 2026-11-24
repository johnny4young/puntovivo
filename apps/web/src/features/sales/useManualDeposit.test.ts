import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mutationOptions: null as
    | null
    | {
        onSuccess?: (result: unknown) => void;
        onError?: (error: unknown) => void;
      },
  mutation: { mutate: vi.fn(), isPending: false, error: null as unknown },
  queryOptions: null as null | { enabled?: boolean },
  query: {
    data: undefined as unknown[] | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  invalidateHistory: vi.fn(),
  invalidateReconciliation: vi.fn(),
  user: { id: 'user-1', role: 'manager' } as { id: string; role: string } | null,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payments: {
        pendingTransfers: { invalidate: state.invalidateHistory },
        transferReconciliation: { invalidate: state.invalidateReconciliation },
      },
    }),
    payments: {
      registerManualDeposit: {
        useMutation: (options: {
          onSuccess?: (result: unknown) => void;
          onError?: (error: unknown) => void;
        }) => {
          state.mutationOptions = options;
          return state.mutation;
        },
      },
      pendingTransfers: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          state.queryOptions = options;
          return state.query;
        },
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: state.user }),
}));

import { useManualDeposit, type ManualDepositTender } from './useManualDeposit';

const tender: ManualDepositTender = {
  saleId: 'sale-1',
  salePaymentId: 'pay-1',
  saleNumber: 'V-000123',
  expectedAmount: 100,
  reference: 'RB-77',
  confirmationStatus: 'customer_reported',
  destination: { id: 'dest-1', label: 'Bancolombia', kind: 'bank' },
};

const partialDeposit = {
  reference: 'REF-501',
  verifiedAmount: 40,
  valueDate: '2026-11-20',
  note: 'Partial deposit',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    salePaymentId: 'pay-1',
    saleId: 'sale-1',
    saleNumber: 'V-000123',
    siteId: 'site-1',
    amount: 100,
    reference: 'RB-77',
    confirmationStatus: 'needs_reconciliation',
    confirmationSource: 'operator',
    confirmedAt: '2026-11-20T14:00:00.000Z',
    destinationSnapshot: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  };
}

function mount(options: { enabled?: boolean; siteId?: string; onDeposited?: () => void } = {}) {
  const siteId = options.siteId ?? 'site-1';
  return renderHook(
    ({ tenderArg }: { tenderArg: ManualDepositTender }) =>
      useManualDeposit({
        siteId,
        tender: tenderArg,
        ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
        ...(options.onDeposited ? { onDeposited: options.onDeposited } : {}),
      }),
    { initialProps: { tenderArg: tender } }
  );
}

describe('useManualDeposit', () => {
  beforeEach(() => {
    state.mutationOptions = null;
    state.mutation.mutate.mockReset();
    state.mutation.isPending = false;
    state.queryOptions = null;
    state.query.data = undefined;
    state.query.isLoading = false;
    state.query.isError = false;
    state.query.refetch.mockReset();
    state.invalidateHistory.mockReset();
    state.invalidateReconciliation.mockReset();
    state.user = { id: 'user-1', role: 'manager' };
  });

  it('sends exactly the entered amount and predicts no money of its own', () => {
    const { result } = mount();

    act(() => result.current.submit(partialDeposit));

    expect(state.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutation.mutate.mock.calls[0]?.[0]).toEqual({
      siteId: 'site-1',
      saleId: 'sale-1',
      salePaymentId: 'pay-1',
      verifiedAmount: 40,
      reference: 'REF-501',
      valueDate: '2026-11-20',
      note: 'Partial deposit',
      idempotencyKey: expect.any(String),
    });
    // Neither the applied amount nor the status is guessed before the server
    // answers: there is no local accumulation to render.
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('reports the accumulated state the server answered, untouched', () => {
    const onDeposited = vi.fn();
    const { result } = mount({ onDeposited });
    const answer = { appliedAmount: 120, surplusAmount: 20, status: 'needs_reconciliation' };

    act(() => state.mutationOptions?.onSuccess?.(answer));

    // 120 is the server's accumulated figure for a 40 deposit: the hook hands
    // the object through instead of adding anything up.
    expect(result.current.result).toEqual(answer);
    expect(onDeposited).toHaveBeenCalledWith(answer);
    expect(state.invalidateHistory).toHaveBeenCalledTimes(1);
    expect(state.invalidateReconciliation).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed deposit and keeps the last confirmed answer', () => {
    const { result } = mount();
    const answer = { appliedAmount: 40, surplusAmount: 0, status: 'needs_reconciliation' };

    act(() => state.mutationOptions?.onSuccess?.(answer));
    act(() => state.mutationOptions?.onError?.(new Error('Transfer tender not found')));

    expect(result.current.error).toContain('Transfer tender not found');
    expect(result.current.result).toEqual(answer);
  });

  it('refuses the deposit for a role the server does not authorise', () => {
    state.user = { id: 'user-2', role: 'cashier' };
    const { result } = mount();

    expect(result.current.canDeposit).toBe(false);
    act(() => result.current.submit(partialDeposit));
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('does not fire a second deposit while the first one is in flight', () => {
    state.mutation.isPending = true;
    const { result } = mount();

    expect(result.current.isSubmitting).toBe(true);
    act(() => result.current.submit(partialDeposit));
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('reads the history from the server and scopes it to this sale', () => {
    state.query.data = [
      row({ appliedAmount: 40, surplusAmount: 0 }),
      row({ saleId: 'sale-2', salePaymentId: 'pay-2' }),
      // A row from a server that does not send the additive fields yet.
      row({ salePaymentId: 'pay-3' }),
    ];
    const { result } = mount();

    expect(result.current.history.rows.map(item => item.salePaymentId)).toEqual([
      'pay-1',
      'pay-3',
    ]);
    expect(result.current.history.rows[0]?.appliedAmount).toBe(40);
    expect(result.current.history.rows[1]?.appliedAmount).toBeUndefined();
  });

  it('forwards the server read state and the refetch the surface offers', () => {
    state.query.data = [];
    state.query.isLoading = true;
    state.query.isError = true;
    const { result } = mount();

    expect(result.current.history.isLoading).toBe(true);
    expect(result.current.history.isError).toBe(true);
    act(() => result.current.history.refetch());
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not read the history until the owner enables it', () => {
    mount({ enabled: false });
    expect(state.queryOptions?.enabled).toBe(false);
  });

  it('drops the previous answer when the target tender changes', () => {
    const { result, rerender } = mount();
    act(() =>
      state.mutationOptions?.onSuccess?.({
        appliedAmount: 40,
        surplusAmount: 0,
        status: 'needs_reconciliation',
      })
    );
    expect(result.current.result?.appliedAmount).toBe(40);

    rerender({ tenderArg: { ...tender, salePaymentId: 'pay-2' } });

    // A deposit recorded on another tender is not this tender's state.
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
