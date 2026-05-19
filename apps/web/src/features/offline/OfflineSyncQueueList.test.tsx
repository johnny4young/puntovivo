/**
 * ENG-088 — OfflineSyncQueueList behavior tests.
 *
 * Pins the sync queue contract: empty state, multi-item rendering
 * with elapsed-time + status badge mapping, loading skeleton,
 * error + retry CTA, Spanish locale flip.
 *
 * `trpc.sync.listQueue` + `useOfflineSync` are mocked via the
 * same pattern as DeliveryPage / PosTouchScreen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import { OfflineSyncQueueList } from './OfflineSyncQueueList';

interface MockQueueRow {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

let mockRows: MockQueueRow[] = [];
let mockIsLoading = false;
let mockError: Error | null = null;
const refetchSpy = vi.fn();
const triggerSyncSpy = vi.fn(async () => undefined);

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sync: {
      listQueue: {
        useQuery: () => ({
          data: mockError ? undefined : { items: mockRows, count: mockRows.length },
          isLoading: mockIsLoading,
          error: mockError,
          refetch: refetchSpy,
        }),
      },
    },
  },
}));

vi.mock('@/hooks', () => ({
  useOfflineSync: () => ({
    isOnline: false,
    lastSync: null,
    pendingItems: mockRows.length,
    conflicts: 0,
    isSyncing: false,
    error: null,
    triggerSync: triggerSyncSpy,
    refreshStatus: vi.fn(),
  }),
}));

function makeRow(overrides: Partial<MockQueueRow> = {}): MockQueueRow {
  return {
    id: `outbox-${Math.random().toString(36).slice(2, 8)}`,
    entityType: 'sales',
    entityId: 'sale-aaaaaaaa1234',
    operation: 'create',
    attempts: 0,
    lastError: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe('OfflineSyncQueueList (ENG-088)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockRows = [];
    mockIsLoading = false;
    mockError = null;
  });

  it('renders the loading skeleton when the query is pending', () => {
    mockIsLoading = true;
    render(<OfflineSyncQueueList />);
    expect(screen.getByTestId('offline-sync-queue-loading')).toBeInTheDocument();
  });

  it('renders the empty state when the queue is empty', () => {
    render(<OfflineSyncQueueList />);
    expect(screen.getByTestId('offline-sync-queue-empty')).toBeInTheDocument();
    expect(screen.getByText(/Nothing pending to sync/i)).toBeInTheDocument();
  });

  it('renders each queued row with ticket id + entity label + status badge', () => {
    const now = new Date('2026-05-18T18:00:00Z');
    mockRows = [
      makeRow({ id: 'r1', entityId: 'sale-ABCDEFGH', entityType: 'sales', attempts: 0, lastError: null, createdAt: new Date(now.getTime() - 2 * 60_000).toISOString() }),
      makeRow({ id: 'r2', entityId: 'sale-IJKLMNOP', entityType: 'sale_items', attempts: 1, lastError: 'tx aborted', createdAt: new Date(now.getTime() - 30 * 60_000).toISOString() }),
      makeRow({ id: 'r3', entityId: 'sale-QRSTUVWX', entityType: 'inventory_movements', attempts: 5, lastError: 'permanent failure', createdAt: new Date(now.getTime() - 90 * 60_000).toISOString() }),
    ];
    render(<OfflineSyncQueueList now={now} />);

    const row1 = screen.getByTestId('offline-sync-queue-row-r1');
    expect(row1).toHaveAttribute('data-status', 'pending');
    expect(row1).toHaveTextContent('Ticket ABCDEFGH');
    expect(row1).toHaveTextContent('Sale');

    const row2 = screen.getByTestId('offline-sync-queue-row-r2');
    expect(row2).toHaveAttribute('data-status', 'retrying');
    expect(row2).toHaveTextContent('Sale item');

    const row3 = screen.getByTestId('offline-sync-queue-row-r3');
    expect(row3).toHaveAttribute('data-status', 'failed');
    expect(row3).toHaveTextContent('Inventory move');
  });

  it('formats elapsed time using i18next pluralization', () => {
    const now = new Date('2026-05-18T18:00:00Z');
    mockRows = [
      makeRow({ id: 'singular', createdAt: new Date(now.getTime() - 60_000).toISOString() }),
      makeRow({ id: 'plural', createdAt: new Date(now.getTime() - 5 * 60_000).toISOString() }),
    ];
    render(<OfflineSyncQueueList now={now} />);
    expect(screen.getByTestId('offline-sync-queue-row-singular')).toHaveTextContent('1 minute ago');
    expect(screen.getByTestId('offline-sync-queue-row-plural')).toHaveTextContent('5 minutes ago');
  });

  it('surfaces the error state with a retry CTA when the query rejects', async () => {
    const user = userEvent.setup();
    mockError = new Error('hub unreachable');
    render(<OfflineSyncQueueList />);
    expect(screen.getByTestId('offline-sync-queue-error')).toBeInTheDocument();
    await user.click(screen.getByTestId('offline-sync-queue-error-retry'));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fires triggerSync when the operator taps the populated-list retry CTA', async () => {
    const user = userEvent.setup();
    mockRows = [makeRow()];
    render(<OfflineSyncQueueList />);
    await user.click(screen.getByTestId('offline-sync-queue-retry'));
    expect(triggerSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('renders neutral LATAM tu Spanish copy on es locale flip', async () => {
    await i18next.changeLanguage('es');
    render(<OfflineSyncQueueList />);
    expect(screen.getByText(/Cola de sincronización/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin cambios pendientes/i)).toBeInTheDocument();
  });
});
