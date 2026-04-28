import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanySyncCard } from '../CompanySyncCard';

const {
  pullQuery,
  pushMutation,
  resolveMutation,
} = vi.hoisted(() => ({
  pullQuery: vi.fn(),
  pushMutation: vi.fn(),
  resolveMutation: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    sync: {
      pull: { query: pullQuery },
      push: { mutate: pushMutation },
      resolve: { mutate: resolveMutation },
    },
  },
}));

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('CompanySyncCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    pullQuery.mockResolvedValue({
      pendingCount: 2,
      retryingCount: 1,
      failedCount: 1,
      conflictsCount: 1,
      externalSyncEnabled: true,
      lastSyncAt: '2026-04-08T10:00:00.000Z',
      oldestPendingAt: '2026-04-08T09:58:00.000Z',
      status: 'conflict',
      queue: [
        {
          id: 'queue-1',
          entityType: 'products',
          entityId: 'product-1',
          operation: 'update',
          createdAt: '2026-04-08T10:01:00.000Z',
          attempts: 1,
          lastError: 'Remote endpoint unavailable',
        },
      ],
      conflicts: [
        {
          id: 'conflict-1',
          entityType: 'products',
          entityId: 'product-1',
          localData: { id: 'product-1', name: 'Local Name', price: 10 },
          remoteData: { id: 'product-1', name: 'Remote Name', stock: 5 },
          createdAt: '2026-04-08T10:02:00.000Z',
        },
      ],
    });
    pushMutation.mockResolvedValue({
      success: true,
      synced: 2,
      processedIds: ['queue-1', 'queue-2'],
      conflictIds: [],
      errors: [],
      pendingCount: 0,
      retryingCount: 0,
      failedCount: 0,
      conflictsCount: 0,
      lastSyncAt: '2026-04-08T10:05:00.000Z',
      oldestPendingAt: null,
      status: 'synced',
      externalSyncEnabled: true,
    });
    resolveMutation.mockResolvedValue({
      success: true,
      id: 'conflict-1',
      resolution: 'local_wins',
      pendingCount: 1,
      retryingCount: 0,
      failedCount: 0,
      conflictsCount: 0,
      lastSyncAt: '2026-04-08T10:05:00.000Z',
      oldestPendingAt: '2026-04-08T10:05:00.000Z',
      status: 'pending',
      externalSyncEnabled: true,
    });
  });

  it('loads sync status and processes the queue', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    expect(await screen.findByText('Sync Center')).toBeInTheDocument();
    await screen.findByText(/product change waiting to sync/i);
    expect(screen.getByText('Retrying')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
    expect(screen.getByText(/oldest queued change/i)).toBeInTheDocument();
    expect(screen.getByText(/retry attempt 1/i)).toBeInTheDocument();
    expect(screen.getByText(/we couldn't sync this change/i)).toBeInTheDocument();
    expect(screen.queryByText(/entity id:/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /process queue/i }));

    await waitFor(() => {
      expect(pushMutation).toHaveBeenCalledWith({ limit: 50 });
    });
  });

  it('pulls a fresh snapshot on demand', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/product change waiting to sync/i);
    await user.click(screen.getByRole('button', { name: /pull snapshot/i }));

    await waitFor(() => {
      expect(pullQuery).toHaveBeenCalledTimes(2);
    });
  });

  it('resolves a conflict in favor of local data', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/product conflict/i);
    await user.click(screen.getByRole('button', { name: /keep local/i }));
    expect(screen.getByText(/keep local changes/i)).toBeInTheDocument();
    expect(screen.getByText(/keep the local product changes/i)).toBeInTheDocument();
    expect(resolveMutation).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /^keep local$/i }));

    await waitFor(() => {
      expect(resolveMutation).toHaveBeenCalledWith({
        id: 'conflict-1',
        resolution: 'local_wins',
      });
    });
  });

  it('asks for confirmation before accepting remote conflict data', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/product conflict/i);
    await user.click(screen.getByRole('button', { name: /accept remote/i }));
    expect(screen.getByText(/accept remote changes/i)).toBeInTheDocument();
    expect(screen.getByText(/accept the remote product version/i)).toBeInTheDocument();
    expect(resolveMutation).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /^accept remote$/i }));

    await waitFor(() => {
      expect(resolveMutation).toHaveBeenCalledWith({
        id: 'conflict-1',
        resolution: 'remote_wins',
      });
    });
  });

  it('only offers discard for missing-local conflicts', async () => {
    const user = userEvent.setup();

    pullQuery.mockResolvedValueOnce({
      pendingCount: 1,
      retryingCount: 1,
      failedCount: 1,
      conflictsCount: 1,
      externalSyncEnabled: true,
      lastSyncAt: '2026-04-08T10:00:00.000Z',
      oldestPendingAt: '2026-04-08T09:58:00.000Z',
      status: 'conflict',
      queue: [
        {
          id: 'queue-missing-local',
          entityType: 'sales',
          entityId: 'sale-missing-local',
          operation: 'update',
          createdAt: '2026-04-08T10:01:00.000Z',
          attempts: 2,
          lastError: 'Unable to sync sales:sale-missing-local because the local record is missing',
        },
      ],
      conflicts: [
        {
          id: 'conflict-missing-local',
          entityType: 'sales',
          entityId: 'sale-missing-local',
          localData: { id: 'sale-missing-local', total: 10 },
          remoteData: {},
          localRecordExists: false,
          createdAt: '2026-04-08T10:02:00.000Z',
        },
      ],
    });

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/sale conflict/i);
    expect(screen.getByText(/sale change waiting to sync/i)).toBeInTheDocument();
    expect(screen.getAllByText(/local record no longer exists/i)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /keep local/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /merge/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /discard local change/i }));
    expect(screen.getByText(/discard stale local change/i)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /discard local change/i }));

    await waitFor(() => {
      expect(resolveMutation).toHaveBeenCalledWith({
        id: 'conflict-missing-local',
        resolution: 'remote_wins',
      });
    });
  });

  it('allows editing merged conflict data before resolving', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/product conflict/i);
    await user.click(screen.getByRole('button', { name: /merge/i }));

    expect(screen.getByText(/merge conflict data/i)).toBeInTheDocument();
    const textarea = screen.getByLabelText(/merged json/i);
    fireEvent.change(textarea, {
      target: { value: '{"id":"product-1","name":"Merged Name","price":10,"stock":5}' },
    });

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /save merge/i }));

    await waitFor(() => {
      expect(resolveMutation).toHaveBeenCalledWith({
        id: 'conflict-1',
        resolution: 'merged',
        mergedData: {
          id: 'product-1',
          name: 'Merged Name',
          price: 10,
          stock: 5,
        },
      });
    });
  });
});
