import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { TransferHistoryEntry } from '@/types';
import { InventoryTransferHistory } from './InventoryTransferHistory';

type TransferListResult = {
  data: { items: TransferHistoryEntry[] } | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

let listResult: TransferListResult;

interface MutationOptions {
  onSuccess?: () => unknown | Promise<unknown>;
  onError?: (error: unknown) => unknown;
}

const voidMutationState = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => undefined),
  reset: vi.fn(),
  isPending: false,
  error: null as Error | null,
};

const receiveMutationState = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => undefined),
  reset: vi.fn(),
  isPending: false,
  error: null as Error | null,
};

// Captured per test so assertions can drive the onSuccess / onError paths.
let capturedMutationOpts: MutationOptions | null = null;
let capturedReceiveOpts: MutationOptions | null = null;
const getByIdInvocations: Array<{ id: string; enabled: boolean }> = [];

const listInvalidate = vi.fn(async () => undefined);
const detailInvalidate = vi.fn(async () => undefined);
const balancesInvalidate = vi.fn(async () => undefined);
const serialListInvalidate = vi.fn(async () => undefined);
const serialLookupInvalidate = vi.fn(async () => undefined);
const productListInvalidate = vi.fn(async () => undefined);
const productSearchInvalidate = vi.fn(async () => undefined);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      transfers: {
        list: { invalidate: listInvalidate },
        getById: { invalidate: detailInvalidate },
      },
      inventory: { listBalancesBySite: { invalidate: balancesInvalidate } },
      productSerials: {
        list: { invalidate: serialListInvalidate },
        lookup: { invalidate: serialLookupInvalidate },
      },
      products: {
        list: { invalidate: productListInvalidate },
        search: { invalidate: productSearchInvalidate },
      },
    }),
    transfers: {
      list: {
        useQuery: () => listResult,
      },
      getById: {
        useQuery: (input: { id: string }, opts?: { enabled?: boolean }) => {
          getByIdInvocations.push({ id: input.id, enabled: opts?.enabled ?? true });
          return {
            data: undefined,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

// `transfers.void` and `transfers.receive` migrated to
// `useCriticalMutation`. Mock that hook here so tests can still
// capture the onSuccess / onError options for assertion.
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: 'transfers.void' | 'transfers.receive', opts: MutationOptions) => {
    if (path === 'transfers.void') {
      capturedMutationOpts = opts;
      return voidMutationState;
    }
    if (path === 'transfers.receive') {
      capturedReceiveOpts = opts;
      return receiveMutationState;
    }
    throw new Error(`Unexpected critical procedure mocked: ${path}`);
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const completedEntry: TransferHistoryEntry = {
  id: 'transfer-1',
  status: 'completed',
  fromSiteId: 'site-primary',
  fromSiteName: 'Main Site',
  toSiteId: 'site-secondary',
  toSiteName: 'Warehouse',
  notes: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-04-15T12:00:00Z').toISOString(),
  receivedAt: null,
  receivedBy: null,
  itemCount: 1,
  totalQuantity: 4,
  hasDiscrepancy: false,
  discrepancyNotes: null,
};

const voidedEntry: TransferHistoryEntry = {
  ...completedEntry,
  id: 'transfer-2',
  status: 'void',
  totalQuantity: 2,
  notes: 'Original note\n[VOID] Duplicate entry',
};

const inTransitEntry: TransferHistoryEntry = {
  ...completedEntry,
  id: 'transfer-3',
  status: 'in_transit',
  totalQuantity: 3,
};

const discrepancyEntry: TransferHistoryEntry = {
  ...completedEntry,
  id: 'transfer-4',
  status: 'completed',
  hasDiscrepancy: true,
  discrepancyNotes: '2 units missing',
};

function setListResult(items: TransferHistoryEntry[] = [completedEntry, voidedEntry]): void {
  listResult = {
    data: { items },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function setErrorResult(error: Error): void {
  listResult = {
    data: undefined,
    isLoading: false,
    error,
    refetch: vi.fn(),
  };
}

describe('InventoryTransferHistory', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('lists completed and voided transfers with their status badge', () => {
    setListResult();

    render(<InventoryTransferHistory />);

    expect(screen.getByText('Transfer history')).toBeInTheDocument();
    expect(screen.getAllByText('Main Site').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Warehouse').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('disables the Void action on already-void transfers and enables it on completed ones', () => {
    setListResult();

    render(<InventoryTransferHistory />);

    const voidButtons = screen.getAllByRole('button', { name: 'Void' });
    expect(voidButtons).toHaveLength(2);
    // First row is completed → enabled. Second row is void → disabled.
    expect(voidButtons[0]).not.toBeDisabled();
    expect(voidButtons[1]).toBeDisabled();
  });

  it('opens the confirmation modal and submits the void mutation on confirm', async () => {
    setListResult([completedEntry]);
    voidMutationState.mutate.mockClear();

    render(<InventoryTransferHistory />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByText('Void transfer?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Void transfer' }));

    expect(voidMutationState.mutate).toHaveBeenCalledWith({
      transferId: completedEntry.id,
    });
  });

  it('runs the onSuccess path: invalidates caches and toasts', async () => {
    setListResult([completedEntry]);
    listInvalidate.mockClear();
    detailInvalidate.mockClear();
    balancesInvalidate.mockClear();
    toastSuccess.mockClear();

    render(<InventoryTransferHistory />);

    // `capturedMutationOpts` is set on the first render when the mock runs.
    expect(capturedMutationOpts?.onSuccess).toBeInstanceOf(Function);

    await capturedMutationOpts?.onSuccess?.();

    expect(listInvalidate).toHaveBeenCalled();
    expect(detailInvalidate).toHaveBeenCalled();
    expect(balancesInvalidate).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) })
    );
  });

  it('runs the onError path: surfaces a toast with the translated server message', () => {
    setListResult([completedEntry]);
    toastError.mockClear();

    render(<InventoryTransferHistory />);
    const boom = Object.assign(new Error('boom'), {
      data: { errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK' },
    });

    capturedMutationOpts?.onError?.(boom);

    expect(toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
      })
    );
  });

  it('renders an empty table when no transfers exist', () => {
    setListResult([]);

    render(<InventoryTransferHistory />);

    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Voided')).not.toBeInTheDocument();
  });

  it('renders a retry-able error state when the list query fails', () => {
    setErrorResult(new Error('boom'));

    render(<InventoryTransferHistory />);

    expect(screen.getByText('Unable to load transfer history')).toBeInTheDocument();
  });

  it('renders the In transit badge and Receive button only on in_transit rows', () => {
    setListResult([completedEntry, voidedEntry, inTransitEntry]);

    render(<InventoryTransferHistory />);

    expect(screen.getByText('In transit')).toBeInTheDocument();
    const receiveButtons = screen.getAllByRole('button', { name: 'Receive' });
    expect(receiveButtons).toHaveLength(1);
    expect(receiveButtons[0]).not.toBeDisabled();
  });

  it('opens the receive modal when the Receive button is clicked — does not mutate yet', async () => {
    setListResult([inTransitEntry]);
    receiveMutationState.mutate.mockClear();

    render(<InventoryTransferHistory />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Receive' }));

    // The modal is mounted — its title is in the DOM.
    expect(await screen.findByText('Receive transfer')).toBeInTheDocument();
    // Clicking Receive must NOT immediately mutate; the user still has to
    // confirm quantities inside the modal.
    expect(receiveMutationState.mutate).not.toHaveBeenCalled();
  });

  it('renders the discrepancy badge on transfers with variance', () => {
    setListResult([discrepancyEntry]);

    render(<InventoryTransferHistory />);

    expect(screen.getByText('Discrepancy')).toBeInTheDocument();
  });

  it('closes the receive modal immediately on success before awaited invalidations settle', async () => {
    setListResult([inTransitEntry]);
    toastSuccess.mockClear();
    listInvalidate.mockImplementationOnce(async () => {
      await new Promise(() => {});
    });
    detailInvalidate.mockImplementationOnce(async () => {
      await new Promise(() => {});
    });
    balancesInvalidate.mockImplementationOnce(async () => {
      await new Promise(() => {});
    });

    render(<InventoryTransferHistory />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(await screen.findByText('Receive transfer')).toBeInTheDocument();

    capturedReceiveOpts?.onSuccess?.();

    await waitFor(() => {
      expect(screen.queryByText('Receive transfer')).not.toBeInTheDocument();
    });
    expect(listInvalidate).toHaveBeenCalled();
    expect(detailInvalidate).toHaveBeenCalled();
    expect(balancesInvalidate).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('runs the receive onSuccess path: invalidates and toasts', async () => {
    setListResult([inTransitEntry]);
    listInvalidate.mockClear();
    detailInvalidate.mockClear();
    balancesInvalidate.mockClear();
    toastSuccess.mockClear();

    render(<InventoryTransferHistory />);

    expect(capturedReceiveOpts?.onSuccess).toBeInstanceOf(Function);
    await capturedReceiveOpts?.onSuccess?.();

    expect(listInvalidate).toHaveBeenCalled();
    expect(detailInvalidate).toHaveBeenCalled();
    expect(balancesInvalidate).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('renders a Details button on every row regardless of status', () => {
    setListResult([completedEntry, voidedEntry, inTransitEntry]);

    render(<InventoryTransferHistory />);

    const detailButtons = screen.getAllByRole('button', { name: 'Details' });
    expect(detailButtons).toHaveLength(3);
    for (const btn of detailButtons) {
      expect(btn).not.toBeDisabled();
    }
  });

  it('opens the details modal when a Details button is clicked', async () => {
    setListResult([completedEntry]);

    render(<InventoryTransferHistory />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(await screen.findByText('Transfer details')).toBeInTheDocument();
  });

  it('gates the getById query by open state: disabled until Details is clicked, enabled afterwards', async () => {
    setListResult([completedEntry]);
    getByIdInvocations.length = 0;

    render(<InventoryTransferHistory />);

    // Modal is closed on first render, so every getById invocation must be
    // `enabled: false` — the network call never fires.
    expect(getByIdInvocations.length).toBeGreaterThan(0);
    expect(getByIdInvocations.every(invocation => invocation.enabled === false)).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Details' }));

    const enabledInvocation = getByIdInvocations.find(invocation => invocation.enabled === true);
    expect(enabledInvocation).toBeDefined();
    expect(enabledInvocation?.id).toBe(completedEntry.id);
  });
});
