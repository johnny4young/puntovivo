import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { render, waitFor } from '@/test/utils';
import { trpc } from '@/lib/trpc';
import { ManagerApprovalQueue } from './ManagerApprovalQueue';
import { LossPreventionAlertCenter } from '../loss-prevention/LossPreventionAlertCenter';

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('operator alert real query cancellation', () => {
  it.each([
    {
      name: 'approval menu',
      procedure: 'managerApprovals.queue',
      component: <ManagerApprovalQueue />,
    },
    {
      name: 'inline loss alert',
      procedure: 'lossPrevention.listAlerts',
      component: <LossPreventionAlertCenter siteId="site-1" variant="inline" />,
    },
    {
      name: 'header loss alert',
      procedure: 'lossPrevention.listAlerts',
      component: <LossPreventionAlertCenter siteId="site-1" />,
    },
  ])(
    'aborts the pending $name read before it can outlive logout',
    async ({ procedure, component }) => {
      let pendingSignal: AbortSignal | undefined;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      clients.push(queryClient);
      const fetch = vi.fn(
        async (_url: unknown, init?: { signal?: AbortSignal | null | undefined }) => {
          pendingSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            pendingSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Operator menu unmounted', 'AbortError')),
              { once: true }
            );
          });
        }
      );
      const client = trpc.createClient({
        links: [httpBatchLink({ url: 'http://localhost/api/trpc', fetch })],
      });
      const view = render(
        <trpc.Provider client={client} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
        </trpc.Provider>
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(String(fetch.mock.calls[0]?.[0])).toContain(`/${procedure}?`);
      expect(pendingSignal?.aborted).toBe(false);
      view.unmount();
      await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
    }
  );
});
