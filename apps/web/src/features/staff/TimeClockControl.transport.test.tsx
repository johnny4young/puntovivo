import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { render, waitFor } from '@/test/utils';
import { trpc } from '@/lib/trpc';
import { TimeClockControl } from './TimeClockControl';

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

describe('TimeClockControl real query cancellation', () => {
  it.each(['employeeShifts.current', 'employeeShifts.breaks.current'])(
    'aborts a pending %s read when the operator menu unmounts',
    async procedure => {
      let pendingSignal: AbortSignal | undefined;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      clients.push(queryClient);
      const client = trpc.createClient({
        links: [
          httpBatchLink({
            url: 'http://localhost/api/trpc',
            fetch: async (url, init) => {
              if (String(url).split('?')[0]?.endsWith(`/${procedure}`)) {
                pendingSignal = init?.signal ?? undefined;
                return new Promise<Response>((_resolve, reject) => {
                  pendingSignal?.addEventListener(
                    'abort',
                    () => reject(new DOMException('Menu unmounted', 'AbortError')),
                    { once: true }
                  );
                });
              }
              return new Response(
                JSON.stringify([
                  {
                    result: {
                      data: {
                        id: 'shift-1',
                        siteId: 'site-1',
                        siteName: 'Central',
                        clockedInAt: '2026-09-06T07:00:00Z',
                        activeCashSession: null,
                      },
                    },
                  },
                ]),
                { headers: { 'content-type': 'application/json' } }
              );
            },
          }),
        ],
      });
      const view = render(
        <trpc.Provider client={client} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <TimeClockControl site={{ id: 'site-1', name: 'Central' }} />
          </QueryClientProvider>
        </trpc.Provider>
      );
      await waitFor(() => expect(pendingSignal).toBeDefined());
      expect(pendingSignal?.aborted).toBe(false);
      view.unmount();
      await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
    }
  );
});
