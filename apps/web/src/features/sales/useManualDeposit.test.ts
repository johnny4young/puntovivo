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
    isFetching: false,
    isError: false,
    error: null as unknown,
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

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    state.query.isFetching = false;
    state.query.isError = false;
    state.query.error = null;
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

  it('reports the accumulated state the server answered, untouched', async () => {
    const onDeposited = vi.fn();
    const { result } = mount({ onDeposited });
    const answer = { appliedAmount: 120, surplusAmount: 20, status: 'needs_reconciliation' };

    await act(async () => {
      state.mutationOptions?.onSuccess?.(answer);
    });

    // 120 is the server's accumulated figure for a 40 deposit: the hook hands
    // the object through instead of adding anything up.
    expect(result.current.result).toEqual(answer);
    expect(onDeposited).toHaveBeenCalledWith(answer);
    expect(state.invalidateHistory).toHaveBeenCalledTimes(1);
    expect(state.invalidateReconciliation).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed deposit and keeps the last confirmed answer', async () => {
    const { result } = mount();
    const answer = { appliedAmount: 40, surplusAmount: 0, status: 'needs_reconciliation' };

    await act(async () => {
      state.mutationOptions?.onSuccess?.(answer);
    });
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

  it('drops the previous answer when the target tender changes', async () => {
    const { result, rerender } = mount();
    await act(async () => {
      state.mutationOptions?.onSuccess?.({
        appliedAmount: 40,
        surplusAmount: 0,
        status: 'needs_reconciliation',
      });
    });
    expect(result.current.result?.appliedAmount).toBe(40);

    rerender({ tenderArg: { ...tender, salePaymentId: 'pay-2' } });

    // A deposit recorded on another tender is not this tender's state.
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  /**
   * S12 — the replay is not state. `registerManualDeposit` answers with the
   * outcome recorded for *that* movement; on an idempotent replay the server
   * returns the outcome stored back when the original movement was recorded,
   * which can be older than today's balance. Only a read that starts after the
   * submit may be presented as the tender's current state.
   */
  describe('current tender state comes from a fresh read (S12)', () => {
    const replayAnswer = {
      appliedAmount: 40,
      surplusAmount: 0,
      status: 'needs_reconciliation',
    };

    it('shows the current row after a replay and keeps the replay as that movement record', async () => {
      // Read before the replay: the tender had 40 applied.
      state.query.data = [row({ appliedAmount: 40, surplusAmount: 0 })];
      // The read the replay triggers sees today's balance, 100.
      state.invalidateHistory.mockImplementation(() => {
        state.query.data = [row({ appliedAmount: 100, surplusAmount: 5 })];
        return Promise.resolve();
      });
      const { result } = mount();

      expect(result.current.currentState.appliedAmount).toBe(40);

      await act(async () => {
        state.mutationOptions?.onSuccess?.(replayAnswer);
      });

      // The balance comes from the fresh row, never from the replay's answer.
      expect(result.current.currentState.phase).toBe('ready');
      expect(result.current.currentState.appliedAmount).toBe(100);
      expect(result.current.currentState.surplusAmount).toBe(5);
      expect(result.current.currentState.confirmationStatus).toBe('needs_reconciliation');
      // The answer stays available, unchanged, as the record of that movement.
      expect(result.current.result).toEqual(replayAnswer);
    });

    it('withholds any figure while the re-read is in flight', () => {
      const gate = deferred();
      state.query.data = [row({ appliedAmount: 40, surplusAmount: 0 })];
      state.invalidateHistory.mockImplementation(() => gate.promise);
      const { result } = mount();

      act(() => state.mutationOptions?.onSuccess?.(replayAnswer));

      // 40 is both the pre-deposit row and the replay's figure: neither is      // today's balance, so the surface must say it is still reading.
      expect(result.current.currentState.phase).toBe('loading');
      expect(result.current.currentState.appliedAmount).toBeNull();
      expect(result.current.currentState.surplusAmount).toBeNull();
      expect(result.current.currentState.confirmationStatus).toBeNull();
      // The movement record stays readable while the read runs.
      expect(result.current.result).toEqual(replayAnswer);

      return act(async () => {
        gate.resolve();
      });
    });

    it('says the tender left the list instead of keeping the replay numbers', async () => {
      state.query.data = [row({ appliedAmount: 40, surplusAmount: 0 })];
      // The deposit settled the tender, so the pending list no longer has it.
      state.invalidateHistory.mockImplementation(() => {
        state.query.data = [];
        return Promise.resolve();
      });
      const { result } = mount();
      expect(result.current.currentState.appliedAmount).toBe(40);

      await act(async () => {
        state.mutationOptions?.onSuccess?.({
          appliedAmount: 100,
          surplusAmount: 0,
          status: 'manual_confirmed',
        });
      });

      expect(result.current.currentState.phase).toBe('absent');
      expect(result.current.currentState.appliedAmount).toBeNull();
      expect(result.current.currentState.surplusAmount).toBeNull();
      expect(result.current.currentState.confirmationStatus).toBeNull();
      // The recorded outcome is still evidence of that movement.
      expect(result.current.result?.appliedAmount).toBe(100);
    });

    it('surfaces a failed re-read instead of reusing the numbers it could not refresh', async () => {
      state.query.data = [row({ appliedAmount: 40, surplusAmount: 0 })];
      state.invalidateHistory.mockImplementation(() => {
        state.query.isError = true;
        state.query.error = new Error('Tender read failed');
        return Promise.reject(new Error('Tender read failed'));
      });
      const { result } = mount();

      await act(async () => {
        state.mutationOptions?.onSuccess?.(replayAnswer);
      });

      expect(result.current.currentState.phase).toBe('notRefreshed');
      expect(result.current.currentState.appliedAmount).toBeNull();
      expect(result.current.currentState.surplusAmount).toBeNull();
      expect(result.current.currentState.confirmationStatus).toBeNull();
      expect(result.current.currentState.error).toContain('Tender read failed');
      // The history section keeps its own error rendering.
      expect(result.current.history.isError).toBe(true);
    });

    it('ends the first deposit on the freshly read state', async () => {
      state.query.data = [
        row({ appliedAmount: 0, surplusAmount: 0, confirmationStatus: 'customer_reported' }),
      ];
      state.invalidateHistory.mockImplementation(() => {
        state.query.data = [row({ appliedAmount: 40, surplusAmount: 0 })];
        return Promise.resolve();
      });
      const { result } = mount();

      await act(async () => {
        state.mutationOptions?.onSuccess?.(replayAnswer);
      });

      expect(result.current.currentState.phase).toBe('ready');
      expect(result.current.currentState.appliedAmount).toBe(40);
      expect(result.current.currentState.confirmationStatus).toBe('needs_reconciliation');
      // Both reads the hook relies on are re-read, once.
      expect(state.invalidateHistory).toHaveBeenCalledTimes(1);
      expect(state.invalidateReconciliation).toHaveBeenCalledTimes(1);
    });

    it('reports the first read as in progress instead of showing a balance', () => {
      state.query.isLoading = true;
      const { result } = mount();

      expect(result.current.currentState.phase).toBe('loading');
      expect(result.current.currentState.appliedAmount).toBeNull();
      expect(result.current.currentState.confirmationStatus).toBeNull();
    });
  });
});
