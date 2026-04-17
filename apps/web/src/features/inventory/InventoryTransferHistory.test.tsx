import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

// Captured per test so assertions can drive the onSuccess / onError paths.
let capturedMutationOpts: MutationOptions | null = null;

const listInvalidate = vi.fn(async () => undefined);
const balancesInvalidate = vi.fn(async () => undefined);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      transfers: { list: { invalidate: listInvalidate } },
      inventory: { listBalancesBySite: { invalidate: balancesInvalidate } },
    }),
    transfers: {
      list: {
        useQuery: () => listResult,
      },
      void: {
        useMutation: (opts: MutationOptions) => {
          capturedMutationOpts = opts;
          return voidMutationState;
        },
      },
    },
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
  itemCount: 1,
  totalQuantity: 4,
};

const voidedEntry: TransferHistoryEntry = {
  ...completedEntry,
  id: 'transfer-2',
  status: 'void',
  totalQuantity: 2,
  notes: 'Original note\n[VOID] Duplicate entry',
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
    balancesInvalidate.mockClear();
    toastSuccess.mockClear();

    render(<InventoryTransferHistory />);

    // `capturedMutationOpts` is set on the first render when the mock runs.
    expect(capturedMutationOpts?.onSuccess).toBeInstanceOf(Function);

    await capturedMutationOpts?.onSuccess?.();

    expect(listInvalidate).toHaveBeenCalled();
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
});
