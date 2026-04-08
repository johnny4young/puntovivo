import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanySyncCard } from '../CompanySyncCard';

const {
  statusQuery,
  listQueueQuery,
  listConflictsQuery,
  pushMutation,
  resolveMutation,
} = vi.hoisted(() => ({
  statusQuery: vi.fn(),
  listQueueQuery: vi.fn(),
  listConflictsQuery: vi.fn(),
  pushMutation: vi.fn(),
  resolveMutation: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    sync: {
      status: { query: statusQuery },
      listQueue: { query: listQueueQuery },
      listConflicts: { query: listConflictsQuery },
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

    statusQuery.mockResolvedValue({
      pendingCount: 2,
      conflictsCount: 1,
      externalSyncEnabled: true,
      lastSyncAt: '2026-04-08T10:00:00.000Z',
      status: 'conflict',
    });
    listQueueQuery.mockResolvedValue({
      items: [
        {
          id: 'queue-1',
          entityType: 'products',
          entityId: 'product-1',
          operation: 'update',
          createdAt: '2026-04-08T10:01:00.000Z',
          attempts: 0,
          lastError: null,
        },
      ],
      count: 1,
    });
    listConflictsQuery.mockResolvedValue({
      items: [
        {
          id: 'conflict-1',
          entityType: 'products',
          entityId: 'product-1',
          createdAt: '2026-04-08T10:02:00.000Z',
        },
      ],
      count: 1,
    });
    pushMutation.mockResolvedValue({
      success: true,
      synced: 2,
      processedIds: ['queue-1', 'queue-2'],
      conflictIds: [],
      errors: [],
      pendingCount: 0,
      conflictsCount: 0,
      lastSyncAt: '2026-04-08T10:05:00.000Z',
      status: 'synced',
      externalSyncEnabled: true,
    });
    resolveMutation.mockResolvedValue({
      success: true,
      id: 'conflict-1',
      resolution: 'local_wins',
      pendingCount: 1,
      conflictsCount: 0,
      lastSyncAt: '2026-04-08T10:05:00.000Z',
      status: 'pending',
      externalSyncEnabled: true,
    });
  });

  it('loads sync status and processes the queue', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    expect(await screen.findByText('Sync Center')).toBeInTheDocument();
    await screen.findByText(/entity id: product-1/i);

    await user.click(screen.getByRole('button', { name: /process queue/i }));

    await waitFor(() => {
      expect(pushMutation).toHaveBeenCalledWith({ limit: 50 });
    });
  });

  it('resolves a conflict in favor of local data', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanySyncCard />);

    await screen.findByText(/products · product-1/i);
    await user.click(screen.getByRole('button', { name: /keep local/i }));

    await waitFor(() => {
      expect(resolveMutation).toHaveBeenCalledWith({
        id: 'conflict-1',
        resolution: 'local_wins',
      });
    });
  });
});
