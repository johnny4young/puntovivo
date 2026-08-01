import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { WebhookHealthPanel } from './WebhookHealthPanel';

const retryMutate = vi.fn();
const createMutateAsync = vi.fn(async (_input: unknown) => ({ signingSecret: 'secret-once' }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      events: {
        listSubscriptions: { invalidate: vi.fn(async () => undefined) },
        listDeliveries: { invalidate: vi.fn(async () => undefined) },
        peekOutbox: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    events: {
      listSubscriptions: {
        useQuery: () => ({
          data: [
            {
              id: 'sub-1',
              name: 'ERP',
              destinationUrl: 'https://hooks.example.test/puntovivo',
              eventTypes: ['sale.completed'],
              enabled: true,
              revokedAt: null,
            },
          ],
          isLoading: false,
        }),
      },
      listDeliveries: {
        useQuery: () => ({
          data: [
            {
              id: 'delivery-1',
              outboxId: 'outbox-1',
              subscriptionName: 'ERP',
              destinationUrl: 'https://hooks.example.test/puntovivo',
              eventType: 'sale.completed',
              status: 'dead_letter',
              attempts: 6,
              responseStatus: 500,
              lastErrorCode: 'WEBHOOK_HTTP_500',
            },
          ],
        }),
      },
      createSubscription: {
        useMutation: (options: { onSuccess: (value: { signingSecret: string }) => Promise<void> }) => ({
          mutate: (input: unknown) => {
            void createMutateAsync(input).then(result => options.onSuccess(result));
          },
          isPending: false,
          error: null,
        }),
      },
      disableSubscription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revokeSubscription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      retryDelivery: { useMutation: () => ({ mutate: retryMutate, isPending: false }) },
    },
  },
}));

describe('WebhookHealthPanel', () => {
  beforeEach(() => {
    retryMutate.mockClear();
    createMutateAsync.mockClear();
  });

  it('shows destination health and exposes an explicit dead-letter recovery action', async () => {
    const user = userEvent.setup();
    render(<WebhookHealthPanel />);
    expect(screen.getByRole('heading', { name: 'Webhook delivery' })).toBeInTheDocument();
    expect(screen.getByText('ERP')).toBeInTheDocument();
    expect(screen.getByText('ERP · sale.completed')).toBeInTheDocument();
    expect(screen.getByText('Needs manual recovery')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry delivery' }));
    expect(retryMutate).toHaveBeenCalledWith({ outboxId: 'outbox-1' });
  });

  it('creates a destination and reveals the signing secret once', async () => {
    const user = userEvent.setup();
    render(<WebhookHealthPanel />);
    await user.type(screen.getByLabelText('Destination name'), 'Accounting ERP');
    await user.type(screen.getByLabelText('HTTPS destination'), 'https://hooks.example.test/new');
    await user.click(screen.getByRole('button', { name: 'Create subscription' }));
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Accounting ERP', destinationUrl: 'https://hooks.example.test/new' })
    );
    expect(await screen.findByText('secret-once')).toBeInTheDocument();
  });
});
