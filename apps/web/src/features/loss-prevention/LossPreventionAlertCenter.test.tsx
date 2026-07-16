import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import { LossPreventionAlertCenter } from './LossPreventionAlertCenter';
import { buildLossPreventionWhatsAppUrl } from './lossPreventionWhatsApp';

type AlertResponse = inferRouterOutputs<AppRouter>['lossPrevention']['listAlerts'];

const alertItem: AlertResponse['items'][number] = {
  id: 'alert-1',
  kind: 'shift_refund_limit' as const,
  action: 'sale_refund' as const,
  approvalProvided: false,
  actorId: 'cashier-1',
  actorName: 'Carla Cashier',
  actorRole: 'cashier',
  siteId: 'site-1',
  siteName: 'Centro',
  occurredAt: '2026-07-16T14:00:00.000Z',
  channels: ['in_app', 'whatsapp_handoff'],
  acknowledgedAt: null,
  acknowledgedById: null,
  acknowledgedByName: null,
};

const queryState = vi.hoisted(() => ({
  data: {
    items: [],
    unacknowledgedCount: 0,
    whatsappHandoff: { enabled: false, recipientPhone: '' },
  } as AlertResponse,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
const invalidate = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const criticalState = vi.hoisted(() => ({ isPending: false }));
const useQuerySpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      lossPrevention: { listAlerts: { invalidate } },
    }),
    lossPrevention: {
      listAlerts: {
        useQuery: (input: unknown, options: unknown) => {
          useQuerySpy(input, options);
          return queryState;
        },
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate, isPending: criticalState.isPending }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe('LossPreventionAlertCenter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    queryState.data = {
      items: [],
      unacknowledgedCount: 0,
      whatsappHandoff: { enabled: false, recipientPhone: '' },
    };
    queryState.isLoading = false;
    queryState.error = null;
    criticalState.isPending = false;
  });

  it('opens the site alert feed, marks an item reviewed, and exposes a safe WhatsApp handoff', async () => {
    queryState.data = {
      items: [alertItem],
      unacknowledgedCount: 1,
      whatsappHandoff: { enabled: true, recipientPhone: '573001234567' },
    };
    const user = userEvent.setup();
    render(<LossPreventionAlertCenter siteId="site-1" />);
    expect(useQuerySpy).toHaveBeenCalledWith(
      { siteId: 'site-1', limit: 20 },
      { refetchInterval: 5_000 }
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open loss-prevention alerts; pending review: 1',
      })
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Refund shift limit crossed');
    expect(screen.getByRole('dialog')).toHaveTextContent('Carla Cashier · Centro');
    expect(screen.getByRole('dialog')).toHaveTextContent('blocked pending approval');

    const whatsapp = screen.getByTestId('loss-prevention-whatsapp-alert-1');
    expect(whatsapp).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/wa\.me\/573001234567/)
    );
    const decoded = decodeURIComponent(whatsapp.getAttribute('href') ?? '');
    expect(decoded).toContain('Rule: Refund shift limit crossed');
    expect(decoded).toContain('Operator: Carla Cashier');
    expect(decoded).not.toMatch(/customer|cart/i);

    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(mutate).toHaveBeenCalledWith({ siteId: 'site-1', alertId: 'alert-1' });
  });

  it('renders reviewed evidence without another action', async () => {
    queryState.data = {
      items: [
        {
          ...alertItem,
          acknowledgedAt: '2026-07-16T14:05:00.000Z',
          acknowledgedById: 'manager-1',
          acknowledgedByName: 'Mario Manager',
        },
      ],
      unacknowledgedCount: 0,
      whatsappHandoff: { enabled: true, recipientPhone: '573001234567' },
    };
    await i18next.changeLanguage('es');
    render(<LossPreventionAlertCenter siteId="site-1" variant="inline" />);
    expect(useQuerySpy).toHaveBeenCalledWith(
      { siteId: 'site-1', limit: 20 },
      { refetchInterval: false, refetchOnMount: false }
    );

    expect(screen.getByText('Se superó el límite de reembolsos del turno')).toBeInTheDocument();
    expect(screen.getByText(/Revisada por Mario Manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como revisada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('offers a retry when alert polling fails', async () => {
    queryState.error = new Error('offline');
    render(<LossPreventionAlertCenter siteId="site-1" variant="inline" />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
  });

  it('encodes the recipient and message deterministically', () => {
    expect(
      buildLossPreventionWhatsAppUrl({
        recipientPhone: '+57 (300) 123-4567',
        message: 'Alert: refund',
      })
    ).toBe(`https://wa.me/573001234567?text=${encodeURIComponent('Alert: refund')}`);
  });
});
